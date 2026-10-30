import { PrismaClient, type UserRole } from "@prisma/client";
import request from "supertest";
import { createApp, type AppOptions } from "../src/app.js";
import { hashPassword } from "../src/lib/password.js";
import { seedInitialData } from "../src/scripts/seed-data.js";

export const db = new PrismaClient();

const TABLES = [
  "audit_logs", "notifications", "guest_access_tokens", "payments", "media_assets", "booking_locks",
  "booking_items", "bookings", "guests", "pricing_rules", "resource_conflicts", "resource_amenities",
  "booking_resources", "amenities", "sessions", "users", "site_settings",
];

/** Empties every table (test database only — guarded in tests/setup.ts). */
export async function resetDb({ seed = true } = {}) {
  await db.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  if (seed) await seedInitialData(db);
}

export function makeApp(opts: Partial<AppOptions> = {}) {
  return createApp({ db, loginLimit: 1000, apiLimit: 100_000, ...opts });
}

export const PASSWORD = "correct-horse-battery";

export async function createUser(role: UserRole = "OWNER", email = `${role.toLowerCase()}@jood.test`) {
  return db.user.create({
    data: { email, name: role === "OWNER" ? "المالك" : "موظف", role, passwordHash: await hashPassword(PASSWORD) },
  });
}

/** A supertest agent signed in as a new user with the given role. */
export async function signedIn(app: ReturnType<typeof makeApp>, role: UserRole = "OWNER") {
  const user = await createUser(role);
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email: user.email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user };
}

export async function fullResource() {
  return db.bookingResource.findFirstOrThrow({ where: { kind: "FULL" } });
}

export async function amenityBySlug(slug: string) {
  return db.amenity.findUniqueOrThrow({ where: { slug } });
}
