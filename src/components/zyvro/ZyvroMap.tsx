"use client";

// ZYVRO — primary screen: dark monochrome MapLibre map + custom tactical markers.
// Markers are persistent DOM nodes updated in place; positions interpolate
// smoothly (exponential easing) whenever a new coordinate arrives.
import { useEffect, useRef } from "react";
import { useZyvro } from "@/lib/client/store";
import { markerHueFor, markerCharacterFor, ZYVRO_ACCENT } from "@/lib/marker-style";
import { applyMonochrome, maptilerDarkStyleUrl } from "@/lib/client/map-style";
import type { MemberState } from "@/lib/types";

const SELF_ID = "__self__";

interface MarkerEntry {
   
  marker: any; // maplibregl.Marker (typed loosely to allow dynamic import)
  el: HTMLDivElement;
  cur: { lng: number; lat: number };
  target: { lng: number; lat: number };
  anim: number | null;
  lastMove: number;
}

function markerClass(isOwn: boolean, live: boolean, sharing: boolean): string {
  let cls = "zyvro-marker";
  if (isOwn) cls += " is-own";
  if (live && sharing) cls += " is-live";
  if (!sharing) cls += " is-paused";
  return cls;
}

function buildMarkerEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "zyvro-marker";
  const badge = document.createElement("div");
  badge.className = "zyvro-badge";
  const glyph = document.createElement("span");
  glyph.className = "zyvro-glyph";
  badge.appendChild(glyph);
  const dot = document.createElement("span");
  dot.className = "zyvro-dot";
  const you = document.createElement("span");
  you.className = "zyvro-you";
  you.textContent = "YOU";
  el.appendChild(badge);
  el.appendChild(dot);
  el.appendChild(you);
  return el;
}

export default function ZyvroMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
   
  const mapRef = useRef<any>(null);
   
  const maplibreRef = useRef<any>(null);
  const markersRef = useRef<Map<string, MarkerEntry>>(new Map());
  const ownMarkerRef = useRef<MarkerEntry | null>(null);
  const didFitRef = useRef(false);

  const markerEpoch = useZyvro((st) => st.markerEpoch);
  const mapApi = useZyvro((st) => st.mapApi);

  // ------------------------------------------------------------ init map
  useEffect(() => {
    let cancelled = false;
     
    let map: any = null;

    (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled || !containerRef.current) return;
      maplibreRef.current = maplibre;

      // Serve the worker over HTTP instead of an inline blob — deterministic
      // across hosting/preview environments with strict worker/CSP policies.
      maplibre.setWorkerUrl("/maplibre-gl-worker.mjs");

      const key = process.env.NEXT_PUBLIC_MAPTILER_API_KEY ?? "";

      map = new maplibre.Map({
        container: containerRef.current,
        style: maptilerDarkStyleUrl(key),
        // Neutral country-level start — never a specific city. The first GPS
        // fix flies the map to the user (see first-fit logic below).
        center: [79.6, 22.8],
        zoom: 3.4,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxPitch: 0,
        fadeDuration: 150,
      });
      mapRef.current = map;
      // Debug/testing hook
      (window as unknown as { __zyvroMap?: unknown }).__zyvroMap = map;

      map.on("style.load", () => {
        if (map) applyMonochrome(map);
      });

      map.on("error", (e: { error?: { message?: string } }) => {
        console.warn("map error", e?.error?.message ?? "unknown");
      });

      // Expose imperative controls to the rest of the app.
      useZyvro.getState().setMapApi({
        flyTo: (lat, lng, zoom) => {
          map?.flyTo({ center: [lng, lat], zoom: zoom ?? Math.max(map.getZoom(), 14), speed: 1.1, essential: true });
        },
        fitAll: () => {
          if (!map) return;
          const s = useZyvro.getState();
          const pts: [number, number][] = [];
          let acc: number | null = null;
          if (s.own) {
            pts.push([s.own.lng, s.own.lat]);
            acc = s.own.accuracy;
          }
          s.members.forEach((m) => {
            if (m.lat !== null && m.lng !== null) pts.push([m.lng, m.lat]);
          });
          if (pts.length === 0) return;
          if (pts.length === 1) {
            // Accuracy-aware zoom: a coarse GPS fix gets a wider view so the
            // marker never implies more precision than the device provides.
            const zoom = acc == null ? 14.5 : acc > 300 ? 11.5 : acc > 120 ? 13.5 : acc > 40 ? 15 : 16.2;
            map.flyTo({ center: pts[0], zoom, speed: 1.1, essential: true });
            return;
          }
          const lons = pts.map((p) => p[0]);
          const lats = pts.map((p) => p[1]);
          map.fitBounds(
            [
              [Math.min(...lons), Math.min(...lats)],
              [Math.max(...lons), Math.max(...lats)],
            ],
            { padding: 110, maxZoom: 15.5, duration: 900, essential: true }
          );
        },
        zoomIn: () => map?.zoomIn({ duration: 260 }),
        zoomOut: () => map?.zoomOut({ duration: 260 }),
      });
    })();

    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.marker.remove());
      markersRef.current.clear();
      if (ownMarkerRef.current) ownMarkerRef.current.marker.remove();
      ownMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      useZyvro.getState().setMapApi(null);
    };
  }, []);

  // --------------------------------------------- first fit: OWN fix only
  // The map NEVER auto-zooms to friends. Until THIS user's own GPS fix
  // arrives the map simply stays on its neutral country view (with the
  // "Finding your position…" hint) — a friend's stale pin, or a leftover
  // demo account, must never decide what a newcomer sees first, and must
  // never deep-zoom the map to someone else's exact spot while GPS is slow.
  // The fit retries until the map bundle finished loading, and the
  // warm-cache catch-up covers a fix that landed before this lazy chunk
  // finished mounting.
  useEffect(() => {
    const runFit = () => {
      if (didFitRef.current) return;
      didFitRef.current = true;
      let tries = 0;
      const attempt = () => {
        const api = useZyvro.getState().mapApi;
        const s = useZyvro.getState();
        if (api && s.own) {
          // Opening the app shows where YOU are — accuracy-aware zoom.
          const zoom =
            s.own.accuracy == null ? 15 : s.own.accuracy > 300 ? 12 : s.own.accuracy > 120 ? 13.5 : s.own.accuracy > 40 ? 15 : 16.2;
          api.flyTo(s.own.lat, s.own.lng, zoom);
          return;
        }
        // Map bundle still lazy-loading — keep trying for ~10 s; if it never
        // appears, re-arm so the next GPS callback can fit again.
        if (++tries < 40) {
          setTimeout(attempt, 250);
        } else {
          didFitRef.current = false;
        }
      };
      setTimeout(attempt, 350);
    };
    const unsub = useZyvro.subscribe((s, prev) => {
      if (s.own && !prev.own) runFit();
    });
    if (!didFitRef.current && useZyvro.getState().own) runFit();
    return unsub;
  }, []);

  // -------------------------------------------------------- marker syncing
  useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    if (!map || !maplibre) return;

    const attach = () => syncMarkers();
    if (!map.loaded() && !map.isStyleLoaded()) {
      map.once("load", attach);
      return;
    }

    syncMarkers();

    function syncMarkers() {
      if (!mapRef.current) return;
      const s = useZyvro.getState();
      const now = Date.now();

      const upsert = (id: string, lat: number, lng: number, z: number): MarkerEntry => {
        let entry = id === SELF_ID ? ownMarkerRef.current : markersRef.current.get(id);
        if (!entry) {
          const el = buildMarkerEl();
          const marker = new maplibreRef.current.Marker({ element: el, anchor: "center" })
            .setLngLat([lng, lat])
            .addTo(mapRef.current);
          el.style.zIndex = String(z);
          entry = { marker, el, cur: { lng, lat }, target: { lng, lat }, anim: null, lastMove: 0 };
          if (id === SELF_ID) ownMarkerRef.current = entry;
          else markersRef.current.set(id, entry);
        }
        return entry;
      };

      const animateTo = (entry: MarkerEntry, lat: number, lng: number) => {
        entry.target = { lng, lat };
        if (entry.anim !== null) return;
        const step = () => {
          if (!entry.lastMove) entry.lastMove = performance.now();
          const dt = Math.min(0.06, (performance.now() - entry.lastMove) / 1000);
          entry.lastMove = performance.now();
          const k = 1 - Math.exp(-dt * 5.2);
          const dx = entry.target.lng - entry.cur.lng;
          const dy = entry.target.lat - entry.cur.lat;
          if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) {
            // Reconnect / huge jump — snap instead of gliding across the map.
            entry.cur = { ...entry.target };
          } else if (Math.abs(dx) < 1e-7 && Math.abs(dy) < 1e-7) {
            entry.anim = null;
            return;
          } else {
            entry.cur = { lng: entry.cur.lng + dx * k, lat: entry.cur.lat + dy * k };
          }
          entry.marker.setLngLat([entry.cur.lng, entry.cur.lat]);
          entry.anim = requestAnimationFrame(step);
        };
        entry.anim = requestAnimationFrame(step);
      };

      const applyStyle = (el: HTMLDivElement, opts: { character: string; hue: string; isOwn: boolean; live: boolean; sharing: boolean }) => {
        el.className = markerClass(opts.isOwn, opts.live, opts.sharing);
        el.style.setProperty("--zy-hue", opts.hue);
        const glyph = el.querySelector(".zyvro-glyph");
        if (glyph) glyph.textContent = opts.character;
      };

      // --- friends
      const seen = new Set<string>();
      for (const m of s.members) {
        if (m.lat === null || m.lng === null || !m.sharing) continue;
        seen.add(m.client_id);
        const entry = upsert(m.client_id, m.lat, m.lng, 5);
        // LIVE = presence online (when the key allows it) or a fresh location fix.
        const fresh = m.recorded_at !== null && now - m.recorded_at < 30_000;
        const live = s.onlineIds.has(m.client_id) || fresh;
        applyStyle(entry.el, {
          character: m.marker_character,
          hue: markerHueFor(m.client_id),
          isOwn: false,
          live,
          sharing: true,
        });
        if (!entry.el.onclick) {
          entry.el.addEventListener("click", (ev) => {
            ev.stopPropagation();
            useZyvro.getState().select(m.client_id);
          });
        }
        animateTo(entry, m.lat, m.lng);
      }
      for (const [id, entry] of markersRef.current) {
        if (!seen.has(id)) {
          entry.marker.remove();
          markersRef.current.delete(id);
        }
      }

      // --- own marker
      if (s.own && s.identity) {
        const entry = upsert(SELF_ID, s.own.lat, s.own.lng, 10);
        applyStyle(entry.el, {
          character: markerCharacterFor(s.identity.clientId),
          hue: ZYVRO_ACCENT,
          isOwn: true,
          live: s.sharing,
          sharing: s.sharing,
        });
        if (!entry.el.onclick) {
          entry.el.addEventListener("click", (ev) => {
            ev.stopPropagation();
            useZyvro.getState().select(SELF_ID);
          });
        }
        animateTo(entry, s.own.lat, s.own.lng);
      }
    }
  }, [markerEpoch, mapApi]);

  return (
    <div
      ref={containerRef}
      className="maplibregl-map-root"
      style={{ position: "absolute", inset: 0, zIndex: 0 }}
      aria-label="ZYVRO live map"
      role="application"
    />
  );
}
