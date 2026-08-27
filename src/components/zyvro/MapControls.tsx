"use client";

// ZYVRO — bottom floating controls: member count, my location, zoom. One-handed reach.
import { useZyvro } from "@/lib/client/store";
import { Crosshair, Minus, Plus, Users } from "lucide-react";

export default function MapControls() {
  const mapApi = useZyvro((s) => s.mapApi);
  const own = useZyvro((s) => s.own);
  const members = useZyvro((s) => s.members);
  const geoWaiting = useZyvro((s) => s.geoWaiting);
  const onlineIds = useZyvro((s) => s.onlineIds);
  const identity = useZyvro((s) => s.identity);

  const onlineCount = members.filter((m) => onlineIds.has(m.client_id)).length + (own && identity ? 1 : 0);

  const btn =
    "flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-[#101312]/90 text-[#B9BFB8] shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md transition-colors active:bg-[#1B201D] disabled:opacity-40";

  return (
    <div className="pointer-events-none absolute bottom-4 right-3 z-20 flex flex-col items-end gap-2.5 pb-[env(safe-area-inset-bottom)]">
      {/* member count chip */}
      <button
        aria-label="Show all members"
        onClick={() => mapApi?.fitAll()}
        disabled={!mapApi}
        className="pointer-events-auto flex h-11 items-center gap-2 rounded-full border border-white/10 bg-[#101312]/90 px-4 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md transition-colors active:bg-[#1B201D] disabled:opacity-40"
      >
        <Users className="h-4 w-4 text-[#8A918B]" strokeWidth={2.2} />
        <span className="text-[13px] font-bold tabular-nums text-[#EDEAE0]">{onlineCount}</span>
        <span className="text-[11px] font-medium text-[#8A918B]">here</span>
        {onlineCount > 0 && <span className="zyvro-live-dot" />}
      </button>

      {/* control stack */}
      <div className="pointer-events-auto flex flex-col gap-2.5">
        <button aria-label="Zoom in" className={btn} onClick={() => mapApi?.zoomIn()}>
          <Plus className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <button aria-label="Zoom out" className={btn} onClick={() => mapApi?.zoomOut()}>
          <Minus className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <button
          aria-label="My location"
          className={btn}
          onClick={() => {
            if (own && mapApi) mapApi.flyTo(own.lat, own.lng, 15.5);
          }}
          disabled={!own || !mapApi}
        >
          {geoWaiting ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#3ECF8E] border-t-transparent" />
          ) : (
            <Crosshair className={"h-5 w-5 " + (own ? "text-[#3ECF8E]" : "")} strokeWidth={2.2} />
          )}
        </button>
      </div>
    </div>
  );
}
