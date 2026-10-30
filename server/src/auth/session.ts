import type { NextFunction, Request, Response } from "express";
import type { PrismaClient, UserRole } from "@prisma/client";
import { generateToken, hashToken } from "../lib/tokens.js";
import { HttpError } from "../lib/http.js";

export const SESSION_COOKIE = "jood_admin";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours, sliding
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionId?: string;
    }
  }
}

function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "strict" as const,
    path: "/api",
  };
}

export async function startSession(db: PrismaClient, req: Request, res: Response, userId: string, secure: boolean) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      ip: req.ip ?? null,
      userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
    },
  });
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(secure), expires: expiresAt });
}

export async function endSession(db: PrismaClient, req: Request, res: Response, secure: boolean) {
  if (req.sessionId) await db.session.deleteMany({ where: { id: req.sessionId } });
  res.clearCookie(SESSION_COOKIE, cookieOptions(secure));
}

/** Resolves the admin user from the session cookie, if any. Never throws for missing/invalid sessions. */
export function loadSession(db: PrismaClient, secure: boolean) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== "string" || token.length < 20 || token.length > 100) return next();

    const session = await db.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { id: true, email: true, name: true, role: true, active: true } } },
    });
    if (!session || session.expiresAt <= new Date() || !session.user.active) {
      if (session) await db.session.delete({ where: { id: session.id } }).catch(() => {});
      res.clearCookie(SESSION_COOKIE, cookieOptions(secure));
      return next();
    }

    const { active: _active, ...user } = session.user;
    req.user = user;
    req.sessionId = session.id;

    if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(), expiresAt } });
      res.cookie(SESSION_COOKIE, token, { ...cookieOptions(secure), expires: expiresAt });
    }
    next();
  };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw new HttpError(401, "يجب تسجيل الدخول");
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new HttpError(401, "يجب تسجيل الدخول");
    if (!roles.includes(req.user.role)) throw new HttpError(403, "ليست لديك صلاحية لهذا الإجراء");
    next();
  };
}

/**
 * CSRF defence for cookie-authenticated mutations, on top of SameSite=Strict:
 * state-changing requests must be JSON (cannot be sent by a cross-site HTML form without a CORS
 * preflight) and, when the browser sends an Origin header, it must be this site.
 */
export function requireSameOrigin(allowedOrigins: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.get("origin");
    if (origin) {
      const self = `${req.protocol}://${req.get("host")}`;
      if (origin !== self && !allowedOrigins.includes(origin)) throw new HttpError(403, "مصدر الطلب غير مسموح");
    }
    const type = req.get("content-type") ?? "";
    const hasBody = req.method !== "DELETE" || Number(req.get("content-length") ?? 0) > 0;
    if (type.startsWith("multipart/form-data")) {
      // HTML forms can post multipart cross-site, so uploads must carry a same-site Origin.
      if (!origin) throw new HttpError(403, "مصدر الطلب غير مسموح");
    } else if (hasBody && !type.startsWith("application/json")) {
      throw new HttpError(415, "نوع المحتوى غير مدعوم");
    }
    next();
  };
}
