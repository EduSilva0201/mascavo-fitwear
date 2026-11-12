import { argon2idAsync } from '@noble/hashes/argon2.js';

const options = { m: 19456, t: 2, p: 1, dkLen: 32, maxmem: 32 * 1024 * 1024 };
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
export const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export async function digest(value: string): Promise<string> {
  return hex(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
  );
}
export function equal(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const result = await argon2idAsync(password, salt, options);
  return `argon2id$v=19$m=19456,t=2,p=1$${hex(salt)}$${hex(result)}`;
}
export async function verifyPassword(password: string, encoded: string | null): Promise<boolean> {
  const parts = encoded?.split('$');
  const valid =
    parts?.length === 5 &&
    parts[0] === 'argon2id' &&
    parts[1] === 'v=19' &&
    parts[2] === 'm=19456,t=2,p=1' &&
    /^[a-f0-9]{32}$/.test(parts[3]) &&
    /^[a-f0-9]{64}$/.test(parts[4]);
  // Same work for nonexistent accounts, without caching passwords or derivations.
  const saltHex = valid ? parts![3] : '00000000000000000000000000000000';
  const salt = Uint8Array.from(saltHex.match(/../g)!, (b) => parseInt(b, 16));
  const result = hex(await argon2idAsync(password, salt, options));
  return equal(result, valid ? parts![4] : '0'.repeat(64)) && !!valid;
}
