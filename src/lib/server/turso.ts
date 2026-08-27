// ZYVRO — server-side Turso access (never imported by client code)
import { createClient, type Client, type InValue, type ResultSet } from "@libsql/client";
import { markerCharacterFor } from "@/lib/marker-style";

let _client: Client | null = null;

/**
 * Turso's HTTP endpoint intermittently fails individual statements with a
 * transient `SERVER_ERROR` (HTTP 400/5xx) when several requests race — seen
 * in production as random 500s on routes that work fine on retry. A short
 * backoff-and-retry turns that into reliable behavior for EVERY route.
 */
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String((e as Error)?.message ?? e);
      const transient = /SERVER_ERROR|HTTP status|status [45]|timed out|fetch failed|socket/i.test(msg);
      if (!transient || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 120 * (i + 1)));
    }
  }
  throw lastErr;
}

function wrapClient(base: Client): Client {
  const wrapped = Object.create(base) as Client;
  const origExecute = base.execute.bind(base);
  wrapped.execute = ((stmt: string | { sql: string; args?: InValue[] }, args?: InValue[]) =>
    withRetry(() => origExecute(stmt as string, args))) as Client["execute"];
  // Methods backed by PRIVATE class fields must be invoked with the REAL
  // client as `this` — through the Object.create prototype chain the private
  // field check throws "Cannot access invalid private field" in production
  // builds. Bind the ones the app uses.
  wrapped.batch = base.batch.bind(base);
  wrapped.executeMultiple = base.executeMultiple.bind(base);
  wrapped.transaction = base.transaction.bind(base);
  return wrapped;
}

export function turso(): Client {
  if (!_client) {
    const url = process.env.TURSO_DATABASE_URL;
    const token = process.env.TURSO_AUTH_TOKEN;
    if (!url || !token) {
      throw new Error("Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN");
    }
    _client = wrapClient(createClient({ url, authToken: token }));
  }
  return _client;
}

export function nowMs(): number {
  return Date.now();
}

export interface GroupRow {
  id: string;
  name: string;
  code: string;
}

/** Resolve a group by its shareable code; create it on first use. */
export async function getOrCreateGroupByCode(code: string): Promise<GroupRow> {
  const db = turso();
  const found = await db.execute({
    sql: "SELECT id, name, code FROM groups WHERE code = ? LIMIT 1",
    args: [code],
  });
  if (found.rows.length > 0) {
    const r = found.rows[0];
    return { id: String(r.id), name: String(r.name), code: String(r.code) };
  }
  const id = `grp_${crypto.randomUUID()}`;
  const name = code === "ZYVRO" ? "ZYVRO Circle" : `ZYVRO ${code}`;
  await db.execute({
    sql: "INSERT INTO groups (id, name, code, created_at) VALUES (?, ?, ?, ?)",
    args: [id, name, code, nowMs()],
  });
  return { id, name, code };
}

export async function getGroupById(id: string): Promise<GroupRow | null> {
  const db = turso();
  const found = await db.execute({
    sql: "SELECT id, name, code FROM groups WHERE id = ? LIMIT 1",
    args: [id],
  });
  if (found.rows.length === 0) return null;
  const r = found.rows[0];
  return { id: String(r.id), name: String(r.name), code: String(r.code) };
}

/** Accepts either the internal id (grp_…) or the shareable code (ZYVRO…). */
export async function resolveGroup(idOrCode: string): Promise<GroupRow | null> {
  if (idOrCode.startsWith("grp_")) {
    const byId = await getGroupById(idOrCode);
    if (byId) return byId;
  }
  if (/^[A-Z0-9]{3,12}$/.test(idOrCode)) {
    return getOrCreateGroupByCode(idOrCode);
  }
  return getGroupById(idOrCode);
}

export interface UserRow {
  id: string;
  client_id: string;
  display_name: string;
  marker_character: string;
  sharing_enabled: boolean;
}

export async function upsertUser(clientId: string, displayName: string): Promise<UserRow> {
  const db = turso();
  const found = await db.execute({
    sql: "SELECT id, client_id, display_name, marker_character, sharing_enabled FROM users WHERE client_id = ? LIMIT 1",
    args: [clientId],
  });
  const ts = nowMs();
  if (found.rows.length > 0) {
    const r = found.rows[0];
    // Keep marker character + sharing preference; refresh name & timestamp.
    await db.execute({
      sql: "UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?",
      args: [displayName, ts, String(r.id)],
    });
    return {
      id: String(r.id),
      client_id: String(r.client_id),
      display_name: displayName,
      marker_character: String(r.marker_character),
      sharing_enabled: Number(r.sharing_enabled) === 1,
    };
  }
  const id = `usr_${crypto.randomUUID()}`;
  const marker = markerCharacterFor(clientId);
  await db.execute({
    sql: "INSERT INTO users (id, client_id, display_name, marker_character, sharing_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
    args: [id, clientId, displayName, marker, ts, ts],
  });
  return { id, client_id: clientId, display_name: displayName, marker_character: marker, sharing_enabled: true };
}

export async function addMembership(groupId: string, userId: string): Promise<void> {
  const db = turso();
  await db.execute({
    sql: "INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    args: [groupId, userId, nowMs()],
  });
}

export async function findUserByClientId(clientId: string): Promise<UserRow | null> {
  const db = turso();
  const res = await db.execute({
    sql: "SELECT id, client_id, display_name, marker_character, sharing_enabled FROM users WHERE client_id = ? LIMIT 1",
    args: [clientId],
  });
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: String(r.id),
    client_id: String(r.client_id),
    display_name: String(r.display_name),
    marker_character: String(r.marker_character),
    sharing_enabled: Number(r.sharing_enabled) === 1,
  };
}

/** The member of a group whose display name matches (case-insensitive). */
export async function findGroupMemberByName(groupId: string, displayName: string): Promise<UserRow | null> {
  const db = turso();
  const res = await db.execute({
    sql: `SELECT u.id, u.client_id, u.display_name, u.marker_character, u.sharing_enabled
          FROM group_members gm
          JOIN users u ON u.id = gm.user_id
          WHERE gm.group_id = ? AND lower(u.display_name) = lower(?)
          LIMIT 1`,
    args: [groupId, displayName],
  });
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: String(r.id),
    client_id: String(r.client_id),
    display_name: String(r.display_name),
    marker_character: String(r.marker_character),
    sharing_enabled: Number(r.sharing_enabled) === 1,
  };
}

/**
 * Re-claim an existing profile from a new device identity: the same human
 * re-joined (cleared browser / new phone) and entered their name again.
 * Moving client_id onto the existing row keeps ONE profile — and one marker —
 * instead of creating a duplicate.
 */
export async function claimUserClientId(userId: string, clientId: string, displayName: string): Promise<UserRow> {
  const db = turso();
  const ts = nowMs();
  await db.execute({
    sql: "UPDATE users SET client_id = ?, display_name = ?, updated_at = ? WHERE id = ?",
    args: [clientId, displayName, ts, userId],
  });
  const claimed = await db.execute({
    sql: "SELECT id, client_id, display_name, marker_character, sharing_enabled FROM users WHERE id = ? LIMIT 1",
    args: [userId],
  });
  const r = claimed.rows[0];
  return {
    id: String(r.id),
    client_id: String(r.client_id),
    display_name: String(r.display_name),
    marker_character: String(r.marker_character),
    sharing_enabled: Number(r.sharing_enabled) === 1,
  };
}

/**
 * ATOMIC fresh-identity registration — closes the duplicate-profile race.
 *
 * The old flow did check-namesake → (claim | insert) as separate round-trips;
 * two concurrent registers for the same name (double-tap on "Enter ZYVRO"
 * before the first response saves the identity, or the same person opening
 * the app in two browser contexts at once) both saw "no namesake" and BOTH
 * inserted → one human, two profiles, two markers.
 *
 * Here the claim and the insert run inside ONE write transaction (libsql
 * batch): statement 1 adopts the namesake row onto our client_id when one
 * exists; statement 2 inserts a fresh row only when our client_id still has
 * no row (i.e. statement 1 did not adopt us); statement 3 attaches membership
 * to whichever row now carries our client_id; statement 4 reads it back.
 * SQLite serializes write transactions, so concurrent registers can no
 * longer both create rows.
 */
export async function registerFreshUser(groupId: string, clientId: string, displayName: string): Promise<UserRow> {
  const db = turso();
  const id = `usr_${crypto.randomUUID()}`;
  const marker = markerCharacterFor(clientId);
  const ts = nowMs();
  const results = await db.batch(
    [
      {
        sql: `UPDATE users SET client_id = ?, display_name = ?, updated_at = ?
              WHERE id = (
                SELECT u.id FROM group_members gm
                JOIN users u ON u.id = gm.user_id
                WHERE gm.group_id = ? AND lower(u.display_name) = lower(?)
                LIMIT 1
              )
              AND NOT EXISTS (SELECT 1 FROM users WHERE client_id = ?)`,
        args: [clientId, displayName, ts, groupId, displayName, clientId],
      },
      {
        sql: `INSERT INTO users (id, client_id, display_name, marker_character, sharing_enabled, created_at, updated_at)
              SELECT ?, ?, ?, ?, 1, ?, ?
              WHERE NOT EXISTS (SELECT 1 FROM users WHERE client_id = ?)`,
        args: [id, clientId, displayName, marker, ts, ts, clientId],
      },
      {
        sql: `INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at)
              SELECT ?, id, ? FROM users WHERE client_id = ?`,
        args: [groupId, ts, clientId],
      },
      {
        sql: "SELECT id, client_id, display_name, marker_character, sharing_enabled FROM users WHERE client_id = ? LIMIT 1",
        args: [clientId],
      },
    ],
    "write"
  );
  const row = results[3]?.rows?.[0];
  if (!row) throw new Error("registerFreshUser: no user row after batch");
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    display_name: String(row.display_name),
    marker_character: String(row.marker_character),
    sharing_enabled: Number(row.sharing_enabled) === 1,
  };
}

/** Groups a user currently belongs to (internal ids). */
export async function userGroupIds(userId: string): Promise<string[]> {
  const db = turso();
  const res = await db.execute({
    sql: "SELECT group_id FROM group_members WHERE user_id = ?",
    args: [userId],
  });
  return res.rows.map((r) => String(r.group_id));
}

/** Hard-delete a profile everywhere: memberships, stored fixes, the user row. */
export async function deleteUserData(userId: string): Promise<void> {
  const db = turso();
  await db.execute({ sql: "DELETE FROM locations WHERE user_id = ?", args: [userId] });
  await db.execute({ sql: "DELETE FROM group_members WHERE user_id = ?", args: [userId] });
  await db.execute({ sql: "DELETE FROM users WHERE id = ?", args: [userId] });
}

/** Server-side membership gate — the core access-control primitive. */
export async function isMember(groupId: string, userId: string): Promise<boolean> {
  const db = turso();
  const res = await db.execute({
    sql: "SELECT 1 AS ok FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1",
    args: [groupId, userId],
  });
  return res.rows.length > 0;
}

export async function setUserSharing(userId: string, enabled: boolean): Promise<void> {
  const db = turso();
  await db.execute({
    sql: "UPDATE users SET sharing_enabled = ?, updated_at = ? WHERE id = ?",
    args: [enabled ? 1 : 0, nowMs(), userId],
  });
  if (!enabled) {
    // Stopped sharing: drop the last stored fix so nothing stale leaks anywhere.
    await db.execute({ sql: "DELETE FROM locations WHERE user_id = ?", args: [userId] });
  }
}

export interface LocationUpsert {
  userId: string;
  groupId: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  heading_deg: number | null;
  recorded_at: number;
}

export async function upsertLocation(fix: LocationUpsert): Promise<void> {
  const db = turso();
  const ts = nowMs();
  await db.execute({
    sql: `INSERT INTO locations (user_id, group_id, latitude, longitude, accuracy_m, speed_mps, heading_deg, recorded_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            group_id = excluded.group_id,
            latitude = excluded.latitude,
            longitude = excluded.longitude,
            accuracy_m = excluded.accuracy_m,
            speed_mps = excluded.speed_mps,
            heading_deg = excluded.heading_deg,
            recorded_at = excluded.recorded_at,
            last_seen_at = excluded.last_seen_at`,
    args: [
      fix.userId,
      fix.groupId,
      fix.latitude,
      fix.longitude,
      fix.accuracy_m,
      fix.speed_mps,
      fix.heading_deg,
      fix.recorded_at,
      ts,
    ],
  });
  await db.execute({
    sql: "UPDATE users SET last_seen_at = ?, updated_at = ? WHERE id = ?",
    args: [ts, ts, fix.userId],
  });
}
