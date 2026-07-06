import { APP_ID, PROTO_VER } from './types';
import type { DerivedKeys, MediaKeys } from './types';

// ── JWK Validation ─────────────────────────────────────────────────────────

export function validatePublicJWK(jwk: unknown): asserts jwk is JsonWebKey {
  if (typeof jwk !== 'object' || jwk === null) throw new Error('JWK must be an object');
  const j = jwk as Record<string, unknown>;
  if (j.kty !== 'EC')    throw new Error('JWK: expected EC');
  if (j.crv !== 'P-256') throw new Error('JWK: expected P-256');

  for (const coord of ['x', 'y'] as const) {
    if (typeof j[coord] !== 'string') throw new Error(`JWK: ${coord} missing`);
    const val = j[coord] as string;
    const bytes = Math.floor(val.length * 3 / 4);
    if (bytes < 31 || bytes > 33) throw new Error(`JWK: ${coord} wrong length (${val.length} chars → ~${bytes} bytes, expected 32)`);
    if (!/^[A-Za-z0-9_-]+=*$/.test(val)) throw new Error(`JWK: ${coord} invalid base64url`);
  }

  if ('d' in j) throw new Error('JWK contains private key material (d)');

  const allowed = new Set(['kty', 'crv', 'x', 'y', 'key_ops', 'ext', 'use']);
  for (const k of Object.keys(j)) {
    if (!allowed.has(k)) throw new Error(`JWK: unexpected field ${k}`);
  }
}

// ── ECDH Helpers ───────────────────────────────────────────────────────────

export async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
}

export async function exportPublicKey(pub: CryptoKey): Promise<string> {
  return JSON.stringify(await crypto.subtle.exportKey('jwk', pub));
}

export async function importPublicKey(raw: string): Promise<CryptoKey> {
  let jwk: unknown;
  try { jwk = JSON.parse(raw); } catch (e) { throw new Error(`JWK parse failed: ${e}`); }
  validatePublicJWK(jwk);
  return crypto.subtle.importKey(
    'jwk', jwk as JsonWebKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
}

// ── Key Derivation ─────────────────────────────────────────────────────────

export async function deriveSessionKeys(
  myPrivate: CryptoKey,
  peerPublic: CryptoKey,
  sessionId: string,
  myRole: 'caller' | 'callee',
  salt: Uint8Array,
): Promise<DerivedKeys> {
  const enc  = new TextEncoder();
  const base = `${PROTO_VER}|${APP_ID}|${sessionId}`;

  const rawSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublic },
    myPrivate,
    256,
  );

  const hkdfKey = await crypto.subtle.importKey(
    'raw', rawSecret, 'HKDF', false, ['deriveKey', 'deriveBits'],
  );

  const directions = ['caller-to-callee', 'callee-to-caller'] as const;
  const media      = ['audio', 'video'] as const;

  const keyResults: Record<string, MediaKeys> = {};

  await Promise.all(
    directions.flatMap(dir =>
      media.map(async kind => {
        const isSendDir = (myRole === 'caller') === (dir === 'caller-to-callee');
        const usage = isSendDir ? ['encrypt'] as KeyUsage[] : ['decrypt'] as KeyUsage[];
        const aesInfo  = enc.encode(`${base}|${dir}|${kind}|aes-gcm-256`);
        const seedInfo = enc.encode(`${base}|${dir}|${kind}|iv-seed`);

        const [key, seedBits] = await Promise.all([
          crypto.subtle.deriveKey(
            { name: 'HKDF', hash: 'SHA-256', salt, info: aesInfo },
            hkdfKey,
            { name: 'AES-GCM', length: 256 },
            true,
            usage,
          ),
          crypto.subtle.deriveBits(
            { name: 'HKDF', hash: 'SHA-256', salt, info: seedInfo },
            hkdfKey,
            64,
          ),
        ]);
        keyResults[`${dir}|${kind}`] = { key, ivSeed: new Uint8Array(seedBits) };
      }),
    ),
  );

  const c2cAudio = keyResults['caller-to-callee|audio'];
  const c2cVideo = keyResults['caller-to-callee|video'];
  const cc2Audio = keyResults['callee-to-caller|audio'];
  const cc2Video = keyResults['callee-to-caller|video'];

  if (myRole === 'caller') {
    return {
      send: { audio: c2cAudio, video: c2cVideo },
      recv: { audio: cc2Audio, video: cc2Video },
    };
  } else {
    return {
      send: { audio: cc2Audio, video: cc2Video },
      recv: { audio: c2cAudio, video: c2cVideo },
    };
  }
}

// ── Safety Number ──────────────────────────────────────────────────────────

export async function computeSafetyNumber(
  myJWK: string,
  peerJWK: string,
  sessionId: string,
): Promise<string[]> {
  const sorted = [myJWK, peerJWK].sort();
  const input  = new TextEncoder().encode(`${PROTO_VER}|${APP_ID}|${sessionId}|${sorted.join('\0')}`);
  const hash   = await crypto.subtle.digest('SHA-256', input);
  const hex    = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 16), hex.slice(16, 24), hex.slice(24, 32)];
}

// ── Byte Utilities ─────────────────────────────────────────────────────────

export const bytesToHex = (arr: Uint8Array) =>
  Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');

export const hexToBytes = (hex: string): Uint8Array | null => {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i >> 1] = parseInt(hex.slice(i, i + 2), 16);
  return out;
};

export function randomHex(bytes: number): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}
