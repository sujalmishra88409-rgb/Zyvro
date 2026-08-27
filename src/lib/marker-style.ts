// ZYVRO — isomorphic marker identity derivation (no DOM / node deps)
// Deterministic: same client_id always yields the same badge character + hue.

const MARKER_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I/L

export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function markerCharacterFor(clientId: string): string {
  const h = fnv1a32(clientId + "::char");
  return MARKER_CHARS[h % MARKER_CHARS.length];
}

/** Restrained, desaturated badge hues — never bright, never blue-heavy. */
export const MARKER_HUES = ["#7FA98C", "#B3A27E", "#B08276", "#A68BA3", "#8C9DA8", "#93A878", "#A98F7F", "#9BA87F"] as const;

export function markerHueFor(clientId: string): string {
  const h = fnv1a32(clientId + "::hue");
  return MARKER_HUES[h % MARKER_HUES.length];
}

/** ZYVRO accent — used for LIVE state and the viewer's own marker. */
export const ZYVRO_ACCENT = "#3ECF8E";
