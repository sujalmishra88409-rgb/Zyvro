// ZYVRO — server-side Ably access (master key never leaves the server)
import * as Ably from "ably";

let _rest: Ably.Rest | null = null;

export function ablyRest(): Ably.Rest {
  if (!_rest) {
    const key = process.env.ABLY_API_KEY;
    if (!key) throw new Error("Missing ABLY_API_KEY");
    _rest = new Ably.Rest({ key });
  }
  return _rest;
}

/** Per-group realtime channel. Capability is scoped to exactly this channel. */
export function channelForGroup(groupId: string): string {
  return `zyvro:g:${groupId}:v1`;
}

/** Broadcast a validated, persisted location update to all group members. */
export async function publishLocation(payload: unknown, groupId: string): Promise<void> {
  try {
    const ch = ablyRest().channels.get(channelForGroup(groupId));
    await ch.publish("loc", payload);
  } catch (e) {
    // Realtime broadcast is best-effort; persistence already succeeded.
    console.error("ably publishLocation failed", e);
  }
}

export async function publishToGroup(groupId: string, name: string, payload: unknown): Promise<void> {
  try {
    const ch = ablyRest().channels.get(channelForGroup(groupId));
    await ch.publish(name, payload);
  } catch (e) {
    console.error(`ably publish ${name} failed`, e);
  }
}
