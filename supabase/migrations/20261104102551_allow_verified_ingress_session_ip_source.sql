-- The original allowlist predates the trusted ingress marker. Retain every old value.
-- No historical session record or IP is changed by this constraint correction.
ALTER TABLE private.event_session_context
 DROP CONSTRAINT event_session_context_ip_source_check,
 ADD CONSTRAINT event_session_context_ip_source_check
 CHECK (ip_source IN ('proxy_header','forwarded_header','trusted_ingress'));
NOTIFY pgrst,'reload schema';
