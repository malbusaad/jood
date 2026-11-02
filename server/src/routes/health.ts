import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

export function healthRouter(db: PrismaClient): Router {
  const router = Router();

  // Used by Render's health check: 200 only when the database is reachable.
  router.get("/", async (_req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({ status: "ok", database: "connected", time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: "error", database: "unreachable" });
    }
  });

  return router;
}
