// Owner PIN: 6 digits, stored only as a salted PBKDF2-SHA256 hash in the customer's own
// database. Pure WebCrypto, so it runs in Deno and in Node tests alike.
const ITERATIONS = 120_000;
const hex = (b: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

export const PIN_TTL_MS = 30 * 60 * 1000; // a correct PIN is not asked again for 30 minutes
export const MAX_TRIES = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
const WEAK = ['123456', '654321', '012345', '543210', '123123'];

export const validPin = (pin: unknown): pin is string =>
  typeof pin === 'string' && /^\d{6}$/.test(pin) && !/^(\d)\1{5}$/.test(pin) && !WEAK.includes(pin);

async function derive(pin: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return hex(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256),
  );
}

export async function hashPin(pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${hex(salt)}$${await derive(pin, salt, ITERATIONS)}`;
}

/** Constant-time comparison of the derived hash. */
export async function checkPin(pin: string, stored: string) {
  const [kind, iter, salt, want] = String(stored).split('$');
  if (kind !== 'pbkdf2' || !/^\d+$/.test(iter) || !salt || !want) return false;
  const got = await derive(pin, unhex(salt), Number(iter));
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}
