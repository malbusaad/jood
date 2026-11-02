import type { Request } from "express";
import { z, type ZodType } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Validates input against a schema; throws 400 with field-level issues on failure. */
export function parse<T extends ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new HttpError(400, "البيانات المدخلة غير صحيحة", issues);
  }
  return result.data;
}

export function clientIp(req: Request): string | null {
  return req.ip ?? null;
}

export const uuidParam = z.object({ id: z.uuid() });
