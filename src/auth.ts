import { createHmac, timingSafeEqual } from "node:crypto";
import { type DB, get, run } from "./db";

export type UserRow = {
  id: number;
  handle: string;
  created_at: number;
};

const COOKIE_NAME = "fokus_session";
const SESSION_TTL_SECONDS = 30 * 24 * 3600;

export type Auth = ReturnType<typeof makeAuth>;

/**
 * Passwordless: an identity is a cookie. `handle` is just a readable label
 * (a uuid for minted identities, the legacy username for imported rows).
 */
export function makeAuth(db: DB, secret: string) {
  const hmac = (data: string) => createHmac("sha256", secret).update(data).digest("base64url");
  const safeEqual = (a: string, b: string) => {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  };

  function sign(userId: number): string {
    const payload = `${userId}.${Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS}`;
    return `${payload}.${hmac(payload)}`;
  }

  function verifyCookie(value: string | undefined): number | null {
    if (!value) return null;
    const [userId, expiry, signature] = value.split(".");
    if (!userId || !expiry || !signature) return null;
    if (!safeEqual(hmac(`${userId}.${expiry}`), signature)) return null;
    if (Number(expiry) * 1000 < Date.now()) return null;
    const id = Number(userId);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  return {
    cookieHeader(userId: number): string {
      return `${COOKIE_NAME}=${sign(userId)}; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
    },
    userFromCookieHeader(header: string | null): UserRow | null {
      const raw = header
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${COOKIE_NAME}=`))
        ?.slice(COOKIE_NAME.length + 1);
      const userId = verifyCookie(raw);
      if (userId === null) return null;
      return get<UserRow>(db, "SELECT * FROM users WHERE id = ?", userId) ?? null;
    },
    getUserById(id: number): UserRow | undefined {
      return get<UserRow>(db, "SELECT * FROM users WHERE id = ?", id);
    },
    getUserByHandle(handle: string): UserRow | undefined {
      return get<UserRow>(db, "SELECT * FROM users WHERE handle = ?", handle);
    },
    /** mint a fresh anonymous identity */
    createUser(): UserRow {
      const handle = crypto.randomUUID();
      run(db, "INSERT INTO users (handle, created_at) VALUES (?, ?)", handle, Date.now());
      const created = get<UserRow>(db, "SELECT * FROM users WHERE handle = ?", handle);
      if (!created) throw new Error("could not create user");
      return created;
    },
  };
}
