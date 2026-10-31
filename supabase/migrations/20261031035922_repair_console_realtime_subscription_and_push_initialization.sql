-- Repair the exact legacy subscription shape reported by the production trace.
-- Modern Realtime tables are left intact. No application/notification rows are deleted.
-- Reference: supabase/realtime tenant migrations 20211210212804,
-- 20251120212548, 20260527120000 and the inspected current filter validator.
DO $repair$
DECLARE
  v_columns text[];
  v_sequence text;
BEGIN
  IF to_regclass('realtime.subscription') IS NULL THEN
    RAISE EXCEPTION 'REALTIME_SUBSCRIPTION_TABLE_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_attribute
    WHERE attrelid='realtime.subscription'::regclass AND attname='subscription_id'
      AND attnum>0 AND NOT attisdropped
  ) THEN
    SELECT array_agg(attname::text ORDER BY attnum) INTO v_columns
    FROM pg_catalog.pg_attribute
    WHERE attrelid='realtime.subscription'::regclass AND attnum>0 AND NOT attisdropped;
    IF v_columns IS DISTINCT FROM ARRAY['id','user_id','email','entity','filters','created_at']::text[] THEN
      RAISE EXCEPTION 'UNSUPPORTED_REALTIME_SUBSCRIPTION_SCHEMA';
    END IF;
    IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_proc p
      WHERE p.oid=to_regprocedure('realtime.apply_rls(jsonb,integer)')
        AND position('subscription_id' IN p.prosrc)>0
    ) THEN
      RAISE EXCEPTION 'REALTIME_TENANT_FUNCTION_MIGRATIONS_REQUIRED';
    END IF;
    IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_type t JOIN pg_catalog.pg_attribute a ON a.attrelid=t.typrelid
      WHERE t.oid=to_regtype('realtime.user_defined_filter')
        AND a.attname='negate' AND a.attnum>0 AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'REALTIME_FILTER_TYPE_MIGRATIONS_REQUIRED';
    END IF;

    LOCK TABLE realtime.subscription IN ACCESS EXCLUSIVE MODE;
    -- This table contains transient socket subscriptions, not notifications or user data.
    -- The clients reconnect using fresh claims after the structural repair.
    TRUNCATE TABLE realtime.subscription;
    ALTER TABLE realtime.subscription DROP CONSTRAINT IF EXISTS subscription_entity_user_id_filters_key;
    DROP INDEX IF EXISTS realtime.subscription_entity_user_id_filters_key;
    ALTER TABLE realtime.subscription RENAME COLUMN user_id TO subscription_id;
    ALTER TABLE realtime.subscription DROP COLUMN email;

    IF to_regprocedure('realtime.to_regrole(text)') IS NULL THEN
      EXECUTE $role$CREATE FUNCTION realtime.to_regrole(role_name text)
        RETURNS regrole LANGUAGE sql IMMUTABLE SET search_path TO ''
        AS 'SELECT role_name::pg_catalog.regrole'$role$;
    END IF;
    ALTER TABLE realtime.subscription
      ADD COLUMN claims jsonb NOT NULL,
      ADD COLUMN claims_role regrole NOT NULL GENERATED ALWAYS AS (realtime.to_regrole(claims->>'role')) STORED,
      ADD COLUMN action_filter text DEFAULT '*' CHECK (action_filter IN ('*','INSERT','UPDATE','DELETE')),
      ADD COLUMN selected_columns text[];
    CREATE UNIQUE INDEX spark_realtime_subscription_identity
      ON realtime.subscription(subscription_id,entity,filters,action_filter,(coalesce(selected_columns,'{}'::text[])));
    EXECUTE $validator$CREATE OR REPLACE FUNCTION realtime.subscription_check_filters()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

        if filter.op::text = 'in' then
            in_val = realtime.cast(filter.value, (col_type::text || '[]')::regtype);
            if coalesce(jsonb_array_length(in_val), 0) > 100 then
                raise exception 'too many values for `in` filter. Maximum 100';
            end if;
        elsif filter.op::text = 'is' then
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
        elsif filter.op::text in ('like', 'ilike') then
            -- like/ilike apply the text pattern operator (~~); reject column types that
            -- have no such operator instead of failing at WAL time
            if not exists (
                select 1 from pg_catalog.pg_operator
                where oprname = '~~' and oprleft = col_type
            ) then
                raise exception 'operator % requires a text-compatible column type, got %', filter.op::text, col_type::text;
            end if;
        elsif filter.op::text in ('match', 'imatch') then
            -- match/imatch apply the regex operators ~ / ~*; reject column types that have
            -- no such operator (e.g. integer) instead of failing at WAL time, mirroring the
            -- like/ilike guard above.
            if not exists (
                select 1 from pg_catalog.pg_operator
                where oprname = case when filter.op::text = 'imatch' then '~*' else '~' end
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

    -- Normalize selected_columns order so ARRAY['a','b'] and ARRAY['b','a'] are treated
    -- as the same subscription group in apply_rls. Preserve an empty array as '{}'
    -- ("primary keys only") so it stays distinct from NULL ("all columns"); array_agg
    -- over an empty set would otherwise collapse '{}' back to NULL.
    if new.selected_columns is not null then
        new.selected_columns = coalesce(
            (
                select array_agg(c order by c)
                from unnest(new.selected_columns) c
            ),
            '{}'::text[]
        );
    end if;

    return new;
end;
$function$
$validator$;
    IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_trigger
      WHERE tgrelid='realtime.subscription'::regclass AND NOT tgisinternal
        AND tgfoid=to_regprocedure('realtime.subscription_check_filters()')
    ) THEN
      CREATE TRIGGER tr_check_filters BEFORE INSERT OR UPDATE ON realtime.subscription
        FOR EACH ROW EXECUTE FUNCTION realtime.subscription_check_filters();
    END IF;
    REVOKE ALL ON realtime.subscription FROM anon,authenticated;
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname='supabase_realtime_admin') THEN
      GRANT ALL ON realtime.subscription TO supabase_realtime_admin;
      v_sequence:=pg_get_serial_sequence('realtime.subscription','id');
      IF v_sequence IS NOT NULL THEN
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO supabase_realtime_admin',v_sequence);
      END IF;
    END IF;
  END IF;
END;
$repair$;

-- Missing/unreadable keys are an initialization state, not an HTTP 400.
-- The authenticated reader still checks FULL access and never returns the private key.
CREATE OR REPLACE FUNCTION private.get_my_pwa_push_config()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $push$
DECLARE v_access jsonb; v_public text;
BEGIN
  v_access:=private.get_my_auth_access_state();
  IF auth.uid() IS NULL OR v_access->>'access_level' IS DISTINCT FROM 'FULL' THEN
    RAISE EXCEPTION 'AUTH_ACCESS_RESTRICTED' USING errcode='42501';
  END IF;
  v_public:=nullif(private.safe_vault_secret('pwa_vapid_public_key'),'');
  IF v_public IS NULL OR nullif(private.safe_vault_secret('pwa_vapid_private_key'),'') IS NULL THEN
    RETURN jsonb_build_object('configured',false,'publicKey',NULL);
  END IF;
  RETURN jsonb_build_object('publicKey',v_public);
END;
$push$;

-- Both existing callers use this service-only setter to initialize/repair keys.
-- Retain a complete readable pair if another initializer won the race.
CREATE OR REPLACE FUNCTION public.set_pwa_vapid_config_service(p_public_key text,p_private_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $keys$
DECLARE v_id uuid;
BEGIN
  IF nullif(btrim(p_public_key),'') IS NULL OR nullif(btrim(p_private_key),'') IS NULL THEN
    RAISE EXCEPTION 'INVALID_VAPID_CONFIG';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('spark.pwa-vapid-initialization',0));
  IF nullif(private.safe_vault_secret('pwa_vapid_public_key'),'') IS NOT NULL
     AND nullif(private.safe_vault_secret('pwa_vapid_private_key'),'') IS NOT NULL THEN
    RETURN;
  END IF;
  SELECT id INTO v_id FROM vault.secrets WHERE name='pwa_vapid_public_key';
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_public_key,'pwa_vapid_public_key','Spark PWA VAPID public key',NULL);
  ELSE
    PERFORM vault.update_secret(v_id,p_public_key,'pwa_vapid_public_key','Spark PWA VAPID public key',NULL);
  END IF;
  SELECT id INTO v_id FROM vault.secrets WHERE name='pwa_vapid_private_key';
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_private_key,'pwa_vapid_private_key','Spark PWA VAPID private key',NULL);
  ELSE
    PERFORM vault.update_secret(v_id,p_private_key,'pwa_vapid_private_key','Spark PWA VAPID private key',NULL);
  END IF;
END;
$keys$;
REVOKE ALL ON FUNCTION public.set_pwa_vapid_config_service(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_pwa_vapid_config_service(text,text) TO service_role;

NOTIFY pgrst,'reload schema';
