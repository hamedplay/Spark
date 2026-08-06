export interface GatewayParams {
  sessionId: string;
  userId: string;
  challengeId: string;
  claimId: string;
  phoneHash: string;
  ipHash: string;
}

export interface GatewayRpcResult {
  authorized: boolean;
  sessionId: string | null;
  errorCode: string | null;
}

export interface ReconcileRpcResult {
  authorized: boolean;
  errorCode: string | null;
}

export interface GatewayDeps {
  authorizeGateway: (params: GatewayParams) => Promise<GatewayRpcResult>;
  reconcileGateway: (params: GatewayParams) => Promise<ReconcileRpcResult>;
  cleanupCreatedSession: (accessToken: string, challengeId: string, claimId: string) => Promise<boolean>;
  releaseClaimOnly: (challengeId: string, claimId: string) => Promise<boolean>;
}

export interface GatewayOutcome {
  authorized: boolean;
}

async function callAuthorizeWithRetry(
  deps: GatewayDeps,
  params: GatewayParams,
): Promise<GatewayRpcResult> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await deps.authorizeGateway(params);
    } catch (err) {
      lastError = err;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
    }
  }
  throw lastError ?? new Error("GATEWAY_UNAVAILABLE");
}

export async function finalizeGateway(
  deps: GatewayDeps,
  params: GatewayParams,
  accessToken: string,
): Promise<GatewayOutcome> {
  let gatewayResult: GatewayRpcResult;
  let threw = false;

  try {
    gatewayResult = await callAuthorizeWithRetry(deps, params);
  } catch {
    threw = true;
    gatewayResult = { authorized: false, sessionId: null, errorCode: null };
  }

  if (!threw) {
    if (gatewayResult.authorized) {
      return { authorized: true };
    }
    await deps.cleanupCreatedSession(accessToken, params.challengeId, params.claimId);
    return { authorized: false };
  }

  let reconciliation: ReconcileRpcResult;
  try {
    reconciliation = await deps.reconcileGateway(params);
  } catch {
    await deps.releaseClaimOnly(params.challengeId, params.claimId);
    throw new Error("GATEWAY_UNAVAILABLE");
  }

  if (reconciliation.authorized) {
    if (reconciliation.errorCode !== null) {
      throw new Error("GATEWAY_UNAVAILABLE");
    }
    return { authorized: true };
  }

  if (
    reconciliation.errorCode !== "NOT_COMMITTED" &&
    reconciliation.errorCode !== "INCONSISTENT_STATE"
  ) {
    throw new Error("GATEWAY_UNAVAILABLE");
  }

  await deps.cleanupCreatedSession(accessToken, params.challengeId, params.claimId);
  return { authorized: false };
}
