// End-to-end encryption for cross-account links. Each OA app has its own P-256 key pair;
// the private key never leaves the app's own database. A message is sealed for the
// receiving app: ephemeral ECDH → HKDF-SHA256 → AES-256-GCM. Aprico only relays the
// sealed string and cannot read it. Pure WebCrypto (Deno and Node tests).
const b64 = (b: ArrayBuffer | Uint8Array) => {
  let s = '';
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const INFO = new TextEncoder().encode('aprico-link-v1');

export async function newKeyPair() {
  const k = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  return {
    privateJwk: await crypto.subtle.exportKey('jwk', k.privateKey),
    publicKey: b64(await crypto.subtle.exportKey('raw', k.publicKey)), // 65 bytes, base64
  };
}

export const validPublicKey = (v: unknown) =>
  typeof v === 'string' && /^[A-Za-z0-9+/]{86}[A-Za-z0-9+/=]{2}$/.test(v) && unb64(v).length === 65;

async function aesKey(shared: ArrayBuffer, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: INFO },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Seal text for the holder of `publicKey`. Returns a compact base64 JSON string. */
export async function seal(publicKey: string, text: string) {
  if (!validPublicKey(publicKey)) throw Error('link_key_invalid');
  const peer = await crypto.subtle.importKey('raw', unb64(publicKey), ECDH, false, []);
  const eph = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peer },
    eph.privateKey,
    256,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(shared, salt);
  const c = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(text),
  );
  return btoa(
    JSON.stringify({
      e: b64(await crypto.subtle.exportKey('raw', eph.publicKey)),
      s: b64(salt),
      i: b64(iv),
      c: b64(c),
    }),
  );
}

/** Open a sealed string with this app's private key. Throws on any tampering. */
export async function open(privateJwk: JsonWebKey, sealed: string) {
  const m = JSON.parse(atob(sealed));
  const priv = await crypto.subtle.importKey('jwk', privateJwk, ECDH, false, ['deriveBits']);
  const eph = await crypto.subtle.importKey('raw', unb64(m.e), ECDH, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: eph }, priv, 256);
  const key = await aesKey(shared, unb64(m.s));
  const p = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(m.i) }, key, unb64(m.c));
  return new TextDecoder().decode(p);
}
