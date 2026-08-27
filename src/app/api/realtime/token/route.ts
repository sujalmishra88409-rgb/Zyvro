import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { findUserByClientId, isMember, resolveGroup } from "@/lib/server/turso";
import { ablyRest, channelForGroup } from "@/lib/server/ably";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  client_id: z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/),
  group_id: z.string().min(3).max(64).regex(/^[A-Za-z0-9_-]+$/),
});

/**
 * Issues a short-lived Ably token scoped to exactly one channel: the
 * requester's own group. The master ABLY_API_KEY never reaches the browser.
 *
 * We return the ACTUAL issued TokenDetails (not a TokenRequest) so the client
 * can read its EFFECTIVE capability. Ably silently downgrades requested
 * capabilities to the issuing key's own capabilities — if the key lacks
 * "subscribe", the client transparently falls back to Ably history polling.
 */
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
    const user = await findUserByClientId(client_id);
    if (!user) return NextResponse.json({ error: "Unknown client" }, { status: 403 });
    if (!(await isMember(group.id, user.id))) {
      return NextResponse.json({ error: "Not a member of this group" }, { status: 403 });
    }

    const channel = channelForGroup(group.id);
    const tokenDetails = await ablyRest().auth.requestToken({
      clientId: client_id,
      capability: { [channel]: ["publish", "subscribe", "presence", "history"] },
      ttl: 2 * 60 * 60 * 1000, // 2h; the SDK transparently re-auths via this endpoint
    });

    return NextResponse.json({
      token: tokenDetails.token,
      capability: tokenDetails.capability,
      expires: tokenDetails.expires,
    });
  } catch (e) {
    console.error("token issuance failed", e);
    return NextResponse.json({ error: "Could not issue realtime token" }, { status: 500 });
  }
}
