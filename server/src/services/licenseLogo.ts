import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { HttpError } from "../lib/http.js";

/**
 * The Ministry of Tourism logo uploaded by the owner. Stored in the database (site_settings) because
 * the server's disk is wiped on every deploy. Kept outside the settings registry so it is never sent
 * with the settings JSON; it is served on its own URL.
 */
export const LOGO_KEY = "tourismLicenseLogo";
export const MAX_LOGO_BYTES = 512 * 1024;

interface StoredLogo {
  mime: string;
  data: string; // base64
  sha256: string;
  size: number;
}

/** Only raster images, detected from the file's own bytes (not its name or a client-sent type). SVG is refused: it can carry scripts. */
export function detectImageType(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function saveLogo(db: PrismaClient, base64: string) {
  const clean = base64.replace(/^data:[^,]*,/, "").replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) throw new HttpError(400, "ملف الشعار غير صالح");
  const buf = Buffer.from(clean, "base64");
  if (buf.length === 0) throw new HttpError(400, "ملف الشعار فارغ");
  if (buf.length > MAX_LOGO_BYTES) throw new HttpError(413, "حجم الشعار أكبر من 512 كيلوبايت");
  const mime = detectImageType(buf);
  if (!mime) throw new HttpError(400, "الشعار يجب أن يكون صورة PNG أو JPG أو WebP");
  const value: StoredLogo = { mime, data: buf.toString("base64"), sha256: createHash("sha256").update(buf).digest("hex"), size: buf.length };
  await db.siteSetting.upsert({
    where: { key: LOGO_KEY },
    create: { key: LOGO_KEY, value: value as unknown as Prisma.InputJsonValue },
    update: { value: value as unknown as Prisma.InputJsonValue },
  });
  return { version: value.sha256.slice(0, 16), size: value.size, mime };
}

export async function readLogo(db: PrismaClient): Promise<{ mime: string; bytes: Buffer; version: string } | null> {
  const row = await db.siteSetting.findUnique({ where: { key: LOGO_KEY } });
  const v = row?.value as StoredLogo | undefined;
  if (!v?.data) return null;
  return { mime: v.mime, bytes: Buffer.from(v.data, "base64"), version: v.sha256.slice(0, 16) };
}

/** Version only (for cache-busting URLs), without loading the image itself. */
export async function logoVersion(db: PrismaClient): Promise<string | null> {
  const rows = await db.$queryRaw<{ v: string | null }[]>`SELECT value->>'sha256' AS v FROM site_settings WHERE key = ${LOGO_KEY}`;
  return rows[0]?.v ? rows[0].v.slice(0, 16) : null;
}

export async function deleteLogo(db: PrismaClient) {
  await db.siteSetting.deleteMany({ where: { key: LOGO_KEY } });
}
