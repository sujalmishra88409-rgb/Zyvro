// ZYVRO — dark monochrome MapTiler style pipeline (spec §5).
// Loads MapTiler "darkmatter" and re-paints every layer into a restrained
// charcoal cartography: near-black land, charcoal buildings, gray roads,
// muted labels, zero bright colors. NOT a CSS overlay.

export function maptilerDarkStyleUrl(key: string): string {
  return `https://api.maptiler.com/maps/darkmatter/style.json?key=${key}`;
}

const P = {
  bg: "#0A0C0B",
  water: "#0D110F",
  waterLine: "#111613",
  landcover: "#0E110F",
  building: "#171B19",
  buildingTop: "#1B201D",
  roadMinor: "#20241F",
  roadMid: "#282D28",
  roadMajor: "#313730",
  roadMajor2: "#3B423B",
  casing: "#0B0E0C",
  rail: "#232823",
  boundary: "#2E342F",
  label: "#7E8580",
  labelMajor: "#A8AEA7",
  halo: "#0A0C0B",
} as const;

type AnyLayer = { id: string; type: string; "source-layer"?: string; paint?: Record<string, unknown> };

/**
 * Walk all style layers and force the ZYVRO monochrome palette.
 * Called on every `style.load` (safe to re-run).
 */
export function applyMonochrome(map: { getStyle(): { layers?: AnyLayer[] }; setPaintProperty(id: string, prop: string, v: unknown): void; setLayoutProperty(id: string, prop: string, v: unknown): void }): void {
  let layers: AnyLayer[] = [];
  try {
    layers = map.getStyle().layers ?? [];
  } catch {
    return;
  }

  for (const layer of layers) {
    const id = layer.id;
    const idl = id.toLowerCase();
    const src = layer["source-layer"] ?? "";
    const type = layer.type;

    try {
      if (type === "background") {
        map.setPaintProperty(id, "background-color", P.bg);
        continue;
      }

      // Hide POI icon noise — keeps the tactical read clean.
      if (type === "symbol" && (idl.startsWith("poi") || idl.includes("entrance"))) {
        map.setLayoutProperty(id, "visibility", "none");
        continue;
      }

      if (type === "symbol") {
        const isMajorLabel = idl.includes("city") || idl.includes("town") || idl.includes("country") || (idl.startsWith("place") && idl.includes("name"));
        map.setPaintProperty(id, "text-color", isMajorLabel ? P.labelMajor : P.label);
        map.setPaintProperty(id, "text-halo-color", P.halo);
        map.setPaintProperty(id, "text-halo-width", 1);
        continue;
      }

      if (src === "water" || src === "waterway" || idl.includes("water")) {
        if (type === "fill") map.setPaintProperty(id, "fill-color", P.water);
        if (type === "line") {
          map.setPaintProperty(id, "line-color", P.waterLine);
          map.setPaintProperty(id, "line-opacity", 0.8);
        }
        continue;
      }

      if (src === "building" || idl.includes("building")) {
        if (type === "fill") {
          map.setPaintProperty(id, "fill-color", P.building);
          map.setPaintProperty(id, "fill-opacity", 0.9);
        }
        if (type === "fill-extrusion") {
          map.setPaintProperty(id, "fill-extrusion-color", P.buildingTop);
          map.setPaintProperty(id, "fill-extrusion-opacity", 0.92);
        }
        continue;
      }

      if (src.startsWith("landcover") || src.startsWith("landuse") || idl.includes("park") || idl.includes("forest") || idl.includes("landcover") || idl.includes("hillshade") || idl.includes("terrain")) {
        if (type === "fill") {
          map.setPaintProperty(id, "fill-color", P.landcover);
          map.setPaintProperty(id, "fill-opacity", 0.85);
        }
        if (type === "raster") {
          map.setPaintProperty(id, "raster-opacity", 0.12);
          map.setPaintProperty(id, "raster-saturation", -1);
        }
        continue;
      }

      if (idl.includes("boundary") || src === "boundary") {
        if (type === "line") {
          map.setPaintProperty(id, "line-color", P.boundary);
          map.setPaintProperty(id, "line-opacity", 0.7);
        }
        continue;
      }

      if (idl.includes("rail") || src === "transportation_name" && type === "line") {
        if (type === "line") map.setPaintProperty(id, "line-color", P.rail);
        continue;
      }

      // Roads (OpenMapTiles source-layer: transportation)
      if (src === "transportation" || idl.startsWith("road") || idl.includes("bridge") || idl.includes("tunnel") || idl.includes("aeroway") || idl.includes("highway")) {
        if (type === "line") {
          const casing = idl.includes("casing") || idl.includes("outline") || idl.includes("path") || idl.includes("pedestrian");
          let color: string = P.roadMinor;
          if (casing) color = P.casing;
          else if (idl.includes("motorway") || idl.includes("junction")) color = P.roadMajor2;
          else if (idl.includes("trunk") || idl.includes("primary")) color = P.roadMajor;
          else if (idl.includes("secondary") || idl.includes("tertiary")) color = P.roadMid;
          map.setPaintProperty(id, "line-color", color);
          if (!casing) map.setPaintProperty(id, "line-opacity", 0.95);
          else map.setPaintProperty(id, "line-opacity", 0.9);
        }
        continue;
      }

      // Fallback: neutralize any other colored fill/line layers.
      if (type === "fill" && layer.paint && "fill-color" in layer.paint) {
        map.setPaintProperty(id, "fill-color", P.landcover);
      } else if (type === "line" && layer.paint && "line-color" in layer.paint) {
        map.setPaintProperty(id, "line-color", P.roadMinor);
      }
    } catch {
      // Layer may not support this property in this style version — skip.
    }
  }
}
