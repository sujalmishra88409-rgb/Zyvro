import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { findUserByClientId, isMember, resolveGroup, setUserSharing } from "@/lib/server/turso";
import { publishToGroup } from "@/lib/server/ably";
import { rateLimitOk } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  client_id: z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/),
  group_id: z.string().min(3).max(64).regex(/^[A-Za-z0-9_-]+$/),
  enabled: z.boolean(),
});

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
  const { client_id, group_id, enabled } = parsed.data;

  const limiter = rateLimitOk(`share:${client_id}`, 800);
  if (!limiter.ok) {
    return NextResponse.json({ error: "Too many toggles" }, { status: 429 });
  }

  try {
    const user = await findUserByClientId(client_id);
    if (!user) return NextResponse.json({ error: "Unknown client" }, { status: 403 });
    // Accepts the internal group id or the shareable code.
    const group = await resolveGroup(group_id);
    if (!group) return NextResponse.json({ error: "Unknown group" }, { status: 404 });
    if (!(await isMember(group.id, user.id))) {
      return NextResponse.json({ error: "Not a member of this group" }, { status: 403 });
    }

    await setUserSharing(user.id, enabled);
    await publishToGroup(group.id, "sharing", { client_id, enabled });

    return NextResponse.json({ ok: true, enabled });
  } catch (e) {
    console.error("sharing toggle failed", e);
    return NextResponse.json({ error: "Could not update sharing" }, { status: 500 });
  }
}
