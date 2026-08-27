import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { findUserByClientId, isMember, resolveGroup, turso } from "@/lib/server/turso";
import type { MemberState } from "@/lib/types";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  client_id: z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/),
  group_id: z.string().min(3).max(64).regex(/^[A-Za-z0-9_-]+$/),
});

export async function GET(req: NextRequest) {
  const parsed = QuerySchema.safeParse({
    client_id: req.nextUrl.searchParams.get("client_id") ?? undefined,
    group_id: req.nextUrl.searchParams.get("group_id") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }
  const { client_id, group_id } = parsed.data;

  try {
    // Accepts the internal group id or the shareable code.
    const group = await resolveGroup(group_id);
    if (!group) return NextResponse.json({ error: "Unknown group" }, { status: 404 });

    const requester = await findUserByClientId(client_id);
    if (!requester) return NextResponse.json({ error: "Unknown client" }, { status: 403 });

    // Access control: a user must belong to the group to see its members.
    if (!(await isMember(group.id, requester.id))) {
      return NextResponse.json({ error: "Not a member of this group" }, { status: 403 });
    }

    const db = turso();
    const res = await db.execute({
      sql: `SELECT u.client_id, u.display_name, u.marker_character, u.sharing_enabled, u.last_seen_at,
                   l.latitude, l.longitude, l.accuracy_m, l.recorded_at, l.last_seen_at AS loc_seen
            FROM group_members gm
            JOIN users u ON u.id = gm.user_id
            LEFT JOIN locations l ON l.user_id = u.id
            WHERE gm.group_id = ?
            ORDER BY u.created_at ASC`,
      args: [group.id],
    });

    const members: MemberState[] = res.rows.map((r) => {
      const isSelf = String(r.client_id) === client_id;
      const sharing = Number(r.sharing_enabled) === 1;
      const hasFix = r.latitude !== null && r.longitude !== null;
      // Coordinates of members who paused sharing never leave the server.
      const expose = sharing || isSelf;
      return {
        client_id: String(r.client_id),
        display_name: String(r.display_name),
        marker_character: String(r.marker_character),
        sharing,
        is_self: isSelf,
        lat: expose && hasFix ? Number(r.latitude) : null,
        lng: expose && hasFix ? Number(r.longitude) : null,
        accuracy_m: expose && r.accuracy_m !== null ? Number(r.accuracy_m) : null,
        recorded_at: expose && r.recorded_at !== null ? Number(r.recorded_at) : null,
        last_seen_at: r.loc_seen !== null ? Number(r.loc_seen) : r.last_seen_at !== null ? Number(r.last_seen_at) : null,
      };
    });

    // Server-side namesake dedupe: one human must never reach a client as
    // two members (two device identities of the same person can exist
    // transiently in the DB). Keep only the freshest row per normalized
    // name — the client store applies the same rule to realtime merges.
    const activityOf = (m: MemberState) => m.recorded_at ?? m.last_seen_at ?? 0;
    const freshestByName = new Map<string, MemberState>();
    for (const m of members) {
      const key = m.display_name.trim().toLowerCase();
      const prev = freshestByName.get(key);
      if (!prev || activityOf(m) > activityOf(prev)) freshestByName.set(key, m);
    }
    const deduped = members.filter((m) => {
      const key = m.display_name.trim().toLowerCase();
      return freshestByName.get(key) === m;
    });

    return NextResponse.json({ group, members: deduped });
  } catch (e) {
    console.error("members failed", e);
    return NextResponse.json({ error: "Could not load members" }, { status: 500 });
  }
}
