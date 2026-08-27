"use client";

// ZYVRO — single-screen app. Map first: the map is always rendered;
// every other element floats above it.
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useZyvro } from "@/lib/client/store";
import { useZyvroSession } from "@/lib/client/use-zyvro";
import HeaderBar from "@/components/zyvro/HeaderBar";
import MapControls from "@/components/zyvro/MapControls";
import NameSheet from "@/components/zyvro/NameSheet";
import FriendSheet from "@/components/zyvro/FriendSheet";
import SettingsSheet from "@/components/zyvro/SettingsSheet";
import { Navigation2 } from "lucide-react";

const ZyvroMap = dynamic(() => import("@/components/zyvro/ZyvroMap"), { ssr: false });

export default function Home() {
  const { registerAndStart, switchGroup, rename, toggleSharing, requestLocation, deleteProfile } = useZyvroSession();

  const mounted = useZyvro((s) => s.mounted);
  const identity = useZyvro((s) => s.identity);
  const geoDenied = useZyvro((s) => s.geoDenied);
  const geoStuck = useZyvro((s) => s.geoStuck);
  const own = useZyvro((s) => s.own);
  const registering = useZyvro((s) => s.registering);

  // Inside an embedded preview iframe without allow="geolocation", the
  // browser denies position access before the site can even ask — tapping
  // "enable" in there can never work, so offer opening a real tab instead.
  // Lazy init is hydration-safe here: the banner that reads this flag only
  // renders after `mounted` flips, long after hydration.
  const [embedded] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  });

  // Ticker for relative-time labels is handled inside sheets.

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#0B0D0C] text-[#EDEAE0]">
      {/* THE MAP — always first, never behind a landing page */}
      <ZyvroMap />

      {/* subtle top scrim for header legibility */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-black/55 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-gradient-to-t from-black/40 to-transparent" />

      {mounted && identity && (
        <>
          <HeaderBar />
          <MapControls />

          {/* location permission / fix banner — never blocks the map */}
          {(geoDenied || geoStuck) && (
            <div className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-20 flex justify-center px-4">
              <button
                onClick={() => {
                  if (geoDenied && embedded) {
                    try {
                      window.open(window.location.href, "_blank", "noopener");
                    } catch {
                      /* popup blocked — the retry below still applies */
                      requestLocation();
                    }
                    return;
                  }
                  requestLocation();
                }}
                className="pointer-events-auto flex h-11 items-center gap-2.5 rounded-full border border-[#3ECF8E]/30 bg-[#101312]/95 px-5 shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur-md active:scale-[0.98]"
              >
                <Navigation2 className="h-4 w-4 text-[#3ECF8E]" />
                <span className="text-[13px] font-semibold text-[#EDEAE0]">
                  {geoDenied
                    ? embedded
                      ? "Open in a browser tab to enable location"
                      : "Location is off — tap to enable"
                    : "Can't find your position — tap to retry"}
                </span>
              </button>
            </div>
          )}

          {/* waiting-for-fix hint */}
          {!own && !geoDenied && !geoStuck && (
            <div className="pointer-events-none absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-10 flex justify-center px-4">
              <div className="flex h-9 items-center gap-2.5 rounded-full border border-white/10 bg-[#101312]/90 px-4 backdrop-blur-md">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#3ECF8E] border-t-transparent" />
                <span className="text-[12px] font-medium text-[#8A918B]">Finding your position…</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* first visit — name prompt over the map (busy locks the submit button) */}
      {mounted && <NameSheet busy={registering} onSubmit={(name) => void registerAndStart(name, "ZYVRO")} />}

      {/* friend details */}
      <FriendSheet onToggleSharing={(enabled) => void toggleSharing(enabled)} />

      {/* settings */}
      <SettingsSheet
        onToggleSharing={(enabled) => void toggleSharing(enabled)}
        onRename={rename}
        onSwitchGroup={switchGroup}
        onDeleteProfile={() => deleteProfile()}
      />
    </main>
  );
}
