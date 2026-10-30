/**
 * Creates the FIRST owner account. Refuses to run if an owner already exists
 * (further accounts are added from the admin panel by the owner).
 *
 * Usage:  npm run create-owner -w server -- --email owner@example.com --name "اسم المالك"
 * The password is typed at a hidden prompt (or read from OWNER_PASSWORD when not interactive).
 */
import { parseArgs } from "node:util";
import readline from "node:readline";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { PASSWORD_MIN_LENGTH, hashPassword } from "../lib/password.js";

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const rlAny = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    rlAny._writeToOutput = (s: string) => {
      if (!muted) rlAny.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
const input = z
  .object({ email: z.email().transform((e) => e.toLowerCase()), name: z.string().trim().min(1).max(120) })
  .safeParse(values);
if (!input.success) {
  console.error('Usage: npm run create-owner -w server -- --email you@example.com --name "Your Name"');
  process.exit(1);
}

const db = new PrismaClient();
try {
  if ((await db.user.count({ where: { role: "OWNER" } })) > 0) {
    console.error("An owner account already exists. Add more accounts from the admin panel.");
    process.exit(1);
  }

  let password = process.env.OWNER_PASSWORD ?? "";
  if (!password) {
    if (!process.stdin.isTTY) {
      console.error("No terminal: set OWNER_PASSWORD for this one command instead.");
      process.exit(1);
    }
    password = await askHidden(`Password (min ${PASSWORD_MIN_LENGTH} chars): `);
    if (password !== (await askHidden("Repeat password: "))) {
      console.error("Passwords do not match.");
      process.exit(1);
    }
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    console.error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
    process.exit(1);
  }

  const user = await db.user.create({
    data: { email: input.data.email, name: input.data.name, role: "OWNER", passwordHash: await hashPassword(password) },
  });
  await db.auditLog.create({ data: { userId: user.id, action: "user.create_owner", entityType: "user", entityId: user.id } });
  console.log(`Owner account created for ${user.email}. Sign in at /admin.`);
} finally {
  await db.$disconnect();
}
