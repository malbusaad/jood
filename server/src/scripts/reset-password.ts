/**
 * Sets a new password for an existing admin account (e.g. a forgotten owner password).
 * Run from the server shell only — there is no password reset over the web.
 * Every signed-in session of that account is signed out.
 *
 * Usage (the password is typed hidden and passed for this one command only):
 *   read -s -p "New password: " NEW_PASSWORD; echo; NEW_PASSWORD="$NEW_PASSWORD" npm run reset-password -w server -- --email you@example.com; unset NEW_PASSWORD
 */
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { PASSWORD_MIN_LENGTH, hashPassword } from "../lib/password.js";

const { values } = parseArgs({ options: { email: { type: "string" } } });
const input = z.object({ email: z.email().transform((e) => e.toLowerCase()) }).safeParse(values);
if (!input.success) {
  console.error("Usage: NEW_PASSWORD=... npm run reset-password -w server -- --email you@example.com");
  process.exit(1);
}

const password = process.env.NEW_PASSWORD ?? "";
if (password.length < PASSWORD_MIN_LENGTH) {
  console.error(password ? `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` : "Set NEW_PASSWORD for this one command (see the usage at the top of this file).");
  process.exit(1);
}

const db = new PrismaClient();
try {
  const user = await db.user.findUnique({ where: { email: input.data.email } });
  if (!user) {
    console.error("No account with that email.");
    process.exit(1);
  }
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } }),
    db.session.deleteMany({ where: { userId: user.id } }),
    db.auditLog.create({ data: { userId: user.id, action: "user.password_reset_shell", entityType: "user", entityId: user.id } }),
  ]);
  console.log(`Password changed for ${user.email}. All its sessions were signed out. Sign in at /admin.`);
} finally {
  await db.$disconnect();
}
