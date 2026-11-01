import type { NotificationType, PrismaClient } from "@prisma/client";
import { getSetting } from "../settings/registry.js";

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

  const notification = await db.notification.create({
    data: {
      type: n.type,
      title: n.title,
      body: n.body,
      bookingId: n.bookingId ?? null,
      whatsappStatus: willSend ? "PENDING" : "NOT_CONFIGURED",
    },
  });
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
