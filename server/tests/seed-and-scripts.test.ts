import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { db, resetDb } from "./helpers.js";
import { seedInitialData } from "../src/scripts/seed-data.js";
import { verifyPassword } from "../src/lib/password.js";

const run = promisify(execFile);
const serverDir = path.resolve(import.meta.dirname, "..");

beforeEach(() => resetDb({ seed: false }));
afterAll(() => db.$disconnect());

describe("seed", () => {
  it("creates the approved amenities, the full rest house and its weekday prices — and nothing else", async () => {
    await seedInitialData(db);
    expect(await db.amenity.count()).toBe(11);
    expect(await db.amenity.count({ where: { name: { contains: "مسبح" } } })).toBe(0);
    const resources = await db.bookingResource.findMany({ include: { amenities: true, pricingRules: true } });
    expect(resources).toHaveLength(1); // no invented parts
    expect(resources[0]!.kind).toBe("FULL");
    expect(resources[0]!.amenities).toHaveLength(11);
    expect(resources[0]!.pricingRules.map((r) => [r.daysOfWeek, r.price.toFixed(0)])).toEqual(
      expect.arrayContaining([[[0, 1, 2, 3], "950"], [[4, 5, 6], "1200"]]),
    );
    expect(await db.user.count()).toBe(0); // no default admin account
  });

  it("is idempotent and never overwrites owner edits", async () => {
    await seedInitialData(db);
    await db.amenity.update({ where: { slug: "tent" }, data: { name: "الخيمة الكبيرة" } });
    await db.pricingRule.updateMany({ where: { price: 950 }, data: { price: 990 } });
    await seedInitialData(db);
    expect(await db.amenity.count()).toBe(11);
    expect((await db.amenity.findUniqueOrThrow({ where: { slug: "tent" } })).name).toBe("الخيمة الكبيرة");
    expect(await db.pricingRule.count()).toBe(2);
    expect(await db.pricingRule.count({ where: { price: 990 } })).toBe(1);
  });
});

describe("create-owner script", () => {
  const script = ["--import", "tsx", "src/scripts/create-owner.ts"];
  const env = { ...process.env, OWNER_PASSWORD: "first-owner-password" };

  it("creates the first owner once, then refuses", async () => {
    const first = await run("node", [...script, "--email", "Owner@Jood.test", "--name", "المالك"], { cwd: serverDir, env });
    expect(first.stdout).toMatch(/Owner account created/);
    expect(first.stdout + first.stderr).not.toContain("first-owner-password");
    const owner = await db.user.findUniqueOrThrow({ where: { email: "owner@jood.test" } });
    expect(owner.role).toBe("OWNER");
    expect(await verifyPassword("first-owner-password", owner.passwordHash)).toBe(true);

    await expect(run("node", [...script, "--email", "second@jood.test", "--name", "x"], { cwd: serverDir, env })).rejects.toMatchObject({
      stderr: expect.stringMatching(/already exists/),
    });
    expect(await db.user.count()).toBe(1);
  });

  it("rejects short passwords", async () => {
    await expect(
      run("node", [...script, "--email", "o@jood.test", "--name", "x"], { cwd: serverDir, env: { ...env, OWNER_PASSWORD: "short" } }),
    ).rejects.toMatchObject({ stderr: expect.stringMatching(/at least/) });
    expect(await db.user.count()).toBe(0);
  });
});

describe("migrations", () => {
  it("are all applied to the database", async () => {
    const { stdout } = await run("npx", ["prisma", "migrate", "status"], { cwd: serverDir, env: process.env });
    expect(stdout).toMatch(/Database schema is up to date/);
  });
});
