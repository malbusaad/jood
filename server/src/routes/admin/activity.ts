import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { parse, uuidParam } from "../../lib/http.js";

const page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.iso.datetime().optional(),
});

export function notificationsRouter(db: PrismaClient) {
  const router = Router();

  router.get("/", async (req, res) => {
    const { limit, before } = parse(page, req.query);
    const [items, unread] = await Promise.all([
      db.notification.findMany({
        where: before ? { createdAt: { lt: new Date(before) } } : {},
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      db.notification.count({ where: { readAt: null } }),
    ]);
    res.json({ items, unread });
  });

  router.post("/:id/read", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    await db.notification.updateMany({ where: { id, readAt: null }, data: { readAt: new Date() } });
    res.status(204).end();
  });

  router.post("/read-all", async (_req, res) => {
    await db.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
    res.status(204).end();
  });

  return router;
}

export function auditRouter(db: PrismaClient) {
  const router = Router();
  router.get("/", async (req, res) => {
    const { limit, before } = parse(page, req.query);
    res.json(
      await db.auditLog.findMany({
        where: before ? { createdAt: { lt: new Date(before) } } : {},
        orderBy: { createdAt: "desc" },
        take: limit,
        include: { user: { select: { name: true, email: true } } },
      }),
    );
  });
  return router;
}
