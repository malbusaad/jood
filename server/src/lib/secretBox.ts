import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Small authenticated encryption helper (AES-256-GCM) for secrets the app must read back,
 * such as a guest's door code. The key is derived from SESSION_SECRET, so a database dump
 * alone does not reveal the codes.
 */
export function makeSecretBox(secret: string, purpose: string) {
  const key = Buffer.from(hkdfSync("sha256", secret, "jood-rest", purpose, 32));
  return {
    seal(plain: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
    },
    /** Returns null when the value cannot be decrypted (tampered, or the secret changed). */
    open(sealed: string): string | null {
      const [v, iv, tag, data] = sealed.split(".");
      if (v !== "v1" || !iv || !tag || !data) return null;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
        decipher.setAuthTag(Buffer.from(tag, "base64url"));
        return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
      } catch {
        return null;
      }
    },
  };
}

export type SecretBox = ReturnType<typeof makeSecretBox>;
