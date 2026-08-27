// ZYVRO — geo helpers: Haversine distance, formatting, MapTiler reverse geocoding (cached)

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** "420 m away" / "3.2 km away" — human friendly per spec §14 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "—";
  if (meters < 950) return `${Math.round(meters / 10) * 10} m away`;
  if (meters < 100_000) return `${(meters / 1000).toFixed(meters < 9500 ? 1 : 0)} km away`;
  return `${Math.round(meters / 1000)} km away`;
}

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "unknown";
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ---------------------------------------------------------------------------
// Reverse geocoding via MapTiler (NEXT_PUBLIC key — allowed in browser per spec)
// ---------------------------------------------------------------------------

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_API_KEY ?? "";

interface GeoCacheEntry {
  label: string | null;
  at: number;
}
const geoCache = new Map<string, GeoCacheEntry>();
const geoInflight = new Map<string, Promise<string | null>>();
const GEO_TTL = 24 * 60 * 60 * 1000;

function cacheKey(lat: number, lng: number, dp: number): string {
  return `v2:${lat.toFixed(dp)},${lng.toFixed(dp)}`;
}

/**
 * Settlement levels mapped to MapTiler's REAL geocoder types (the API
 * rejects unknown types with 400 — e.g. "village"/"town"/"city" are NOT
 * valid; village-level settlements are typed "locality").
 */
const VILLAGE_LEVEL = ["locality", "neighbourhood"];
const TOWN_LEVEL = ["place", "municipality", "joint_municipality", "joint_submunicipality", "municipal_district"];
const REGION_LEVEL = ["county", "subregion", "region"];
// MapTiler geocoder types we never want as a label.
const BAD_TYPES = new Set(["road", "address", "postal_code", "poi", "country", "continental_marine", "major_landform"]);

interface GeoFeature {
  text?: string;
  place_type?: string[];
}

function pickLabel(feats: GeoFeature[]): string | null {
  const named = feats.filter((f) => f.text && !(f.place_type ?? []).some((t) => BAD_TYPES.has(t)));
  const fromLevels = (levels: string[]) =>
    named.find((f) => (f.place_type ?? []).some((t) => levels.includes(t)))?.text ?? null;
  // Village-level name wins; then town/city; then broader area.
  return fromLevels(VILLAGE_LEVEL) ?? fromLevels(TOWN_LEVEL) ?? fromLevels(REGION_LEVEL) ?? named[0]?.text ?? null;
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!MAPTILER_KEY) return null;
  const key = cacheKey(lat, lng, 3); // ~110 m grid
  const hit = geoCache.get(key);
  if (hit && Date.now() - hit.at < GEO_TTL) return hit.label;

  const inflight = geoInflight.get(key);
  if (inflight) return inflight;

  const task = (async () => {
    try {
      // Pass 1 — ask only for settlement-type features so the village name
      // is not crowded out of the result list by roads / POIs / postcodes.
      // NOTE: MapTiler reverse geocoding forbids `limit` together with
      // multiple `types` — the typed pass must omit it.
      const typedUrl =
        `https://api.maptiler.com/geocoding/${lng.toFixed(5)},${lat.toFixed(5)}.json?key=${MAPTILER_KEY}` +
        `&types=${encodeURIComponent([...VILLAGE_LEVEL, ...TOWN_LEVEL, ...REGION_LEVEL].join(","))}`;
      const typedRes = await fetch(typedUrl);
      if (typedRes.ok) {
        const data = (await typedRes.json()) as { features?: GeoFeature[] };
        const label = pickLabel(data.features ?? []);
        if (label) {
          geoCache.set(key, { label, at: Date.now() });
          return label;
        }
      }
      // Pass 2 — untyped fallback, still skipping streets/POIs/postcodes.
      const url = `https://api.maptiler.com/geocoding/${lng.toFixed(5)},${lat.toFixed(5)}.json?key=${MAPTILER_KEY}&limit=10`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`geocode ${res.status}`);
      const data = (await res.json()) as { features?: GeoFeature[] };
      const label = pickLabel(data.features ?? []);
      geoCache.set(key, { label, at: Date.now() });
      return label;
    } catch {
      // Do not cache failures for a full day — retry sooner (10 min).
      geoCache.set(key, { label: null, at: Date.now() - (GEO_TTL - 10 * 60 * 1000) });
      return null;
    } finally {
      geoInflight.delete(key);
    }
  })();

  geoInflight.set(key, task);
  return task;
}

export function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
