-- Repair the mixed 2021/current Postgres Changes schema reported on Realtime v2.134.10.
-- Run this prerequisite BEFORE retrying 20261031035922 on the affected database.
-- Modern subscriptions/functions are not replaced or downgraded.
-- Function SQL comes from supabase/realtime tag v2.134.10 (ef866244e88428bbd286f3e4ac88eb5e54a41bd4):
-- tenant migrations 20220712093339, 20260218120000, 20260626120000, 20260709120000.
-- Only transient socket subscriptions are cleared. Application data is untouched.
DO $spark_realtime_repair$
DECLARE
  v_columns text[];
  v_fields text[];
  v_sequence text;
  v_op text;
BEGIN
  IF to_regclass('realtime.subscription') IS NULL THEN
    RAISE EXCEPTION 'REALTIME_SUBSCRIPTION_TABLE_MISSING';
  END IF;
  IF EXISTS (SELECT FROM pg_attribute
    WHERE attrelid='realtime.subscription'::regclass AND attname='subscription_id'
      AND attnum>0 AND NOT attisdropped) THEN
    RETURN;
  END IF;

  SELECT array_agg(attname::text ORDER BY attnum) INTO v_columns
  FROM pg_attribute WHERE attrelid='realtime.subscription'::regclass
    AND attnum>0 AND NOT attisdropped;
  IF v_columns IS DISTINCT FROM ARRAY['id','user_id','email','entity','filters','created_at']::text[] THEN
    RAISE EXCEPTION 'UNSUPPORTED_REALTIME_SUBSCRIPTION_SCHEMA';
  END IF;
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
    INTO v_fields FROM pg_type t JOIN pg_attribute a ON a.attrelid=t.typrelid
  WHERE t.oid=to_regtype('realtime.wal_column') AND a.attnum>0 AND NOT a.attisdropped;
  IF v_fields IS DISTINCT FROM ARRAY['name:text','type:text','value:jsonb','is_pkey:boolean','is_selectable:boolean']::text[] THEN
    RAISE EXCEPTION 'UNSUPPORTED_REALTIME_WAL_COLUMN_SCHEMA';
  END IF;
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
    INTO v_fields FROM pg_type t JOIN pg_attribute a ON a.attrelid=t.typrelid
  WHERE t.oid=to_regtype('realtime.wal_rls') AND a.attnum>0 AND NOT a.attisdropped;
  IF v_fields IS DISTINCT FROM ARRAY['wal:jsonb','is_rls_enabled:boolean','subscription_ids:uuid[]','errors:text[]']::text[] THEN
    RAISE EXCEPTION 'UNSUPPORTED_REALTIME_WAL_RLS_SCHEMA';
  END IF;
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
    INTO v_fields FROM pg_type t JOIN pg_attribute a ON a.attrelid=t.typrelid
  WHERE t.oid=to_regtype('realtime.user_defined_filter') AND a.attnum>0 AND NOT a.attisdropped;
  IF v_fields IS DISTINCT FROM ARRAY['column_name:text','op:realtime.equality_op','value:text','negate:boolean']::text[] THEN
    RAISE EXCEPTION 'UNSUPPORTED_REALTIME_FILTER_SCHEMA';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='supabase_realtime_admin') THEN
    RAISE EXCEPTION 'REALTIME_ADMIN_ROLE_MISSING';
  END IF;

  LOCK TABLE realtime.subscription IN ACCESS EXCLUSIVE MODE;
  -- Existing connections must reconnect after this transaction commits.
  TRUNCATE TABLE realtime.subscription;
  ALTER TABLE realtime.subscription DROP CONSTRAINT IF EXISTS subscription_entity_user_id_filters_key;
  DROP INDEX IF EXISTS realtime.subscription_entity_user_id_filters_key;
  ALTER TABLE realtime.subscription RENAME COLUMN user_id TO subscription_id;
  ALTER TABLE realtime.subscription DROP COLUMN email;
  ALTER TABLE realtime.subscription ALTER COLUMN filters SET DEFAULT '{}';

  IF to_regprocedure('realtime.to_regrole(text)') IS NULL THEN
    EXECUTE $role$CREATE FUNCTION realtime.to_regrole(role_name text)
      RETURNS regrole LANGUAGE sql IMMUTABLE AS 'SELECT role_name::regrole'$role$;
  END IF;
  ALTER TABLE realtime.subscription
    ADD COLUMN claims jsonb NOT NULL,
    ADD COLUMN claims_role regrole NOT NULL GENERATED ALWAYS AS (realtime.to_regrole(claims->>'role')) STORED,
    ADD COLUMN action_filter text DEFAULT '*' CHECK (action_filter IN ('*','INSERT','UPDATE','DELETE')),
    ADD COLUMN selected_columns text[];
  CREATE UNIQUE INDEX spark_realtime_subscription_identity
    ON realtime.subscription(subscription_id,entity,filters,action_filter,(coalesce(selected_columns,'{}'::text[])));

  -- Replace only the known dependent helpers. RESTRICT deliberately refuses unknown
  -- dependencies; there is no DROP ... CASCADE that could remove unrelated objects.
  DROP FUNCTION realtime.apply_rls(jsonb,integer);
  DROP FUNCTION realtime.is_visible_through_filters(realtime.wal_column[],realtime.user_defined_filter[]);
  DROP FUNCTION realtime.build_prepared_statement_sql(text,regclass,realtime.wal_column[]);
  DROP TYPE realtime.wal_column;
  CREATE TYPE realtime.wal_column AS (
    name text,type_name text,type_oid oid,value jsonb,is_pkey boolean,is_selectable boolean
  );

  FOREACH v_op IN ARRAY ARRAY['eq','neq','lt','lte','gt','gte','in','like','ilike','is','match','imatch','isdistinct'] LOOP
    EXECUTE format('ALTER TYPE realtime.equality_op ADD VALUE IF NOT EXISTS %L',v_op);
  END LOOP;

  EXECUTE $realtime_sql$
create or replace function realtime.cast(val text, type_ regtype)
  returns jsonb
  immutable
  language plpgsql
as $$
declare
  res jsonb;
begin
  if type_::text = 'bytea' then
    return to_jsonb(val);
  end if;
  execute format('select to_jsonb(%L::'|| type_::text || ')', val) into res;
  return res;
end
$$;
$realtime_sql$;

  EXECUTE $realtime_sql$
create or replace function realtime.build_prepared_statement_sql(
    prepared_statement_name text,
    entity regclass,
    columns realtime.wal_column[]
)
    returns text
    language sql
as $$
/*
Builds a sql string that, if executed, creates a prepared statement to
tests retrive a row from *entity* by its primary key columns.
Example
    select realtime.build_prepared_statement_sql('public.notes', '{"id"}'::text[], '{"bigint"}'::text[])
*/
    select
'prepare ' || prepared_statement_name || ' as
    select
        exists(
            select
                1
            from
                ' || entity || '
            where
                ' || string_agg(quote_ident(pkc.name) || '=' || quote_nullable(pkc.value #>> '{}') , ' and ') || '
        )'
    from
        unnest(columns) pkc
    where
        pkc.is_pkey
    group by
        entity
$$;
$realtime_sql$;

  EXECUTE $realtime_sql$
create or replace function realtime.check_equality_op(
    op realtime.equality_op,
    type_ regtype,
    val_1 text,
    val_2 text,
    negate boolean
)
    returns bool
    stable  -- uses EXECUTE, so cannot be immutable
    language plpgsql
as $$
declare
    op_symbol text;
    res boolean;
begin
    -- IS DISTINCT FROM / IS NOT DISTINCT FROM: infix, both sides typed literals
    if op = 'isdistinct' then
        execute format(
            'select %L::%s %s %L::%s',
            val_1,
            type_::text,
            case when negate then 'IS NOT DISTINCT FROM' else 'IS DISTINCT FROM' end,
            val_2,
            type_::text
        ) into res;
        return res;
    end if;

    -- IS requires a keyword RHS (NULL, TRUE, FALSE, UNKNOWN), not a typed literal
    if op = 'is' then
        if val_2 not in ('null', 'true', 'false', 'unknown') then
            raise exception 'invalid value for is filter: must be null, true, false, or unknown';
        end if;
        execute format(
            'select %L::%s %s %s',
            val_1,
            type_::text,
            case when negate then 'IS NOT' else 'IS' end,
            upper(val_2)
        ) into res;
        return res;
    end if;

    op_symbol = case
        when op = 'eq'    then '='
        when op = 'neq'   then '!='
        when op = 'lt'    then '<'
        when op = 'lte'   then '<='
        when op = 'gt'    then '>'
        when op = 'gte'   then '>='
        when op = 'in'    then '= any'
        when op = 'like'   then 'LIKE'
        when op = 'ilike'  then 'ILIKE'
        when op = 'match'  then '~'
        when op = 'imatch' then '~*'
        else null
    end;

    if op_symbol is null then
        raise exception 'unsupported equality operator: %', op::text;
    end if;

    execute format(
        'select %L::%s %s (%L::%s)',
        val_1,
        type_::text,
        op_symbol,
        val_2,
        case when op = 'in' then type_::text || '[]' else type_::text end
    ) into res;

    return case when negate then not res else res end;
end;
$$;
$realtime_sql$;

  EXECUTE $realtime_sql$
create or replace function realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[])
    returns bool
    language sql
    stable  -- calls a stable function, so cannot be immutable
as $$
    select
        filters is null
        or array_length(filters, 1) is null
        or coalesce(
            count(col.name) = count(1)
            and sum(
                realtime.check_equality_op(
                    op:=f.op,
                    type_:=coalesce(col.type_oid::regtype, col.type_name::regtype),
                    val_1:=col.value #>> '{}',
                    val_2:=f.value,
                    negate:=coalesce(f.negate, false)
                )::int
            ) filter (where col.name is not null) = count(col.name),
            false
        )
    from
        unnest(filters) f
        left join unnest(columns) col
            on f.column_name = col.name;
$$;
$realtime_sql$;

  EXECUTE $realtime_sql$
create or replace function realtime.subscription_check_filters()
    returns trigger
    language plpgsql
as $$
declare
    col_names text[] = coalesce(
            array_agg(a.attname order by a.attnum),
            '{}'::text[]
        )
        from
            pg_catalog.pg_attribute a
        where
            a.attrelid = new.entity
            and a.attnum > 0
            and not a.attisdropped
            and pg_catalog.has_column_privilege(
                (new.claims ->> 'role'),
                a.attrelid,
                a.attnum,
                'SELECT'
            );
    filter realtime.user_defined_filter;
    col_type regtype;
    in_val jsonb;
    selected_col text;
begin
    for filter in select * from unnest(new.filters) loop
        if not filter.column_name = any(col_names) then
            raise exception 'invalid column for filter %', filter.column_name;
        end if;

        col_type = (
            select atttypid::regtype
            from pg_catalog.pg_attribute
            where attrelid = new.entity
                  and attname = filter.column_name
        );
        if col_type is null then
            raise exception 'failed to lookup type for column %', filter.column_name;
        end if;

        if filter.op = 'in'::realtime.equality_op then
            in_val = realtime.cast(filter.value, (col_type::text || '[]')::regtype);
            if coalesce(jsonb_array_length(in_val), 0) > 100 then
                raise exception 'too many values for `in` filter. Maximum 100';
            end if;
        elsif filter.op = 'is'::realtime.equality_op then
            -- `is` requires a keyword RHS rather than a typed literal
            if filter.value not in ('null', 'true', 'false', 'unknown') then
                raise exception 'invalid value for is filter: must be null, true, false, or unknown';
            end if;
            -- IS NULL works for any type, but IS TRUE/FALSE/UNKNOWN require a boolean
            -- operand. Reject the non-null keywords on non-boolean columns here so they
            -- don't abort apply_rls at WAL time.
            if filter.value <> 'null' and col_type <> 'boolean'::regtype then
                raise exception 'is % filter requires a boolean column, got %', filter.value, col_type::text;
            end if;
        elsif filter.op in ('like'::realtime.equality_op, 'ilike'::realtime.equality_op) then
            -- like/ilike apply the text pattern operator (~~); reject column types that
            -- have no such operator instead of failing at WAL time
            if not exists (
                select 1 from pg_catalog.pg_operator
                where oprname = '~~' and oprleft = col_type
            ) then
                raise exception 'operator % requires a text-compatible column type, got %', filter.op::text, col_type::text;
            end if;
        elsif filter.op in ('match'::realtime.equality_op, 'imatch'::realtime.equality_op) then
            -- match/imatch apply the regex operators ~ / ~*; reject column types that have
            -- no such operator (e.g. integer) instead of failing at WAL time, mirroring the
            -- like/ilike guard above.
            if not exists (
                select 1 from pg_catalog.pg_operator
                where oprname = case when filter.op = 'imatch'::realtime.equality_op then '~*' else '~' end
                  and oprleft = col_type
                  and oprright = col_type
                  and oprresult = 'boolean'::regtype
            ) then
                raise exception 'operator % requires a text-compatible column type, got %', filter.op::text, col_type::text;
            end if;
            -- validate the regex eagerly so a bad pattern is rejected here, not inside
            -- apply_rls where it would abort the WAL stream for the entity
            begin
                perform '' ~ filter.value;
            exception when others then
                raise exception 'invalid regular expression for % filter: %', filter.op::text, sqlerrm;
            end;
        else
            -- eq/neq/lt/lte/gt/gte: value must be coercable to the type
            perform realtime.cast(filter.value, col_type);
        end if;
    end loop;

    if new.selected_columns is not null then
        for selected_col in select * from unnest(new.selected_columns) loop
            if not selected_col = any(col_names) then
                raise exception 'invalid column for select %', selected_col;
            end if;
        end loop;
    end if;

    -- Apply consistent order to filters so the unique constraint can't be tricked by a
    -- different filter order. negate is part of the sort key.
    new.filters = coalesce(
        array_agg(f order by f.column_name, f.op, f.value, f.negate),
        '{}'
    ) from unnest(new.filters) f;

    new.selected_columns = (
        select array_agg(c order by c)
        from unnest(new.selected_columns) c
    );

    return new;
end;
$$;
$realtime_sql$;

  EXECUTE $realtime_sql$
create or replace function realtime.apply_rls(wal jsonb, max_record_bytes int = 1024 * 1024)
    returns setof realtime.wal_rls
    language plpgsql
    volatile
as $$
declare
    -- Regclass of the table e.g. public.notes
    entity_ regclass = (quote_ident(wal ->> 'schema') || '.' || quote_ident(wal ->> 'table'))::regclass;

    -- I, U, D, T: insert, update ...
    action realtime.action = (
        case wal ->> 'action'
            when 'I' then 'INSERT'
            when 'U' then 'UPDATE'
            when 'D' then 'DELETE'
            else 'ERROR'
        end
    );

    -- Is row level security enabled for the table
    is_rls_enabled bool = relrowsecurity from pg_class where oid = entity_;

    subscriptions realtime.subscription[] = array_agg(subs)
        from
            realtime.subscription subs
        where
            subs.entity = entity_
            -- Filter by action early - only get subscriptions interested in this action
            -- action_filter column can be: '*' (all), 'INSERT', 'UPDATE', or 'DELETE'
            and (subs.action_filter = '*' or subs.action_filter = action::text);

    -- Subscription vars
    working_role regrole;
    working_selected_columns text[];
    claimed_role regrole;
    claims jsonb;

    subscription_id uuid;
    subscription_has_access bool;
    visible_to_subscription_ids uuid[] = '{}';

    -- structured info for wal's columns
    columns realtime.wal_column[];
    -- previous identity values for update/delete
    old_columns realtime.wal_column[];

    error_record_exceeds_max_size boolean = octet_length(wal::text) > max_record_bytes;

    -- Primary jsonb output for record
    output jsonb;

    -- Loop record for iterating unique roles (outer loop)
    role_record record;
    -- Loop record for iterating unique selected_columns within a role (inner loop)
    cols_record record;
    -- Subscription ids visible at the role level (before fanning out by selected_columns)
    visible_role_sub_ids uuid[] = '{}';

begin
    perform set_config('role', null, true);

    columns =
        array_agg(
            (
                x->>'name',
                x->>'type',
                x->>'typeoid',
                realtime.cast(
                    (x->'value') #>> '{}',
                    coalesce(
                        (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                        (x->>'type')::regtype
                    )
                ),
                (pks ->> 'name') is not null,
                true
            )::realtime.wal_column
        )
        from
            jsonb_array_elements(wal -> 'columns') x
            left join jsonb_array_elements(wal -> 'pk') pks
                on (x ->> 'name') = (pks ->> 'name');

    old_columns =
        array_agg(
            (
                x->>'name',
                x->>'type',
                x->>'typeoid',
                realtime.cast(
                    (x->'value') #>> '{}',
                    coalesce(
                        (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                        (x->>'type')::regtype
                    )
                ),
                (pks ->> 'name') is not null,
                true
            )::realtime.wal_column
        )
        from
            jsonb_array_elements(wal -> 'identity') x
            left join jsonb_array_elements(wal -> 'pk') pks
                on (x ->> 'name') = (pks ->> 'name');

    for role_record in
        select claims_role
        from (select distinct claims_role from unnest(subscriptions)) t
        order by claims_role::text
    loop
        working_role := role_record.claims_role;

        -- Update `is_selectable` for columns and old_columns (once per role)
        columns =
            array_agg(
                (
                    c.name,
                    c.type_name,
                    c.type_oid,
                    c.value,
                    c.is_pkey,
                    pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                )::realtime.wal_column
            )
            from
                unnest(columns) c;

        old_columns =
                array_agg(
                    (
                        c.name,
                        c.type_name,
                        c.type_oid,
                        c.value,
                        c.is_pkey,
                        pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                    )::realtime.wal_column
                )
                from
                    unnest(old_columns) c;

        if action <> 'DELETE' and count(1) = 0 from unnest(columns) c where c.is_pkey then
            -- Fan out 400 error per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;
                return next (
                    jsonb_build_object(
                        'schema', wal ->> 'schema',
                        'table', wal ->> 'table',
                        'type', action
                    ),
                    is_rls_enabled,
                    (select array_agg(s.subscription_id) from unnest(subscriptions) as s where s.claims_role = working_role and (s.selected_columns is not distinct from working_selected_columns)),
                    array['Error 400: Bad Request, no primary key']
                )::realtime.wal_rls;
            end loop;

        -- The claims role does not have SELECT permission to the primary key of entity
        elsif action <> 'DELETE' and sum(c.is_selectable::int) <> count(1) from unnest(columns) c where c.is_pkey then
            -- Fan out 401 error per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;
                return next (
                    jsonb_build_object(
                        'schema', wal ->> 'schema',
                        'table', wal ->> 'table',
                        'type', action
                    ),
                    is_rls_enabled,
                    (select array_agg(s.subscription_id) from unnest(subscriptions) as s where s.claims_role = working_role and (s.selected_columns is not distinct from working_selected_columns)),
                    array['Error 401: Unauthorized']
                )::realtime.wal_rls;
            end loop;

        else
            -- Create the prepared statement (once per role)
            if is_rls_enabled and action <> 'DELETE' then
                if (select 1 from pg_prepared_statements where name = 'walrus_rls_stmt' limit 1) > 0 then
                    deallocate walrus_rls_stmt;
                end if;
                execute realtime.build_prepared_statement_sql('walrus_rls_stmt', entity_, columns);
            end if;

            -- Collect all visible subscription IDs for this role (filter check + RLS check)
            visible_role_sub_ids = '{}';

            for subscription_id, claims in (
                    select
                        subs.subscription_id,
                        subs.claims
                    from
                        unnest(subscriptions) subs
                    where
                        subs.entity = entity_
                        and subs.claims_role = working_role
                        and (
                            realtime.is_visible_through_filters(columns, subs.filters)
                            or (
                              action = 'DELETE'
                              and realtime.is_visible_through_filters(old_columns, subs.filters)
                            )
                        )
            ) loop

                if not is_rls_enabled or action = 'DELETE' then
                    visible_role_sub_ids = visible_role_sub_ids || subscription_id;
                else
                    -- Check if RLS allows the role to see the record
                    perform
                        -- Trim leading and trailing quotes from working_role because set_config
                        -- doesn't recognize the role as valid if they are included
                        set_config('role', trim(both '"' from working_role::text), true),
                        set_config('request.jwt.claims', claims::text, true);

                    execute 'execute walrus_rls_stmt' into subscription_has_access;

                    -- Reset the role on every FOR..LOOP batch execution.
                    -- The first batch of 10 rows is pre-fetched using the current connection role (PG internal behaviour)
                    -- then we have to reset it again otherwise it would use the role defined in the `set_config` above
                    -- to fetch the remaining rows when rows>10, which could be a user-defined role that lacks execution grants.
                    -- The flow is:
                    --   1. run batch with conn role
                    --   2. set_config working_role
                    --   3. execute walrus
                    --   4. reset role (revert)
                    --   5. repeat
                    perform set_config('role', null, true);

                    if subscription_has_access then
                        visible_role_sub_ids = visible_role_sub_ids || subscription_id;
                    end if;
                end if;
            end loop;

            perform set_config('role', null, true);

            -- Inner loop: per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;

                output = jsonb_build_object(
                    'schema', wal ->> 'schema',
                    'table', wal ->> 'table',
                    'type', action,
                    'commit_timestamp', to_char(
                        ((wal ->> 'timestamp')::timestamptz at time zone 'utc'),
                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                    ),
                    'columns', (
                        select
                            jsonb_agg(
                                jsonb_build_object(
                                    'name', pa.attname,
                                    'type', pt.typname
                                )
                                order by pa.attnum asc
                            )
                        from
                            pg_attribute pa
                            join pg_type pt
                                on pa.atttypid = pt.oid
                            left join (
                                select unnest(conkey) as pkey_attnum
                                from pg_constraint
                                where conrelid = entity_ and contype = 'p'
                            ) pk on pk.pkey_attnum = pa.attnum
                        where
                            attrelid = entity_
                            and attnum > 0
                            and pg_catalog.has_column_privilege(working_role, entity_, pa.attname, 'SELECT')
                            and (working_selected_columns is null or pa.attname = any(working_selected_columns) or pk.pkey_attnum is not null)
                    )
                )
                -- Add "record" key for insert and update
                || case
                    when action in ('INSERT', 'UPDATE') then
                        jsonb_build_object(
                            'record',
                            (
                                select
                                    jsonb_object_agg(
                                        -- if unchanged toast, get column name and value from old record
                                        coalesce((c).name, (oc).name),
                                        case
                                            when (c).name is null then (oc).value
                                            else (c).value
                                        end
                                    )
                                from
                                    unnest(columns) c
                                    full outer join unnest(old_columns) oc
                                        on (c).name = (oc).name
                                where
                                    coalesce((c).is_selectable, (oc).is_selectable)
                                    and (working_selected_columns is null or coalesce((c).name, (oc).name) = any(working_selected_columns) or coalesce((c).is_pkey, (oc).is_pkey))
                                    and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                            )
                        )
                    else '{}'::jsonb
                end
                -- Add "old_record" key for update and delete
                || case
                    when action = 'UPDATE' then
                        jsonb_build_object(
                                'old_record',
                                (
                                    select jsonb_object_agg((c).name, (c).value)
                                    from unnest(old_columns) c
                                    where
                                        (c).is_selectable
                                        and (working_selected_columns is null or (c).name = any(working_selected_columns) or (c).is_pkey)
                                        and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                                )
                            )
                    when action = 'DELETE' then
                        jsonb_build_object(
                            'old_record',
                            (
                                select jsonb_object_agg((c).name, (c).value)
                                from unnest(old_columns) c
                                where
                                    (c).is_selectable
                                    and (working_selected_columns is null or (c).name = any(working_selected_columns) or (c).is_pkey)
                                    and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                                    and ( not is_rls_enabled or (c).is_pkey ) -- if RLS enabled, we can't secure deletes so filter to pkey
                            )
                        )
                    else '{}'::jsonb
                end;

                -- Filter visible_role_sub_ids to those matching the current selected_columns group
                visible_to_subscription_ids = coalesce(
                    (
                        select array_agg(s.subscription_id)
                        from unnest(subscriptions) s
                        where s.claims_role = working_role
                          and (s.selected_columns is not distinct from working_selected_columns)
                          and s.subscription_id = any(visible_role_sub_ids)
                    ),
                    '{}'::uuid[]
                );

                return next (
                    output,
                    is_rls_enabled,
                    visible_to_subscription_ids,
                    case
                        when error_record_exceeds_max_size then array['Error 413: Payload Too Large']
                        else '{}'
                    end
                )::realtime.wal_rls;
            end loop;

        end if;
    end loop;

    perform set_config('role', null, true);
end;
$$;
$realtime_sql$;

  IF NOT EXISTS (SELECT FROM pg_trigger
    WHERE tgrelid='realtime.subscription'::regclass AND NOT tgisinternal
      AND tgfoid=to_regprocedure('realtime.subscription_check_filters()')) THEN
    CREATE TRIGGER tr_check_filters BEFORE INSERT OR UPDATE ON realtime.subscription
      FOR EACH ROW EXECUTE FUNCTION realtime.subscription_check_filters();
  END IF;

  REVOKE ALL ON realtime.subscription FROM anon,authenticated;
  GRANT USAGE ON SCHEMA realtime TO supabase_realtime_admin;
  GRANT ALL ON realtime.subscription TO supabase_realtime_admin;
  v_sequence:=pg_get_serial_sequence('realtime.subscription','id');
  IF v_sequence IS NOT NULL THEN
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO supabase_realtime_admin',v_sequence);
  END IF;
  GRANT USAGE ON TYPE realtime.wal_column TO supabase_realtime_admin;
  REVOKE ALL ON FUNCTION realtime.apply_rls(jsonb,integer),
    realtime.is_visible_through_filters(realtime.wal_column[],realtime.user_defined_filter[]),
    realtime.build_prepared_statement_sql(text,regclass,realtime.wal_column[]),
    realtime.check_equality_op(realtime.equality_op,regtype,text,text,boolean),
    realtime.subscription_check_filters(),realtime.cast(text,regtype),realtime.to_regrole(text)
    FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION realtime.apply_rls(jsonb,integer),
    realtime.is_visible_through_filters(realtime.wal_column[],realtime.user_defined_filter[]),
    realtime.build_prepared_statement_sql(text,regclass,realtime.wal_column[]),
    realtime.check_equality_op(realtime.equality_op,regtype,text,text,boolean),
    realtime.subscription_check_filters(),realtime.cast(text,regtype),realtime.to_regrole(text)
    TO supabase_realtime_admin;
  -- Do not fabricate vendor migration-history rows or reset tenant migration counters.
END;
$spark_realtime_repair$;
