import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { HttpError, parse, uuidParam } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";
import type { SecretBox } from "../../lib/secretBox.js";
import { pushToAdmins, vapidKeys, type PushSend } from "../../services/push.js";

/** «إشعارات الجوال»: each admin registers their own devices. */
export function pushRouter(db: PrismaClient, opts: { box: SecretBox; push: { send: PushSend; subject: string } | null }) {
  const router = Router();

  router.get("/", async (req, res) => {
    const devices = await db.pushSubscription.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, label: true, endpoint: true, createdAt: true, lastSuccessAt: true, lastError: true },
    });
    res.json({
      enabled: Boolean(opts.push),
      publicKey: opts.push ? (await vapidKeys(db, opts.box)).publicKey : null,
      // The endpoint identifies the device to the browser; only its host is useful to show.
      devices: devices.map(({ endpoint, ...d }) => ({ ...d, endpoint, service: new URL(endpoint).host })),
    });
  });

  router.post("/subscriptions", async (req, res) => {
    const input = parse(
      z.object({
        endpoint: z.url().max(1000).refine((u) => u.startsWith("https://"), "عنوان غير صالح"),
        keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
        label: z.string().trim().max(100).nullable().optional(),
      }),
      req.body,
    );
    const data = { userId: req.user!.id, p256dh: input.keys.p256dh, auth: input.keys.auth, label: input.label ?? null, lastError: null };
    const sub = await db.pushSubscription.upsert({ where: { endpoint: input.endpoint }, create: { endpoint: input.endpoint, ...data }, update: data });
    await audit(db, req, { action: "push.subscribe", entityType: "push_subscription", entityId: sub.id, details: { label: input.label ?? null } });
    res.status(201).json({ id: sub.id });
  });

  router.delete("/subscriptions/:id", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const { count } = await db.pushSubscription.deleteMany({ where: { id, userId: req.user!.id } });
    if (count === 0) throw new HttpError(404, "الجهاز غير موجود");
    await audit(db, req, { action: "push.unsubscribe", entityType: "push_subscription", entityId: id });
    res.status(204).end();
  });

  /** A test notification to the current admin's own devices. */
  router.post("/test", async (req, res) => {
    if (!opts.push) throw new HttpError(409, "الإشعارات غير مفعّلة على الخادم");
    const r = await pushToAdmins(
      { db, box: opts.box, ...opts.push },
      { title: "إشعار تجريبي — استراحة الجود", body: "وصلت الإشعارات إلى جهازك بنجاح.", url: "/admin" },
      { userId: req.user!.id },
    );
    res.json(r);
  });

  return router;
}
