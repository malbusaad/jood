import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { HttpError, parse, uuidParam } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";
import { getSetting, phoneSchema } from "../../settings/registry.js";
import { checkWhatsAppConnection, type WhatsAppConfig, type WhatsAppTemplateSender } from "../../services/notifications.js";
import { retryMessage, sampleMessage } from "../../services/waAutomation.js";
import { DEFAULT_WA_MESSAGES, WA_KINDS, WA_VARIABLES, metaTemplateText } from "../../services/waTemplates.js";

/** «أتمتة واتساب» — owner only. */
export function whatsappRouter(db: PrismaClient, opts: { waConfig: WhatsAppConfig | null; waSend: WhatsAppTemplateSender | null }) {
  const router = Router();

  /** Connection status (reads the number's details from Meta; sends nothing) and the message catalogue. */
  router.get("/status", async (_req, res) => {
    const auto = await getSetting(db, "whatsappAutomation");
    let connection: { configured: boolean; ok: boolean; details: unknown; error: string | null } = { configured: Boolean(opts.waConfig), ok: false, details: null, error: null };
    if (opts.waConfig) {
      try {
        connection = { ...connection, ok: true, details: await checkWhatsAppConnection(opts.waConfig) };
      } catch (err) {
        connection.error = err instanceof Error ? err.message : "error";
      }
    }
    res.json({
      connection,
      mode: auto.mode,
      variables: WA_VARIABLES,
      messages: WA_KINDS.map((k) => ({
        kind: k,
        title: DEFAULT_WA_MESSAGES[k].title,
        when: DEFAULT_WA_MESSAGES[k].when,
        defaultText: DEFAULT_WA_MESSAGES[k].text,
        metaTemplate: metaTemplateText(auto.messages[k].text),
      })),
    });
  });

  router.get("/messages", async (req, res) => {
    const q = parse(
      z.object({ status: z.enum(["SCHEDULED", "SENDING", "SENT", "FAILED", "SKIPPED", "BLOCKED", "DRY_RUN"]).optional(), page: z.coerce.number().int().min(1).default(1) }),
      req.query,
    );
    const where = q.status ? { status: q.status } : {};
    const pageSize = 30;
    const [items, total, counts] = await Promise.all([
      db.whatsAppMessage.findMany({
        where,
        orderBy: [{ scheduledAt: "desc" }],
        skip: (q.page - 1) * pageSize,
        take: pageSize,
        include: { booking: { select: { id: true, reference: true, guest: { select: { name: true, phone: true } } } } },
      }),
      db.whatsAppMessage.count({ where }),
      db.whatsAppMessage.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    res.json({ items, total, page: q.page, pageSize, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) });
  });

  /** Puts a failed/blocked/skipped message back in the queue — the same message, never a duplicate. */
  router.post("/messages/:id/retry", async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    if (!(await retryMessage(db, id))) throw new HttpError(409, "لا يمكن إعادة إرسال هذه الرسالة (أُرسلت أو قيد الإرسال)");
    await audit(db, req, { action: "whatsapp.retry", entityType: "whatsapp_message", entityId: id });
    res.json({ ok: true });
  });

  /** Sends one message with sample data to a number the owner types (their own) — never to a guest's booking. */
  router.post("/test", async (req, res) => {
    const input = parse(z.object({ kind: z.enum(WA_KINDS), to: phoneSchema }), req.body);
    const auto = await getSetting(db, "whatsappAutomation");
    const sample = sampleMessage(input.kind, auto);
    if (!opts.waSend) throw new HttpError(409, "حساب واتساب غير مربوط بعد (إعدادات الخادم)");
    if (!sample.cfg.templateName) throw new HttpError(409, "حدد اسم القالب المعتمد لهذه الرسالة أولًا");
    try {
      const r = await opts.waSend(input.to, { template: sample.cfg.templateName, language: sample.cfg.language, params: sample.params });
      await audit(db, req, { action: "whatsapp.test", entityType: "whatsapp", details: { kind: input.kind, to: input.to } });
      res.json({ ok: true, id: r.id, text: sample.text });
    } catch (err) {
      throw new HttpError(502, `فشل الإرسال: ${err instanceof Error ? err.message : "error"}`);
    }
  });

  return router;
}
