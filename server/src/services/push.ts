import type { PrismaClient } from "@prisma/client";
import type { SecretBox } from "../lib/secretBox.js";

/**
 * Phone/browser notifications for the admin team (Web Push, free, no third party).
 * The VAPID key pair is created once and kept in the database (private key encrypted),
 * so nothing needs to be configured on the server.
 */
const KEYS = "vapidKeys";

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export interface PushMessage {
  title: string;
  body: string;
  /** Page to open when the notification is tapped, e.g. /admin/bookings/… */
  url?: string;
}
/** Delivers one message to one device. Throws an error with `statusCode` on failure. */
export type PushSend = (
  sub: PushSubscriptionInput,
  payload: string,
  vapid: { subject: string; publicKey: string; privateKey: string },
) => Promise<void>;

export async function webPushSend(sub: PushSubscriptionInput, payload: string, vapid: { subject: string; publicKey: string; privateKey: string }) {
  const { sendNotification } = await import("web-push");
  await sendNotification(sub, payload, { vapidDetails: vapid, TTL: 24 * 3600, urgency: "high", timeout: 10_000 });
}

export async function vapidKeys(db: PrismaClient, box: SecretBox): Promise<{ publicKey: string; privateKey: string }> {
  const read = async () => {
    const row = await db.siteSetting.findUnique({ where: { key: KEYS } });
    const v = row?.value as { publicKey?: string; privateKeyEnc?: string } | undefined;
    if (!v?.publicKey || !v.privateKeyEnc) return null;
    const privateKey = box.open(v.privateKeyEnc);
    return privateKey ? { publicKey: v.publicKey, privateKey } : null;
  };
  const existing = await read();
  if (existing) return existing;
  const { generateVAPIDKeys } = await import("web-push");
  const k = generateVAPIDKeys();
  // If two requests race, the first one wins and both use its keys.
  await db.siteSetting.createMany({ data: [{ key: KEYS, value: { publicKey: k.publicKey, privateKeyEnc: box.seal(k.privateKey) } }], skipDuplicates: true });
  return (await read())!;
}

export interface PushDeps {
  db: PrismaClient;
  box: SecretBox;
  send: PushSend;
  /** Contact for the push services (required by the standard). */
  subject: string;
}

/** Sends to every registered device (optionally of one user). Expired devices are removed. */
export async function pushToAdmins(deps: PushDeps, msg: PushMessage, opts: { userId?: string } = {}) {
  const subs = await deps.db.pushSubscription.findMany({ where: opts.userId ? { userId: opts.userId } : { user: { active: true } } });
  if (subs.length === 0) return { sent: 0, failed: 0 };
  const keys = await vapidKeys(deps.db, deps.box);
  const payload = JSON.stringify({ title: msg.title, body: msg.body.slice(0, 500), url: msg.url ?? "/admin/notifications" });
  let sent = 0;
  let failed = 0;
  for (const s of subs) {
    try {
      await deps.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { subject: deps.subject, ...keys });
      await deps.db.pushSubscription.update({ where: { id: s.id }, data: { lastSuccessAt: new Date(), lastError: null } });
      sent++;
    } catch (err) {
      failed++;
      const code = (err as { statusCode?: number }).statusCode;
      // 404/410: the device unsubscribed or the app was removed — forget it.
      if (code === 404 || code === 410) await deps.db.pushSubscription.deleteMany({ where: { id: s.id } });
      else {
        const reason = `${code ?? ""} ${err instanceof Error ? err.message : "error"}`.trim().slice(0, 300);
        await deps.db.pushSubscription.updateMany({ where: { id: s.id }, data: { lastError: reason } });
      }
    }
  }
  return { sent, failed };
}
