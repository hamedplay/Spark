import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const BUCKET = "conference-presentations";
const OFFICE_KINDS = new Set(["SLIDES", "DOCUMENT"]);

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers });

function normalizeConverterUrl(value: string): string {
  return value.replace(/\/$/, "");
}

function splitObjectPath(path: string) {
  const index = path.lastIndexOf("/");
  return {
    folder: index >= 0 ? path.slice(0, index) : "",
    name: index >= 0 ? path.slice(index + 1) : path,
  };
}

async function storageObjectExists(
  service: ReturnType<typeof createClient>,
  path: string,
): Promise<boolean> {
  const { folder, name } = splitObjectPath(path);
  const { data, error } = await service.storage
    .from(BUCKET)
    .list(folder, { limit: 20, search: name });

  if (error) throw error;
  return Boolean(data?.some((item) => item.name === name));
}

async function markConversionFailed(
  service: ReturnType<typeof createClient>,
  input: {
    roomId: string;
    actorUserId: string;
    presentationId: string;
    error: string;
  },
) {
  await service.rpc("apply_conference_presentation_action", {
    p_room_id: input.roomId,
    p_actor_user_id: input.actorUserId,
    p_action: "conversion_failed",
    p_presentation_id: input.presentationId,
    p_payload: { error: input.error.slice(0, 1000) },
  });
}

async function convertOfficePresentation(
  service: ReturnType<typeof createClient>,
  input: {
    roomId: string;
    actorUserId: string;
    presentationId: string;
    sourcePath: string;
    converterUrl: string;
  },
) {
  const { data: signed, error: signedError } = await service.storage
    .from(BUCKET)
    .createSignedUrl(input.sourcePath, 300, { download: true });

  if (signedError || !signed?.signedUrl) {
    throw new Error("SOURCE_SIGNED_URL_FAILED");
  }

  const form = new FormData();
  form.set("downloadFrom", JSON.stringify([{
    url: signed.signedUrl,
  }]));
  form.set("exportFormFields", "false");
  form.set("updateIndexes", "true");

  const response = await fetch(
    `${normalizeConverterUrl(input.converterUrl)}/forms/libreoffice/convert`,
    {
      method: "POST",
      body: form,
      headers: {
        "Gotenberg-Output-Filename": `presentation-${input.presentationId}`,
        "Gotenberg-Trace": `spark-${input.presentationId}`,
      },
      signal: AbortSignal.timeout(60_000),
    },
  );

  if (!response.ok) {
    throw new Error(`CONVERTER_HTTP_${response.status}`);
  }

  const pdf = new Uint8Array(await response.arrayBuffer());
  if (pdf.byteLength <= 0 || pdf.byteLength > 50 * 1024 * 1024) {
    throw new Error("CONVERTED_FILE_SIZE_INVALID");
  }

  const renderedPath =
    `${input.roomId}/${input.presentationId}/system/rendered.pdf`;

  const { error: uploadError } = await service.storage
    .from(BUCKET)
    .upload(renderedPath, pdf, {
      contentType: "application/pdf",
      cacheControl: "3600",
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const { data, error } = await service.rpc(
    "apply_conference_presentation_action",
    {
      p_room_id: input.roomId,
      p_actor_user_id: input.actorUserId,
      p_action: "conversion_ready",
      p_presentation_id: input.presentationId,
      p_payload: { renderedPath },
    },
  );

  if (error || !data?.ok) {
    throw new Error(String(data?.reason || error?.message || "CONVERSION_READY_FAILED"));
  }

  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+.+/i.test(authHeader)) {
    return reply(401, { error: "NOT_AUTHENTICATED" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    ?? Deno.env.get("SERVICE_ROLE_KEY")
    ?? "";
  const converterUrl = Deno.env.get("PRESENTATION_CONVERTER_URL") ?? "";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return reply(503, { error: "CONFERENCE_NOT_CONFIGURED" });
  }

  let body: {
    roomId?: string;
    action?: string;
    presentationId?: string;
    payload?: Record<string, unknown>;
  };

  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "INVALID_BODY" });
  }

  if (!body.roomId || !body.action) {
    return reply(400, { error: "ROOM_AND_ACTION_REQUIRED" });
  }

  const allowedActions = new Set([
    "create",
    "finalize",
    "retry_conversion",
    "activate",
    "deactivate",
    "navigate",
    "delete",
    "annotation_upsert",
    "annotation_delete",
    "annotation_clear",
  ]);
  if (!allowedActions.has(body.action)) {
    return reply(400, { error: "INVALID_ACTION" });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: accessState, error: accessError } = await userClient.rpc(
    "get_my_auth_access_state",
  );
  if (
    accessError
    || !accessState
    || accessState.access_level !== "FULL"
    || !accessState.user_id
  ) {
    return reply(403, { error: "NOT_AUTHORIZED" });
  }

  const { data: authorization, error: authorizationError } =
    await userClient.rpc("authorize_conference_presentation_action", {
      p_room_id: body.roomId,
      p_action: body.action,
      p_presentation_id: body.presentationId ?? null,
    });

  if (authorizationError || !authorization?.ok) {
    return reply(403, {
      error: String(
        authorization?.reason
        || authorizationError?.message
        || "PRESENTATION_ACTION_FORBIDDEN",
      ).toUpperCase(),
    });
  }

  if (
    (body.action === "finalize" || body.action === "retry_conversion")
    && !body.presentationId
  ) {
    return reply(400, { error: "PRESENTATION_ID_REQUIRED" });
  }

  if (body.action === "finalize" || body.action === "retry_conversion") {
    const { data: presentation, error: presentationError } = await service
      .from("conference_presentations")
      .select("id,source_path,source_kind,status")
      .eq("id", body.presentationId!)
      .eq("room_id", body.roomId)
      .maybeSingle();

    if (presentationError || !presentation) {
      return reply(404, { error: "PRESENTATION_NOT_FOUND" });
    }

    try {
      if (!(await storageObjectExists(service, presentation.source_path))) {
        return reply(409, { error: "SOURCE_OBJECT_MISSING" });
      }
    } catch (error) {
      console.error("conference-presentation: source verification failed", error);
      return reply(503, { error: "SOURCE_VERIFICATION_FAILED" });
    }

    const { data: finalized, error: finalizeError } = await service.rpc(
      "apply_conference_presentation_action",
      {
        p_room_id: body.roomId,
        p_actor_user_id: accessState.user_id,
        p_action: body.action,
        p_presentation_id: body.presentationId,
        p_payload: body.payload ?? {},
      },
    );

    if (finalizeError || !finalized?.ok) {
      return reply(409, {
        error: String(
          finalized?.reason || finalizeError?.message || "FINALIZE_FAILED",
        ).toUpperCase(),
      });
    }

    if (!finalized.needs_conversion) {
      return reply(200, { ok: true, ...finalized });
    }

    if (!OFFICE_KINDS.has(String(presentation.source_kind))) {
      return reply(409, { error: "INVALID_CONVERSION_KIND" });
    }

    if (!converterUrl) {
      await markConversionFailed(service, {
        roomId: body.roomId,
        actorUserId: accessState.user_id,
        presentationId: body.presentationId!,
        error: "CONVERTER_NOT_CONFIGURED",
      });
      return reply(503, { error: "CONVERTER_NOT_CONFIGURED" });
    }

    try {
      const converted = await convertOfficePresentation(service, {
        roomId: body.roomId,
        actorUserId: accessState.user_id,
        presentationId: body.presentationId!,
        sourcePath: presentation.source_path,
        converterUrl,
      });
      return reply(200, { ok: true, ...converted });
    } catch (error) {
      console.error("conference-presentation: conversion failed", error);
      await markConversionFailed(service, {
        roomId: body.roomId,
        actorUserId: accessState.user_id,
        presentationId: body.presentationId!,
        error: error instanceof Error ? error.message : "CONVERSION_FAILED",
      });
      return reply(502, { error: "CONVERSION_FAILED" });
    }
  }

  const { data, error } = await service.rpc(
    "apply_conference_presentation_action",
    {
      p_room_id: body.roomId,
      p_actor_user_id: accessState.user_id,
      p_action: body.action,
      p_presentation_id: body.presentationId ?? null,
      p_payload: body.payload ?? {},
    },
  );

  if (error || !data?.ok) {
    return reply(409, {
      error: String(
        data?.reason || error?.message || "PRESENTATION_ACTION_FAILED",
      ).toUpperCase(),
    });
  }

  if (body.action === "delete") {
    const paths = [
      data.source_path,
      data.rendered_path,
    ].filter((value): value is string => typeof value === "string" && value);

    if (paths.length > 0) {
      const uniquePaths = [...new Set(paths)];
      const { error: removeError } = await service.storage
        .from(BUCKET)
        .remove(uniquePaths);
      if (removeError) {
        console.error("conference-presentation: object cleanup failed", removeError);
      }
    }
  }

  return reply(200, { ok: true, ...data });
});
