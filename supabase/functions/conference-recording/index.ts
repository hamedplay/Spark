import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import {
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  EncodingOptionsPreset,
  S3Upload,
} from "npm:livekit-server-sdk@2.18.0";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const ACTIVE_STATUSES = [
  "queued",
  "starting",
  "recording",
  "stopping",
  "processing",
];

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers });

function jsonSafe<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(
    value,
    (_key, item) => typeof item === "bigint" ? item.toString() : item,
  ));
}

function infoPayload(info: unknown) {
  return { egressInfo: jsonSafe(info) };
}

function providerStatus(info: unknown): number | null {
  const value = Number((info as { status?: unknown })?.status);
  return Number.isInteger(value) && value >= 0 && value <= 6 ? value : null;
}

function storagePathMatches(info: unknown, storagePath: string): boolean {
  if (!storagePath) return false;

  const safe = jsonSafe(info) as {
    fileResults?: Array<{ filename?: string }>;
    request?: unknown;
  };

  if (safe.fileResults?.some((result) => result?.filename === storagePath)) {
    return true;
  }

  try {
    return JSON.stringify(safe.request ?? {}).includes(storagePath);
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") {
    return reply(405, { error: "METHOD_NOT_ALLOWED" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+.+/i.test(authHeader)) {
    return reply(401, { error: "NOT_AUTHENTICATED" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    ?? Deno.env.get("SERVICE_ROLE_KEY")
    ?? "";
  const livekitUrl = Deno.env.get("LIVEKIT_URL") ?? "";
  const livekitApiKey = Deno.env.get("LIVEKIT_API_KEY") ?? "";
  const livekitApiSecret = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
  const storageBucket = Deno.env.get("RECORDING_STORAGE_BUCKET") ?? "";
  const storageRegion = Deno.env.get("RECORDING_STORAGE_REGION") ?? "";
  const storageAccessKey = Deno.env.get("RECORDING_STORAGE_ACCESS_KEY") ?? "";
  const storageSecret = Deno.env.get("RECORDING_STORAGE_SECRET_KEY") ?? "";
  const storageEndpoint = Deno.env.get("RECORDING_STORAGE_ENDPOINT") ?? "";

  if (
    !supabaseUrl
    || !anonKey
    || !serviceRoleKey
    || !livekitUrl
    || !livekitApiKey
    || !livekitApiSecret
  ) {
    return reply(503, { error: "CONFERENCE_NOT_CONFIGURED" });
  }

  let body: {
    roomId?: string;
    action?: "start" | "stop" | "reconcile";
  };

  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "INVALID_BODY" });
  }

  if (!body.roomId || !body.action) {
    return reply(400, { error: "ROOM_ID_AND_ACTION_REQUIRED" });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: accessState, error: accessError } =
    await userClient.rpc("get_my_auth_access_state");

  if (
    accessError
    || !accessState
    || accessState.access_level !== "FULL"
    || !accessState.user_id
  ) {
    return reply(403, { error: "NOT_AUTHORIZED" });
  }

  const { data: authz, error: authzError } =
    body.action === "reconcile"
      ? await userClient.rpc("authorize_livekit_recording", {
        p_room_id: body.roomId,
        p_action: "stop",
      })
      : await userClient.rpc("authorize_livekit_recording", {
        p_room_id: body.roomId,
        p_action: body.action,
      });

  if (authzError || !authz?.ok) {
    return reply(403, {
      error: String(authz?.reason || "NOT_AUTHORIZED").toUpperCase(),
      missingConsentCount:
        Number(authz?.missing_consent_count || 0) || undefined,
    });
  }

  const roomName = String(authz.livekit_room_name || "");
  const egress = new EgressClient(
    livekitUrl,
    livekitApiKey,
    livekitApiSecret,
  );

  const applyState = async (info: unknown) => {
    const egressId = String(
      (info as { egressId?: unknown })?.egressId || "",
    );
    if (!egressId) return null;

    const { data, error } = await service.rpc(
      "apply_livekit_recording_reconcile_v1",
      {
        p_room_name: roomName,
        p_egress_id: egressId,
        p_provider_status: providerStatus(info),
        p_payload: infoPayload(info),
      },
    );

    if (error) throw error;
    return data;
  };

  const getActiveRecording = async () => {
    const { data, error } = await service
      .from("conference_recordings")
      .select("id,provider_egress_id,status,storage_path")
      .eq("room_id", body.roomId)
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  };

  const reconcileRow = async (
    recording: {
      id: string;
      provider_egress_id?: string | null;
      storage_path?: string | null;
    },
  ) => {
    if (recording.provider_egress_id) {
      const infos = await egress.listEgress({
        egressId: recording.provider_egress_id,
      });
      for (const info of infos) await applyState(info);
      return infos.length > 0;
    }

    if (!recording.storage_path) return false;

    const infos = await egress.listEgress({ roomName });
    const matching = infos.filter((info) =>
      storagePathMatches(info, String(recording.storage_path))
    );

    for (const info of matching) await applyState(info);
    return matching.length > 0;
  };

  if (body.action === "reconcile") {
    const active = await getActiveRecording();
    if (!active) {
      return reply(200, { ok: true, reconciled: false, status: null });
    }

    try {
      const matched = await reconcileRow(active);
      const current = await getActiveRecording();
      return reply(200, {
        ok: true,
        reconciled: matched,
        recordingId: active.id,
        status: current?.status ?? "completed",
      });
    } catch (error) {
      console.error("conference-recording reconcile failed", error);
      return reply(502, { error: "RECORDING_RECONCILE_FAILED" });
    }
  }

  if (body.action === "start") {
    if (!storageBucket || !storageAccessKey || !storageSecret) {
      return reply(503, { error: "RECORDING_STORAGE_NOT_CONFIGURED" });
    }

    let existing = await getActiveRecording();
    if (existing) {
      try {
        await reconcileRow(existing);
        existing = await getActiveRecording();
      } catch (error) {
        console.warn("conference-recording pre-start reconcile skipped", error);
      }

      if (existing) {
        return reply(200, {
          ok: true,
          idempotent: true,
          recordingId: existing.id,
          status: existing.status,
        });
      }
    }

    const storagePath =
      `conference/${body.roomId}/${crypto.randomUUID()}.mp4`;

    const { data: recording, error: insertError } = await service
      .from("conference_recordings")
      .insert({
        room_id: body.roomId,
        meeting_id: authz.meeting_id ?? null,
        provider: "livekit-egress",
        status: "queued",
        storage_path: storagePath,
        mime_type: "video/mp4",
        created_by: accessState.user_id,
        started_at: null,
        consent_policy_version:
          Number(authz.consent_policy_version || 1),
      })
      .select("id")
      .single();

    if (insertError || !recording) {
      if (insertError?.code === "23505") {
        const raced = await getActiveRecording();
        if (raced) {
          return reply(200, {
            ok: true,
            idempotent: true,
            recordingId: raced.id,
            status: raced.status,
          });
        }
      }

      console.error("conference-recording metadata insert failed", {
        code: insertError?.code,
      });
      return reply(500, { error: "RECORDING_METADATA_FAILED" });
    }

    await service
      .from("conference_recordings")
      .update({
        status: "starting",
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", recording.id);

    try {
      const output = new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath: storagePath,
        output: {
          case: "s3",
          value: new S3Upload({
            accessKey: storageAccessKey,
            secret: storageSecret,
            bucket: storageBucket,
            region: storageRegion,
            endpoint: storageEndpoint,
            forcePathStyle: Boolean(storageEndpoint),
          }),
        },
      });

      const info = await egress.startRoomCompositeEgress(
        roomName,
        { file: output },
        {
          layout: "grid",
          encodingOptions: EncodingOptionsPreset.H264_1080P_30,
          audioOnly: false,
          videoOnly: false,
        },
      );

      const state = await applyState(info);

      await service.from("conference_audit_events").insert({
        room_id: body.roomId,
        actor_user_id: accessState.user_id,
        event_type: "recording_started",
        metadata: {
          recording_id: recording.id,
          egress_id: String(info.egressId || ""),
        },
      });

      return reply(200, {
        ok: true,
        recordingId: recording.id,
        status: String(state?.status || "starting"),
      });
    } catch (error) {
      console.error("conference-recording start request uncertain", error);

      let reconciliationAvailable = false;
      try {
        const infos = await egress.listEgress({ roomName });
        reconciliationAvailable = true;
        const recovered = infos.find((info) =>
          storagePathMatches(info, storagePath)
        );

        if (recovered) {
          const state = await applyState(recovered);
          return reply(202, {
            ok: true,
            recordingId: recording.id,
            status: String(state?.status || "starting"),
            reconciliationRecovered: true,
          });
        }
      } catch (reconcileError) {
        console.warn(
          "conference-recording start reconciliation unavailable",
          reconcileError,
        );
      }

      if (reconciliationAvailable) {
        await service
          .from("conference_recordings")
          .update({
            status: "failed",
            ended_at: new Date().toISOString(),
            error_message: "EGRESS_START_FAILED",
            updated_at: new Date().toISOString(),
          })
          .eq("id", recording.id);

        return reply(502, { error: "RECORDING_FAILED" });
      }

      await service
        .from("conference_recordings")
        .update({
          error_message: "START_STATUS_UNCERTAIN",
          updated_at: new Date().toISOString(),
        })
        .eq("id", recording.id);

      return reply(202, {
        ok: true,
        recordingId: recording.id,
        status: "starting",
        reconciliationPending: true,
      });
    }
  }

  let recording = await getActiveRecording();
  if (!recording) {
    return reply(404, { error: "ACTIVE_RECORDING_NOT_FOUND" });
  }

  if (!recording.provider_egress_id) {
    try {
      await reconcileRow(recording);
      recording = await getActiveRecording();
    } catch (error) {
      console.warn("conference-recording pre-stop reconcile skipped", error);
    }
  }

  if (!recording?.provider_egress_id) {
    return reply(409, {
      error: "RECORDING_START_PENDING",
      recordingId: recording?.id,
    });
  }

  await service
    .from("conference_recordings")
    .update({
      status: "stopping",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", recording.id);

  try {
    const info = await egress.stopEgress(recording.provider_egress_id);
    const state = await applyState(info);

    await service.from("conference_audit_events").insert({
      room_id: body.roomId,
      actor_user_id: accessState.user_id,
      event_type: "recording_stopped",
      metadata: {
        recording_id: recording.id,
        egress_id: recording.provider_egress_id,
      },
    });

    return reply(200, {
      ok: true,
      recordingId: recording.id,
      status: String(state?.status || "stopping"),
    });
  } catch (error) {
    console.error("conference-recording stop request uncertain", error);

    try {
      const infos = await egress.listEgress({
        egressId: recording.provider_egress_id,
      });

      if (infos.length > 0) {
        const state = await applyState(infos[0]);
        return reply(202, {
          ok: true,
          recordingId: recording.id,
          status: String(state?.status || "stopping"),
          reconciliationPending: true,
        });
      }

      await service
        .from("conference_recordings")
        .update({
          status: "failed",
          ended_at: new Date().toISOString(),
          error_message: "EGRESS_NOT_FOUND_DURING_STOP_RECONCILE",
          updated_at: new Date().toISOString(),
        })
        .eq("id", recording.id);

      return reply(502, { error: "RECORDING_FAILED" });
    } catch (reconcileError) {
      console.warn(
        "conference-recording stop reconciliation unavailable",
        reconcileError,
      );

      await service
        .from("conference_recordings")
        .update({
          error_message: "STOP_STATUS_UNCERTAIN",
          updated_at: new Date().toISOString(),
        })
        .eq("id", recording.id);

      return reply(202, {
        ok: true,
        recordingId: recording.id,
        status: "stopping",
        reconciliationPending: true,
      });
    }
  }
});
