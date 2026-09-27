COPY public.events (id, payload) FROM stdin;
1	alpha
2	beta
3	gamma
\.
CREATE TABLE public.after_copy (id bigint PRIMARY KEY);
