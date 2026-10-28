import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";

const valid = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  SESSION_SECRET: "x".repeat(32),
};

describe("loadEnv", () => {
  it("accepts a valid configuration and applies defaults", () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe("development");
  });

  it("rejects a short SESSION_SECRET", () => {
    expect(() => loadEnv({ ...valid, SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
  });

  it("rejects a missing DATABASE_URL without leaking secret values", () => {
    const secret = "super-secret-value-that-must-not-leak-0000";
    try {
      loadEnv({ SESSION_SECRET: secret });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toMatch(/DATABASE_URL/);
      expect((err as Error).message).not.toContain(secret);
    }
  });
});
