// Spark offline-safe Supabase Edge Runtime main router.
//
// Supabase's upstream Docker router imports jsr:@panva/jose@6 at module load
// time. In restricted/air-gapped deployments that import can prevent the main
// worker from booting before any Spark Edge Function is reached. Spark runs the
// self-hosted functions service with FUNCTIONS_VERIFY_JWT=false and performs
// authorization inside the individual functions / application flow, so this
// router preserves the upstream routing behavior for that mode without any
// network-loaded dependency.
//
// Security invariant: if VERIFY_JWT is enabled, this router fails closed rather
// than silently bypassing JWT verification. Use the official Supabase router (or
// a locally vendored verifier) for deployments that require router-level JWT
// verification.

console.log("Spark offline-safe main function started");

const VERIFY_JWT = Deno.env.get("VERIFY_JWT") === "true";

Deno.serve(async (req: Request) => {
  if (req.method !== "OPTIONS" && VERIFY_JWT) {
    console.error(
      "VERIFY_JWT=true is not supported by the Spark offline-safe main router; refusing request",
    );
    return new Response(
      JSON.stringify({ msg: "Router-level JWT verification is unavailable in offline-safe mode" }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/");
  const serviceName = pathParts[1];

  if (!serviceName) {
    return new Response(JSON.stringify({ msg: "missing function name in request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const servicePath = `/home/deno/functions/${serviceName}`;
  console.error(`serving the request with ${servicePath}`);

  const memoryLimitMb = 150;
  const workerTimeoutMs = 60_000;
  const noModuleCache = false;
  const importMapPath = "/home/deno/functions/deno.jsonc";
  const envVarsObj = {
    ...Deno.env.toObject(),
    SUPABASE_FUNCTION_SLUG: serviceName,
  };
  const envVars = Object.keys(envVarsObj).map((key) => [key, envVarsObj[key]]);

  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb,
      workerTimeoutMs,
      noModuleCache,
      importMapPath,
      envVars,
    });
    return await worker.fetch(req);
  } catch (error) {
    console.error("Edge worker error", error);
    return new Response(JSON.stringify({ msg: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
