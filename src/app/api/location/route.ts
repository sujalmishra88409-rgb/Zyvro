import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { findUserByClientId, isMember, resolveGroup, upsertLocation } from "@/lib/server/turso";
import { publishLocation } from "@/lib/server/ably";
import { rateLimitOk } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  client_id: z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/),
  group_id: z.string().min(3).max(64).regex(/^[A-Za-z0-9_-]+$/),
  latitude: z.number().min(-85.05).max(85.05),
  longitude: z.number().min(-180).max(180),
  accuracy_m: z.number().min(0).max(100_000).nullable().optional(),
  speed_mps: z.number().min(0).max(340).nullable().optional(),
  heading_deg: z.number().min(0).max(360).nullable().optional(),
  recorded_at: z.number().int().optional(),
});

/** Minimum accepted interval between writes per client (server-side throttle). */
const MIN_WRITE_INTERVAL_MS = 1500;
/** Reject fixes claiming to be from further than 10 minutes in the past/future. */
const MAX_TIMESTAMP_SKEW_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid location payload" }, { status: 400 });
  }
  const b = parsed.data;

  const limiter = rateLimitOk(`loc:${b.client_id}`, MIN_WRITE_INTERVAL_MS);
  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Too many updates", retry_after_ms: limiter.retryAfterMs },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limiter.retryAfterMs / 1000)) } }
    );
  }

  try {
    const user = await findUserByClientId(b.client_id);
    if (!user) {
      return NextResponse.json({ error: "Unknown client" }, { status: 403 });
    }
    // Accepts the internal group id or the shareable code; resolve once.
    const group = await resolveGroup(b.group_id);
    if (!group) {
      return NextResponse.json({ error: "Unknown group" }, { status: 404 });
    }
    // Access control: only group members may write into a group.
    if (!(await isMember(group.id, user.id))) {
      return NextResponse.json({ error: "Not a member of this group" }, { status: 403 });
    }
    if (!user.sharing_enabled) {
      return NextResponse.json({ error: "Sharing is paused" }, { status: 409 });
    }

    // Validate timestamp; clamp nonsensical values to server time.
    const now = Date.now();
    let recordedAt = b.recorded_at ?? now;
    if (!Number.isFinite(recordedAt) || Math.abs(now - recordedAt) > MAX_TIMESTAMP_SKEW_MS) {
      recordedAt = now;
    }

    const fix = {
      userId: user.id,
      groupId: group.id,
      latitude: b.latitude,
      longitude: b.longitude,
      accuracy_m: b.accuracy_m ?? null,
      speed_mps: b.speed_mps ?? null,
      heading_deg: b.heading_deg ?? null,
      recorded_at: recordedAt,
    };
    await upsertLocation(fix);

    await publishLocation(
      {
        client_id: user.client_id,
        lat: fix.latitude,
        lng: fix.longitude,
        accuracy_m: fix.accuracy_m,
        recorded_at: fix.recorded_at,
      },
      group.id
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("location write failed", e);
    return NextResponse.json({ error: "Could not store location" }, { status: 500 });
  }
}
