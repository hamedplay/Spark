-- Fix search_path on consume_phone_otp_rate_limit
ALTER FUNCTION public.consume_phone_otp_rate_limit(text, text) SET search_path = public;