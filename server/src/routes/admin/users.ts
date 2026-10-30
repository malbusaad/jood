import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { HttpError, parse, uuidParam } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";
import { PASSWORD_MIN_LENGTH, hashPassword } from "../../lib/password.js";

const select = { id: true, email: true, name: true, role: true, active: true, lastLoginAt: true, createdAt: true };

/** Account management — owner only (enforced where the router is mounted). */
export function usersRouter(db: PrismaClient) {
  const router = Router();

  router.get("/", async (_req, res) => {
    res.json(await db.user.findMany({ select, orderBy: { createdAt: "asc" } }));
  });

  router.post("/", async (req, res) => {
    const input = parse(
      z.object({
        email: z.email().max(254).transform((e) => e.toLowerCase()),
        name: z.string().trim().min(1).max(120),
        password: z.string().min(PASSWORD_MIN_LENGTH).max(200),
        role: z.enum(["OWNER", "STAFF"]).default("STAFF"),
      }),
      req.body,
    );
    if (await db.user.findUnique({ where: { email: input.email } })) throw new HttpError(409, "البريد مستخدم مسبقًا");
    const { password, ...rest } = input;
    const user = await db.user.create({ data: { ...rest, passwordHash: await hashPassword(password) }, select });
    await audit(db, req, { action: "user.create", entityType: "user", entityId: user.id, details: rest });
    res.status(201).json(user);
  });

  router.patch("/:id", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const input = parse(
      z.object({ name: z.string().trim().min(1).max(120), role: z.enum(["OWNER", "STAFF"]), active: z.boolean() }).partial(),
      req.body,
    );
    if (id === req.user!.id && (input.active === false || input.role === "STAFF")) {
      throw new HttpError(400, "لا يمكنك إيقاف حسابك أو خفض صلاحيتك بنفسك");
    }
    const user = await db.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id }, data: input, select });
      if (input.active === false) await tx.session.deleteMany({ where: { userId: id } });
      return updated;
    });
    await audit(db, req, { action: "user.update", entityType: "user", entityId: id, details: input });
    res.json(user);
  });

  return router;
}
