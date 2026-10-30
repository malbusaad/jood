import path from "node:path";
import fs from "node:fs";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { Prisma, type PrismaClient } from "@prisma/client";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { publicRouter } from "./routes/public.js";
import { adminRouter } from "./routes/admin/index.js";
import { loadSession, requireSameOrigin } from "./auth/session.js";
import { HttpError } from "./lib/http.js";

export interface AppOptions {
  db: PrismaClient;
  /** Directory of the built React client; served as static files when present. */
  clientDistDir?: string;
  /** Secure cookies require HTTPS — true in production. */
  secureCookies?: boolean;
  /** Extra origins allowed to send admin mutations (e.g. the Vite dev server). */
  allowedOrigins?: string[];
  /** Failed logins allowed per IP per 15 minutes. */
  loginLimit?: number;
  /** Requests per IP per 15 minutes across the API. */
  apiLimit?: number;
}

export function createApp({
  db,
  clientDistDir,
  secureCookies = false,
  allowedOrigins = [],
  loginLimit = 10,
  apiLimit = 300,
}: AppOptions) {
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
  app.use(cookieParser());

  app.use(
    "/api",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: apiLimit,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "عدد كبير من الطلبات، حاول لاحقًا" },
    }),
  );

  app.use("/api/health", healthRouter(db));
  app.use("/api/public", publicRouter(db));

  app.use("/api/auth", requireSameOrigin(allowedOrigins), loadSession(db, secureCookies));
  app.use("/api/auth", authRouter(db, { secureCookies, loginLimit }));

  app.use("/api/admin", requireSameOrigin(allowedOrigins), loadSession(db, secureCookies), (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api/admin", adminRouter(db));

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
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2025") return void res.status(404).json({ error: "العنصر غير موجود" });
      if (err.code === "P2002") return void res.status(409).json({ error: "القيمة مستخدمة مسبقًا" });
      if (err.code === "P2003") return void res.status(409).json({ error: "العنصر مرتبط ببيانات أخرى" });
    }
    if (err?.type === "entity.parse.failed") return void res.status(400).json({ error: "صيغة JSON غير صحيحة" });
    if (err?.type === "entity.too.large") return void res.status(413).json({ error: "حجم الطلب كبير" });
    // Log the message only — request bodies may contain passwords or guest data.
    console.error("[error]", err instanceof Error ? `${err.name}: ${err.message}` : "unknown error");
    res.status(500).json({ error: "حدث خطأ غير متوقع" });
  };
  app.use(errorHandler);

  return app;
}
