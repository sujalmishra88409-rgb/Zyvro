import { NextRequest, NextResponse } from "next/server";
import { publishToGroup } from "@/lib/server/ably";
import { rateLimitOk } from "@/lib/server/ratelimit";
import { resolveGroup } from "@/lib/server/turso";

export const dynamic = "force-dynamic";

/**
 * Lightweight "going offline" beacon called via navigator.sendBeacon on pagehide.
 * Lets connected friends flip this user's marker to LAST SEEN immediately,
 * instead of waiting for the presence timeout.
 */
export async function POST(req: NextRequest) {
  try {
    // sendBeacon sends text/plain; parse leniently.
    const text = await req.text();
    const body = JSON.parse(text) as { client_id?: unknown; group_id?: unknown };
    const clientId = typeof body.client_id === "string" ? body.client_id : null;
    const groupId = typeof body.group_id === "string" ? body.group_id : null;
    if (!clientId || !groupId || clientId.length > 64 || groupId.length > 64) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const limiter = rateLimitOk(`off:${clientId}`, 1000);
    if (!limiter.ok) return NextResponse.json({ ok: true });

    const group = await resolveGroup(groupId);
    if (group) {
      await publishToGroup(group.id, "status", { client_id: clientId, online: false });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
