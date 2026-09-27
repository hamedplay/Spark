-- leading comment with ; inside
/* block comment ; still comment */
CREATE TABLE public.notes (
  id bigint PRIMARY KEY,
  body text DEFAULT 'semi;colon'
);
