import { createHash } from "node:crypto";

/**
 * TTLock Open Platform client (https://open.ttlock.com).
 *
 * Built from TTLock's published API docs (OAuth2 password grant at /oauth2/token; /v3/keyboardPwd/add
 * and /delete with addType/deleteType 2 = through the gateway; /v3/lock/list).
 */
export interface TTLockConfig {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  lockId: string;
  apiBase: string;
}

export function ttlockConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TTLockConfig | null {
  const { TTLOCK_CLIENT_ID, TTLOCK_CLIENT_SECRET, TTLOCK_USERNAME, TTLOCK_PASSWORD, TTLOCK_LOCK_ID } = env;
  if (!TTLOCK_CLIENT_ID || !TTLOCK_CLIENT_SECRET || !TTLOCK_USERNAME || !TTLOCK_PASSWORD || !TTLOCK_LOCK_ID) return null;
  return {
    clientId: TTLOCK_CLIENT_ID,
    clientSecret: TTLOCK_CLIENT_SECRET,
    username: TTLOCK_USERNAME,
    password: TTLOCK_PASSWORD,
    lockId: TTLOCK_LOCK_ID,
    apiBase: (env.TTLOCK_API_BASE || "https://euapi.ttlock.com").replace(/\/$/, ""),
  };
}

export class TTLockError extends Error {
  constructor(
    message: string,
    public code?: number,
  ) {
    super(message);
  }
}

export interface LockClient {
  lockId: string;
  addPasscode(p: { code: string; name: string; startsAt: Date; endsAt: Date }): Promise<{ externalId: string }>;
  deletePasscode(externalId: string): Promise<void>;
  listLocks(): Promise<{ lockId: string; name: string; hasGateway: boolean | null; battery: number | null; authorizedAdmin: boolean }[]>;
}

type Json = Record<string, unknown>;

export function ttlockClient(config: TTLockConfig, fetchImpl: typeof fetch = fetch): LockClient {
  let token: { value: string; expiresAt: number } | null = null;

  async function post(path: string, params: Record<string, string | number>): Promise<Json> {
    const res = await fetchImpl(`${config.apiBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)])).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as Json | null;
    if (!res.ok || !body) throw new TTLockError(`TTLock HTTP ${res.status}`);
    const errcode = Number(body.errcode ?? 0);
    if (errcode !== 0) throw new TTLockError(`TTLock ${errcode}: ${String(body.errmsg ?? body.description ?? "error")}`.slice(0, 400), errcode);
    return body;
  }

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value;
    // Per TTLock's current "Get access token" docs: TTLock App account (never the open-platform developer
    // account) and the password as a lowercase MD5 hex digest.
    const body = await post("/oauth2/token", {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      username: config.username,
      password: createHash("md5").update(config.password).digest("hex"),
    });
    if (typeof body.access_token !== "string") throw new TTLockError(`TTLock login failed: ${String(body.errmsg ?? body.error_description ?? "no token")}`);
    token = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000 };
    return token.value;
  }

  async function call(path: string, params: Record<string, string | number>) {
    const run = async () => post(path, { clientId: config.clientId, accessToken: await accessToken(), date: Date.now(), ...params });
    try {
      return await run();
    } catch (err) {
      // 10003/10004 = invalid or expired token: log in again once.
      if (err instanceof TTLockError && (err.code === 10003 || err.code === 10004)) {
        token = null;
        return run();
      }
      throw err;
    }
  }

  return {
    lockId: config.lockId,
    async addPasscode({ code, name, startsAt, endsAt }) {
      const body = await call("/v3/keyboardPwd/add", {
        lockId: config.lockId,
        keyboardPwd: code,
        keyboardPwdName: name,
        startDate: startsAt.getTime(),
        endDate: endsAt.getTime(),
        addType: 2, // through the gateway
      });
      if (body.keyboardPwdId === undefined) throw new TTLockError("TTLock did not return a passcode id");
      return { externalId: String(body.keyboardPwdId) };
    },
    async deletePasscode(externalId) {
      await call("/v3/keyboardPwd/delete", { lockId: config.lockId, keyboardPwdId: externalId, deleteType: 2 });
    },
    async listLocks() {
      // lock/list returns only locks the account owns. A lock shared with the account as an
      // "authorized admin" eKey (the recommended setup) appears only in key/list, so merge both.
      const [owned, keys] = await Promise.all([
        call("/v3/lock/list", { pageNo: 1, pageSize: 50 }),
        call("/v3/key/list", { pageNo: 1, pageSize: 50 }),
      ]);
      const byId = new Map<string, { lockId: string; name: string; hasGateway: boolean | null; battery: number | null; authorizedAdmin: boolean }>();
      for (const l of ((owned.list as Json[] | undefined) ?? [])) {
        byId.set(String(l.lockId), {
          lockId: String(l.lockId),
          name: String(l.lockAlias ?? l.lockName ?? ""),
          hasGateway: l.hasGateway === undefined ? null : Number(l.hasGateway) === 1,
          battery: l.electricQuantity === undefined ? null : Number(l.electricQuantity),
          authorizedAdmin: true,
        });
      }
      for (const k of ((keys.list as Json[] | undefined) ?? [])) {
        const id = String(k.lockId);
        if (byId.has(id)) continue;
        byId.set(id, {
          lockId: id,
          name: String(k.lockAlias ?? k.lockName ?? ""),
          hasGateway: k.hasGateway === undefined ? null : Number(k.hasGateway) === 1,
          battery: k.electricQuantity === undefined ? null : Number(k.electricQuantity),
          // keyRight 1 = authorized admin: may add and delete passcodes.
          authorizedAdmin: Number(k.keyRight) === 1,
        });
      }
      return [...byId.values()];
    },
  };
}
