"use client";

// ZYVRO — compact floating header: logo + wordmark, group status, settings button.
import { useZyvro } from "@/lib/client/store";
import { Settings2 } from "lucide-react";

export default function HeaderBar() {
  const identity = useZyvro((s) => s.identity);
  const group = useZyvro((s) => s.group);
  const members = useZyvro((s) => s.members);
  const onlineIds = useZyvro((s) => s.onlineIds);
  const own = useZyvro((s) => s.own);
  const sharing = useZyvro((s) => s.sharing);
  const setSettingsOpen = useZyvro((s) => s.setSettingsOpen);

  const liveOthers = members.filter((m) => onlineIds.has(m.client_id)).length;
  const selfLive = !!own && sharing;
  const liveCount = liveOthers + (selfLive ? 1 : 0);

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      {/* wordmark pill */}
      <div className="pointer-events-auto flex h-11 items-center gap-2.5 rounded-full border border-white/10 bg-[#101312]/90 pl-3 pr-4 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md">
        { }
        <img src="/zyvro-mark.png" alt="ZYVRO logo" className="h-5 w-5" draggable={false} />
        <span className="text-[15px] font-extrabold tracking-[0.14em] text-[#EDEAE0]">ZYVRO</span>
        <span className="h-4 w-px bg-white/10" />
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#8A918B]">
          <span
            className={
              "inline-block h-1.5 w-1.5 rounded-full " +
              (liveCount > 0 ? "bg-[#3ECF8E] shadow-[0_0_6px_rgba(62,207,142,0.8)]" : "bg-[#4A504B]")
            }
          />
          {identity ? (
            <>
              <span className="text-[#EDEAE0]">{liveCount}</span> live
              <span className="text-[#4A504B]">·</span>
              <span className="max-w-[72px] truncate">{group ? group.code : "…"}</span>
            </>
          ) : (
            "offline"
          )}
        </span>
      </div>

      {/* settings */}
      <button
        aria-label="Open settings"
        onClick={() => setSettingsOpen(true)}
        className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-[#101312]/90 text-[#B9BFB8] shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md transition-colors active:bg-[#181C1A]"
      >
        <Settings2 className="h-[18px] w-[18px]" strokeWidth={2.2} />
      </button>
    </header>
  );
}
