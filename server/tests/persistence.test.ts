import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const KEY = "__test_persistence";

describe("data persistence", () => {
  afterAll(async () => {
    const db = new PrismaClient();
    await db.siteSetting.deleteMany({ where: { key: KEY } });
    await db.$disconnect();
  });

  it("keeps data written by one connection after it is closed (simulated restart)", async () => {
    const first = new PrismaClient();
    await first.siteSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: { checkIn: "14:00" } },
      update: { value: { checkIn: "14:00" } },
    });
    await first.$disconnect();

    const second = new PrismaClient();
    const row = await second.siteSetting.findUnique({ where: { key: KEY } });
    await second.$disconnect();

    expect(row?.value).toEqual({ checkIn: "14:00" });
  });
});
