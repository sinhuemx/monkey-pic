// Firestore REST API helper for Deno using Service Account OAuth2
import { load as loadEnv } from "https://deno.land/std@0.224.0/dotenv/mod.ts";
await loadEnv({ export: true }).catch(() => {});

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_SCOPE = "https://www.googleapis.com/auth/datastore";
const IDENTITY_TOOLKIT_URL = "https://identitytoolkit.googleapis.com/v1/accounts:lookup";

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function base64urlEncodeBytes(bytes: Uint8Array): string {
  // btoa on binary
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 = btoa(bin);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64urlEncodeStr(str: string): string {
  const enc = new TextEncoder().encode(str);
  return base64urlEncodeBytes(enc);
}

function pemToDer(pem: string): ArrayBuffer {
  const clean = pem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----/g, "").replace(/\s+/g, "");
  const raw = atob(clean);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

async function getServiceAccountKey() {
  const projectId = Deno.env.get("FIREBASE_PROJECT_ID");
  const clientEmail = Deno.env.get("FIREBASE_CLIENT_EMAIL");
  const pkRaw = Deno.env.get("FIREBASE_PRIVATE_KEY");
  if (!projectId || !clientEmail || !pkRaw) {
    throw new Error("Faltan FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL o FIREBASE_PRIVATE_KEY");
  }
  // Convert \n to real newlines for PEM
  const privateKeyPem = pkRaw.replace(/\\n/g, "\n");
  const der = pemToDer(privateKeyPem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return { projectId, clientEmail, key } as const;
}

async function mintAccessToken(): Promise<{ token: string; expiresIn: number }> {
  const { clientEmail, key } = await getServiceAccountKey();
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: OAUTH_SCOPE,
    aud: OAUTH_TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const encHeader = base64urlEncodeStr(JSON.stringify(header));
  const encPayload = base64urlEncodeStr(JSON.stringify(payload));
  const signingInput = new TextEncoder().encode(`${encHeader}.${encPayload}`);
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    signingInput,
  ));
  const jwt = `${encHeader}.${encPayload}.${base64urlEncodeBytes(signature)}`;

  const form = new URLSearchParams();
  form.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  form.set("assertion", jwt);
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OAuth token error: ${txt}`);
  }
  const json = await res.json();
  return { token: json.access_token as string, expiresIn: Number(json.expires_in ?? 3600) };
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedAccessToken && now < cachedAccessToken.expiresAt) return cachedAccessToken.token;
  const { token, expiresIn } = await mintAccessToken();
  // Renew 1 minute before expiration
  cachedAccessToken = { token, expiresAt: now + (expiresIn * 1000) - 60_000 };
  return token;
}

type StlMeta = {
  filename: string;
  createdAt: Date;
  contentType?: string;
  widthMM?: number;
  baseMM?: number;
  maxHeightMM?: number;
  invert?: boolean;
  triangles?: number;
  sampleMax?: number;
};

export async function saveStlData(
  data: StlMeta,
  idToken: string,
) {
  const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID");
  if (!FIREBASE_PROJECT_ID) throw new Error("FIREBASE_PROJECT_ID no configurado");
  const FIREBASE_API_KEY = Deno.env.get("FIREBASE_API_KEY");
  if (!idToken) {
    // Sin token no podemos asociar uid; guardaremos sin uid
    console.warn("[firebase] ID token ausente; se guardará sin uid");
  }

  // Verify ID token to get uid (using Identity Toolkit REST)
  let uid: string | undefined;
  if (FIREBASE_API_KEY && idToken) {
    try {
      const verifyRes = await fetch(`${IDENTITY_TOOLKIT_URL}?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (verifyRes.ok) {
        const info = await verifyRes.json();
        const users = (info as { users?: Array<{ localId?: string }> }).users ?? [];
        uid = users[0]?.localId;
      } else {
        const txt = await verifyRes.text();
        console.warn(`[firebase] Verificación de ID token falló: ${txt}. Se guardará sin uid.`);
      }
    } catch (e) {
      console.warn(`[firebase] Error verificando ID token: ${e}. Se guardará sin uid.`);
    }
  } else {
    if (!FIREBASE_API_KEY) console.warn("[firebase] FIREBASE_API_KEY no configurado; se guardará sin uid.");
  }

  const accessToken = await getAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/stls`;
  const fields: Record<string, unknown> = {
    filename: { stringValue: data.filename },
    createdAt: { timestampValue: data.createdAt.toISOString() },
    ...(uid ? { uid: { stringValue: uid } } : {}),
  };
  if (data.contentType) fields.contentType = { stringValue: data.contentType };
  if (typeof data.widthMM === "number") fields.widthMM = { doubleValue: data.widthMM };
  if (typeof data.baseMM === "number") fields.baseMM = { doubleValue: data.baseMM };
  if (typeof data.maxHeightMM === "number") fields.maxHeightMM = { doubleValue: data.maxHeightMM };
  if (typeof data.invert === "boolean") fields.invert = { booleanValue: data.invert };
  if (typeof data.triangles === "number") fields.triangles = { integerValue: String(data.triangles) };
  if (typeof data.sampleMax === "number") fields.sampleMax = { integerValue: String(data.sampleMax) };

  const body = { fields } as const;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firestore error: ${txt}`);
  }
  return await res.json();
}
