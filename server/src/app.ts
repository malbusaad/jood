import path from "node:path";
import fs from "node:fs";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import compression from "compression";
import { rateLimit } from "express-rate-limit";
import type { PrismaClient } from "@prisma/client";
import { healthRouter } from "./routes/health.js";

export interface AppOptions {
  db: PrismaClient;
  /** Directory of the built React client; served as static files when present. */
  clientDistDir?: string;
}

export function createApp({ db, clientDistDir }: AppOptions) {
  const app = express();

  // Render terminates TLS at its proxy; trust it so req.ip / rate limiting use the real client IP.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "blob:", "https:"],
          mediaSrc: ["'self'", "blob:", "https:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: "100kb" }));

  app.use(
    "/api",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "عدد كبير من الطلبات، حاول لاحقًا" },
    }),
  );

  app.use("/api/health", healthRouter(db));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "المسار غير موجود" });
  });

  if (clientDistDir && fs.existsSync(path.join(clientDistDir, "index.html"))) {
    app.use(express.static(clientDistDir, { index: false, maxAge: "1h" }));
    // SPA fallback: React Router handles client-side routes.
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(clientDistDir, "index.html"));
    });
  }

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error("[error]", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "حدث خطأ غير متوقع" });
  };
  app.use(errorHandler);

  return app;
}
