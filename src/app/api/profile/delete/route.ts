import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteUserData, findUserByClientId, userGroupIds } from "@/lib/server/turso";
import { publishToGroup } from "@/lib/server/ably";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  client_id: z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/),
});

/** POST /api/profile/delete — remove a profile everywhere and leave the group. */
export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { client_id } = parsed.data;

  try {
    const user = await findUserByClientId(client_id);
    // Idempotent: deleting an already-deleted profile succeeds.
    if (!user) return NextResponse.json({ ok: true });

    // Tell every group BEFORE the rows disappear so friends drop the marker
    // immediately instead of waiting for their next members resync. If the
    // lookup itself hiccups, deletion still proceeds — friends fall back to
    // their periodic members resync.
    const groupIds = await userGroupIds(user.id).catch(() => [] as string[]);
    await Promise.all(groupIds.map((gid) => publishToGroup(gid, "left", { client_id })));

    await deleteUserData(user.id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("profile delete failed", e);
    return NextResponse.json({ error: "Could not delete profile" }, { status: 500 });
  }
}
