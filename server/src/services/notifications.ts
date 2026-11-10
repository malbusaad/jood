import type { NotificationType, PrismaClient } from "@prisma/client";
import { getSetting } from "../settings/registry.js";
import { pushToAdmins, type PushDeps } from "./push.js";

/** Set once at start-up: every owner notification is also pushed to registered phones. */
let pushDeps: PushDeps | null = null;
export function enablePushNotifications(deps: PushDeps | null) {
  pushDeps = deps;
}

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  /** Approved template name. Business-initiated WhatsApp messages need an approved template. */
  templateName: string | null;
  templateLanguage: string;
  apiVersion: string;
}

/** Sends one WhatsApp message to `to`. Throws on failure with a short, secret-free reason. */
export type WhatsAppSender = (to: string, message: { text: string; params: string[] }) => Promise<void>;

export function whatsAppConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WhatsAppConfig | null {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) return null;
  return {
    token: env.WHATSAPP_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    templateName: env.WHATSAPP_TEMPLATE_NAME || null,
    templateLanguage: env.WHATSAPP_TEMPLATE_LANG || "ar",
    apiVersion: env.WHATSAPP_API_VERSION || "v22.0",
  };
}

/** WhatsApp Business Cloud API (Meta). Not verified against a live account until the owner provides one. */
export function metaWhatsAppSender(config: WhatsAppConfig, fetchImpl: typeof fetch = fetch): WhatsAppSender {
  return async (to, message) => {
    const body = config.templateName
      ? {
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: config.templateName,
            language: { code: config.templateLanguage },
            components: [{ type: "body", parameters: message.params.map((text) => ({ type: "text", text })) }],
          },
        }
      : { messaging_product: "whatsapp", to, type: "text", text: { body: message.text } };

    const res = await fetchImpl(`https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { message?: string; code?: number } } | null;
      throw new Error(`WhatsApp API ${res.status}${err?.error?.code ? ` (${err.error.code})` : ""}: ${err?.error?.message ?? "request failed"}`.slice(0, 480));
    }
  };
}

export interface OwnerNotification {
  type: NotificationType;
  title: string;
  body: string;
  bookingId?: string;
  /** Values for the WhatsApp template body, in order. */
  whatsappParams?: string[];
}

/**
 * Records a notification for the admin panel, then — when the owner enabled it and the API is
 * configured — sends it to the owner's WhatsApp. A WhatsApp failure never loses the in-panel notification.
 */
export async function notifyOwner(db: PrismaClient, n: OwnerNotification, sender: WhatsAppSender | null) {
  const settings = await getSetting(db, "notifications");
  const willSend = Boolean(sender && settings.whatsappEnabled && settings.ownerWhatsapp);

  const created = await db.notification.create({
    data: {
      type: n.type,
      title: n.title,
      body: n.body,
      bookingId: n.bookingId ?? null,
      whatsappStatus: willSend ? "PENDING" : "NOT_CONFIGURED",
    },
  });
  const notification = created;
  // Phone notification (free Web Push). Never blocks or breaks the booking flow.
  if (pushDeps) {
    await pushToAdmins(pushDeps, { title: n.title, body: n.body, url: n.bookingId ? `/admin/bookings/${n.bookingId}` : "/admin/notifications" }).catch((err) =>
      console.error("[push] failed:", err instanceof Error ? err.message : err),
    );
  }
  if (!willSend) return notification;

  try {
    await sender!(settings.ownerWhatsapp!, { text: `${n.title}\n${n.body}`, params: n.whatsappParams ?? [n.title] });
    return db.notification.update({ where: { id: notification.id }, data: { whatsappStatus: "SENT" } });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    console.error("[whatsapp] send failed:", reason);
    return db.notification.update({
      where: { id: notification.id },
      data: { whatsappStatus: "FAILED", whatsappError: reason.slice(0, 500) },
    });
  }
}

/** Sends one approved template message. Returns the provider's message id. */
export type WhatsAppTemplateSender = (to: string, msg: { template: string; language: string; params: string[] }) => Promise<{ id: string | null }>;

export function metaTemplateSender(config: WhatsAppConfig, fetchImpl: typeof fetch = fetch): WhatsAppTemplateSender {
  return async (to, msg) => {
    const res = await fetchImpl(`https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: msg.template,
          language: { code: msg.language },
          components: msg.params.length ? [{ type: "body", parameters: msg.params.map((text) => ({ type: "text", text })) }] : [],
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as { messages?: { id?: string }[]; error?: { message?: string; code?: number } } | null;
    if (!res.ok) {
      throw new Error(`WhatsApp API ${res.status}${body?.error?.code ? ` (${body.error.code})` : ""}: ${body?.error?.message ?? "request failed"}`.slice(0, 480));
    }
    return { id: body?.messages?.[0]?.id ?? null };
  };
}

/** Connection check: reads the phone number's details from Meta (no message is sent). */
export async function checkWhatsAppConnection(config: WhatsAppConfig, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(
    `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,name_status`,
    { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(8000) },
  );
  const body = (await res.json().catch(() => null)) as Record<string, unknown> & { error?: { message?: string; code?: number } };
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}${body?.error?.code ? ` (${body.error.code})` : ""}: ${body?.error?.message ?? "request failed"}`.slice(0, 480));
  return {
    displayPhoneNumber: (body.display_phone_number as string) ?? null,
    verifiedName: (body.verified_name as string) ?? null,
    qualityRating: (body.quality_rating as string) ?? null,
    nameStatus: (body.name_status as string) ?? null,
  };
}
