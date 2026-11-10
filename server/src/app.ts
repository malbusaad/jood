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
import { guestRouter } from "./routes/guest.js";
import { loadSession, requireSameOrigin } from "./auth/session.js";
import { HttpError } from "./lib/http.js";
import type { WhatsAppConfig, WhatsAppSender, WhatsAppTemplateSender } from "./services/notifications.js";
import type { LockClient } from "./services/ttlock.js";
import { enablePushNotifications } from "./services/notifications.js";
import type { PushSend } from "./services/push.js";
import { logoVersion, SITE_IMAGES } from "./services/licenseLogo.js";
import { makeSecretBox, type SecretBox } from "./lib/secretBox.js";

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
  /** Booking requests per IP per hour. */
  bookingLimit?: number;
  /** Discount-code checks per IP per 15 minutes. */
  codeCheckLimit?: number;
  /** Sends owner notifications to WhatsApp; null when not configured. */
  whatsapp?: WhatsAppSender | null;
  /** WhatsApp Cloud API settings (connection check) and template sender for guest messages. */
  waConfig?: WhatsAppConfig | null;
  waSend?: WhatsAppTemplateSender | null;
  /** Phone/browser notifications for admins (Web Push); null to turn off. */
  push?: { send: PushSend; subject: string } | null;
  /** Public site address, used to build guest portal links. */
  publicBaseUrl?: string;
  /** TTLock client for door codes; null when not configured. */
  lock?: LockClient | null;
  /** Encrypts door codes at rest (derived from SESSION_SECRET in production). */
  secretBox?: SecretBox;
}

export function createApp({
  db,
  clientDistDir,
  secureCookies = false,
  allowedOrigins = [],
  loginLimit = 10,
  apiLimit = 300,
  bookingLimit = 10,
  codeCheckLimit = 30,
  whatsapp = null,
  waConfig = null,
  waSend = null,
  push = null,
  publicBaseUrl = "http://localhost:5173",
  lock = null,
  secretBox = makeSecretBox("development-only-secret-not-for-production", "door-codes"),
}: AppOptions) {
  const app = express();
  if (push) enablePushNotifications({ db, box: secretBox, ...push });

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
          // The intro video can be a YouTube or Vimeo link (privacy-enhanced YouTube player).
          frameSrc: ["https://www.youtube-nocookie.com", "https://player.vimeo.com"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(compression());
  // The tourism-licence logo upload is the only larger JSON body (base64 image, max 512 KB).
  app.use("/api/admin/license-logo", express.json({ limit: "800kb" }));
  app.use("/api/admin/site-images", express.json({ limit: "800kb" }));
  app.use("/api/admin/media", express.json({ limit: "2200kb" }));
  // The previous-records workbook (base64), read in memory and never stored.
  app.use("/api/admin/import", express.json({ limit: "8mb" }));
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
  app.use("/api/public", publicRouter(db, { whatsapp, bookingLimit, secretBox, codeCheckLimit }));
  // Photos uploaded by the owner. Private files (e.g. transfer receipts) are never served here.
  app.get("/api/media/:key", async (req, res, next) => {
    try {
      const m = await db.mediaAsset.findUnique({ where: { storageKey: String(req.params.key) }, select: { data: true, mimeType: true, isPrivate: true } });
      if (!m || m.isPrivate || !m.data) return void res.status(404).json({ error: "غير موجود" });
      res.set("Content-Type", m.mimeType);
      // Each upload has a new name, so the file never changes: cache for a long time.
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      res.set("Content-Security-Policy", "default-src 'none'");
      res.send(Buffer.from(m.data));
    } catch (err) {
      next(err);
    }
  });
  app.use("/api/guest", guestRouter(db, { secretBox }));

  app.use("/api/auth", requireSameOrigin(allowedOrigins), loadSession(db, secureCookies));
  app.use("/api/auth", authRouter(db, { secureCookies, loginLimit }));

  app.use("/api/admin", requireSameOrigin(allowedOrigins), loadSession(db, secureCookies), (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api/admin", adminRouter(db, { whatsapp, publicBaseUrl, lock, secretBox, waConfig, waSend, push }));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "المسار غير موجود" });
  });

  // The service worker must always be fresh (it delivers the phone notifications).
  app.get("/sw.js", (_req, res, next) => {
    res.set("Cache-Control", "no-cache");
    res.set("Service-Worker-Allowed", "/");
    next();
  });

  /** Lets the admin panel be added to the phone's home screen as an app (needed for notifications on iPhone). */
  app.get("/admin.webmanifest", async (_req, res) => {
    const icon = await logoVersion(db, SITE_IMAGES.icon.key).catch(() => null);
    const icons = icon
      ? [{ src: `/api/public/site-images/icon?v=${icon}`, sizes: "512x512", purpose: "any" }]
      : [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ];
    res.type("application/manifest+json").set("Cache-Control", "no-cache").send(
      JSON.stringify({
        name: "إدارة استراحة الجود",
        short_name: "إدارة الجود",
        lang: "ar",
        dir: "rtl",
        start_url: "/admin",
        scope: "/",
        display: "standalone",
        background_color: "#0f2620",
        theme_color: "#183B32",
        icons,
      }),
    );
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
