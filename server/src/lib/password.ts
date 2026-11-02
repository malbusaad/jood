import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

// scrypt (memory-hard KDF from Node core). Parameters are stored with each hash so they can be raised later.
const N = 2 ** 15;
const r = 8;
const p = 1;
const KEYLEN = 64;
const MAXMEM = 128 * N * r * 2;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export const PASSWORD_MIN_LENGTH = 10;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r, p, maxmem: MAXMEM });
  return ["scrypt", N, r, p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltStr, keyStr] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(keyStr, "base64url");
  const n = Number(nStr);
  const rr = Number(rStr);
  const pp = Number(pStr);
  const key = await scrypt(password, Buffer.from(saltStr, "base64url"), expected.length, {
    N: n,
    r: rr,
    p: pp,
    maxmem: 128 * n * rr * 2,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A valid hash of a random password, used to keep login timing constant for unknown emails. */
export const DUMMY_HASH_PROMISE = hashPassword(randomBytes(16).toString("hex"));
