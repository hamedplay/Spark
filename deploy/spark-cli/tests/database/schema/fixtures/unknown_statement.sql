CREATE OPERATOR public.## (
  LEFTARG = integer,
  RIGHTARG = integer,
  PROCEDURE = public.custom_op
);
