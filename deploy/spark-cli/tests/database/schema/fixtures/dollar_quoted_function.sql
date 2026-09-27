CREATE FUNCTION public.demo()
RETURNS void
LANGUAGE plpgsql
AS $body$
BEGIN
  PERFORM 1;
  PERFORM 2;
END;
$body$;
