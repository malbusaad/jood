import { describe, expect, it, vi } from "vitest";
import { metaWhatsAppSender, whatsAppConfigFromEnv } from "../src/services/notifications.js";

describe("WhatsApp Cloud API sender", () => {
  it("is not configured without a token and phone number id", () => {
    expect(whatsAppConfigFromEnv({})).toBeNull();
    expect(whatsAppConfigFromEnv({ WHATSAPP_TOKEN: "t" })).toBeNull();
  });

  it("sends an approved template message with the booking values", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "x" }] }), { status: 200 }));
    const cfg = whatsAppConfigFromEnv({ WHATSAPP_TOKEN: "secret-token", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_TEMPLATE_NAME: "new_booking" })!;
    await metaWhatsAppSender(cfg, fetchMock as unknown as typeof fetch)("966555000111", { text: "x", params: ["JD-000001", "ضيف"] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v22.0/123/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
    expect(JSON.parse(String(init.body))).toEqual({
      messaging_product: "whatsapp",
      to: "966555000111",
      type: "template",
      template: {
        name: "new_booking",
        language: { code: "ar" },
        components: [{ type: "body", parameters: [{ type: "text", text: "JD-000001" }, { type: "text", text: "ضيف" }] }],
      },
    });
  });

  it("falls back to a text message when no template is configured", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const cfg = whatsAppConfigFromEnv({ WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1" })!;
    await metaWhatsAppSender(cfg, fetchMock as unknown as typeof fetch)("966", { text: "طلب جديد", params: [] });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ type: "text", text: { body: "طلب جديد" } });
  });

  it("reports API errors without leaking the token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token", code: 190 } }), { status: 401 }));
    const cfg = whatsAppConfigFromEnv({ WHATSAPP_TOKEN: "secret-token", WHATSAPP_PHONE_NUMBER_ID: "1" })!;
    const err = await metaWhatsAppSender(cfg, fetchMock as unknown as typeof fetch)("966", { text: "x", params: [] }).catch((e: Error) => e);
    expect(String(err)).toContain("401 (190)");
    expect(String(err)).not.toContain("secret-token");
  });
});
