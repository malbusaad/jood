import type { Prisma, PrismaClient } from "@prisma/client";
import type { Request } from "express";
import { clientIp } from "./http.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** Keys whose values must never be written to the audit log. */
const SECRET_KEYS = /password|token|secret|hash|iban|wifi|entryCode/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) ? "[redacted]" : redact(v)]),
    );
  }
  return value;
}

export async function audit(
  db: Db,
  req: Request | null,
  entry: { action: string; entityType: string; entityId?: string | null; details?: unknown },
) {
  await db.auditLog.create({
    data: {
      userId: req?.user?.id ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      details: entry.details === undefined ? undefined : (redact(entry.details) as Prisma.InputJsonValue),
      ip: req ? clientIp(req) : null,
    },
  });
}
