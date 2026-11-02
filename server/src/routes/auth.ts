import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { endSession, requireAuth, startSession } from "../auth/session.js";
import { DUMMY_HASH_PROMISE, PASSWORD_MIN_LENGTH, hashPassword, verifyPassword } from "../lib/password.js";
import { HttpError, parse } from "../lib/http.js";
import { audit } from "../lib/audit.js";

const loginSchema = z.object({
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(200),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH, `كلمة المرور ${PASSWORD_MIN_LENGTH} أحرف على الأقل`).max(200),
});

export function authRouter(db: PrismaClient, opts: { secureCookies: boolean; loginLimit: number }) {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: opts.loginLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "محاولات دخول كثيرة، حاول بعد 15 دقيقة" },
  });

  router.post("/login", loginLimiter, async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = await db.user.findUnique({ where: { email } });
    // Always run a hash comparison so response time does not reveal whether the email exists.
    const ok = await verifyPassword(password, user?.passwordHash ?? (await DUMMY_HASH_PROMISE));
    if (!user || !ok || !user.active) {
      await audit(db, req, { action: "auth.login_failed", entityType: "user", details: { email } });
      throw new HttpError(401, "البريد الإلكتروني أو كلمة المرور غير صحيحة");
    }

    await startSession(db, req, res, user.id, opts.secureCookies);
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    await audit(db, req, { action: "auth.login", entityType: "user", entityId: user.id });
    res.json({ user: req.user });
  });

  router.post("/logout", async (req, res) => {
    if (req.user) await audit(db, req, { action: "auth.logout", entityType: "user", entityId: req.user.id });
    await endSession(db, req, res, opts.secureCookies);
    res.status(204).end();
  });

  router.get("/me", requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  router.post("/change-password", requireAuth, loginLimiter, async (req, res) => {
    const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
    const user = await db.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new HttpError(400, "كلمة المرور الحالية غير صحيحة");
    }
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } }),
      // Sign out every other session.
      db.session.deleteMany({ where: { userId: user.id, id: { not: req.sessionId! } } }),
    ]);
    await audit(db, req, { action: "auth.password_changed", entityType: "user", entityId: user.id });
    res.status(204).end();
  });

  return router;
}
