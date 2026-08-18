import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { retiredPhoneLoginRoute } from "../_shared/retiredPhoneLoginRoute.ts";

Deno.serve(retiredPhoneLoginRoute);
