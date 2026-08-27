"use client";

// ZYVRO — friend details bottom sheet (spec §8 + §13)
// Compact tactical rows: status, area, distance, weather, environment.
import { useEffect, useState } from "react";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { useZyvro } from "@/lib/client/store";
import { markerHueFor, markerCharacterFor, ZYVRO_ACCENT } from "@/lib/marker-style";
import { formatDistance, formatCoords, haversineMeters, reverseGeocode, timeAgo } from "@/lib/client/geo";
import { aqiInfo, fetchAir, fetchWeather, wmoLabel, type AirData, type WeatherData } from "@/lib/client/weather";
import {
  Droplets, CloudRain, Cloud, Compass, Fan, Sunrise, Sunset, Wind, LocateFixed, PauseCircle, PlayCircle, Leaf, Clock3, Thermometer,
} from "lucide-react";

export function Badge({ character, hue, size = 44 }: { character: string; hue: string; size?: number }) {
  return (
    <div
      className="zyvro-badge flex shrink-0 items-center justify-center rounded-full"
      style={{ ["--zy-hue" as string]: hue, width: size, height: size }}
    >
      <span className="zyvro-glyph">{character}</span>
    </div>
  );
}

function Row({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="flex items-center gap-2.5 text-[12.5px] font-medium text-[#8A918B]">
        <span className="text-[#6B716B]">{icon}</span>
        {label}
      </span>
      <span className={"text-[13.5px] font-semibold text-[#EDEAE0] " + (mono ? "tabular-nums" : "")}>{value}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 mt-4 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#5A615C]">{children}</div>;
}

export default function FriendSheet({ onToggleSharing }: { onToggleSharing: (enabled: boolean) => void }) {
  const selectedId = useZyvro((s) => s.selectedId);
  const members = useZyvro((s) => s.members);
  const own = useZyvro((s) => s.own);
  const identity = useZyvro((s) => s.identity);
  const onlineIds = useZyvro((s) => s.onlineIds);
  const sharing = useZyvro((s) => s.sharing);
  const select = useZyvro((s) => s.select);
  const mapApi = useZyvro((s) => s.mapApi);
  const group = useZyvro((s) => s.group);

  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, []);

  const isOpen = selectedId !== null;
  const isSelf = selectedId === "__self__";
  const member = !isSelf && selectedId ? members.find((m) => m.client_id === selectedId) ?? null : null;
  const hasTarget = isSelf || (!!member && member.lat !== null && member.lng !== null);

  // weather + air + area, loaded for the selected target's latest coords.
  // Env data is stored together with the target key it was fetched for, so a
  // selection change instantly invalidates stale values without effect-body resets.
  const [env, setEnv] = useState<{
    key: string;
    weather: WeatherData | null;
    air: AirData | null;
    area: string | null;
    done: boolean;
  }>({ key: "", weather: null, air: null, area: null, done: false });

  const targetLat0 = (isSelf ? own?.lat : member?.lat) ?? null;
  const targetLng0 = (isSelf ? own?.lng : member?.lng) ?? null;
  const envKey =
    hasTarget && targetLat0 !== null && targetLng0 !== null
      ? `${selectedId ?? ""}|${targetLat0.toFixed(4)}|${targetLng0.toFixed(4)}`
      : "";

  useEffect(() => {
    if (!envKey) return;
    let alive = true;
    const [, latStr, lngStr] = envKey.split("|");
    const latN = Number(latStr);
    const lngN = Number(lngStr);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return;

    Promise.all([
      fetchWeather(latN, lngN).catch(() => null),
      fetchAir(latN, lngN).catch(() => null),
      reverseGeocode(latN, lngN),
    ]).then(([w, a, label]) => {
      if (!alive) return;
      setEnv({ key: envKey, weather: w, air: a, area: label, done: true });
    });
    return () => {
      alive = false;
    };
  }, [envKey]);

  const envValid = env.key === envKey && envKey !== "";
  const weather = envValid && env.done ? env.weather : null;
  const air = envValid && env.done ? env.air : null;
  const area = envValid && env.done ? env.area : null;
  const loadingEnv = envValid && !env.done;

  if (!isOpen) return null;

  const name = isSelf ? identity?.name ?? "You" : member?.display_name ?? "Friend";
  const character = isSelf && identity ? markerCharacterFor(identity.clientId) : member?.marker_character ?? "Z";
  const hue = isSelf ? ZYVRO_ACCENT : markerHueFor(member?.client_id ?? "z");
  const lastSeen = isSelf ? own?.ts ?? null : member?.recorded_at ?? member?.last_seen_at ?? null;
  const fresh = lastSeen !== null && Date.now() - lastSeen < 30_000;
  const live = isSelf ? sharing && !!own : member ? onlineIds.has(member.client_id) || fresh : false;

  const distance =
    !isSelf && member?.lat !== null && member?.lng !== null && own
      ? haversineMeters(own.lat, own.lng, member!.lat!, member!.lng!)
      : null;

  const targetLat = isSelf ? own?.lat : member?.lat;
  const targetLng = isSelf ? own?.lng : member?.lng;
  const aqi = aqiInfo(air?.aqi ?? null);

  const close = () => select(null);

  return (
    <Drawer open={isOpen} onOpenChange={(o) => !o && close()} repositionInputs={false}>
      <DrawerContent aria-describedby={undefined} className="zyvro-sheet border border-white/10 bg-[#101312]">
        <div className="mx-auto w-full max-w-md px-5 pt-1 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
          <DrawerTitle className="sr-only">{name}</DrawerTitle>

          {/* header */}
          <div className="flex items-center gap-3.5 py-3">
            <div className="relative">
              <Badge character={character} hue={hue} />
              <span
                className={
                  "absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-[2.5px] border-[#101312] " +
                  (live ? "bg-[#3ECF8E]" : "bg-[#5A615C]")
                }
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[19px] font-bold leading-tight tracking-tight text-[#EDEAE0]">{name}</div>
              <div className="mt-1 flex items-center gap-1.5">
                {live ? (
                  <>
                    <span className="zyvro-live-dot" />
                    <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-[#3ECF8E]">Live</span>
                  </>
                ) : (
                  <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-[#8A918B]">
                    Last seen · {timeAgo(lastSeen)}
                  </span>
                )}
                {isSelf && group && (
                  <span className="ml-1 rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold text-[#8A918B]">
                    {group.code}
                  </span>
                )}
              </div>
            </div>
            {targetLat != null && targetLng != null && (
              <button
                aria-label="Center map"
                onClick={() => {
                  mapApi?.flyTo(targetLat, targetLng, 15);
                }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-[#0B0D0C] text-[#B9BFB8] active:bg-[#1B201D]"
              >
                <LocateFixed className="h-[18px] w-[18px]" strokeWidth={2.2} />
              </button>
            )}
          </div>

          {!isSelf && member && !member.sharing && (
            <div className="rounded-xl border border-white/10 bg-[#0B0D0C] px-4 py-3 text-[12.5px] text-[#8A918B]">
              {name} paused location sharing.
            </div>
          )}

          {isSelf && (
            <div className="mt-2 flex items-center justify-between rounded-xl border border-white/10 bg-[#0B0D0C] px-4 py-3">
              <div className="min-w-0 pr-3">
                <div className="text-[13px] font-semibold text-[#EDEAE0]">
                  {sharing ? "Sharing your location" : "Sharing paused"}
                </div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-[#8A918B]">
                  {sharing ? `Visible to members of ${group?.code ?? "your group"}.` : "Friends cannot see your location."}
                </div>
              </div>
              <button
                onClick={() => onToggleSharing(!sharing)}
                className={
                  "flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-[12px] font-bold transition-colors " +
                  (sharing
                    ? "border border-white/10 bg-transparent text-[#EDEAE0]"
                    : "bg-[#3ECF8E] text-[#07130C]")
                }
              >
                {sharing ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                {sharing ? "Pause" : "Resume"}
              </button>
            </div>
          )}

          {/* location rows */}
          {hasTarget && (
            <>
              <SectionLabel>Location</SectionLabel>
              <div className="rounded-2xl border border-white/10 bg-[#0B0D0C] px-4 py-1">
                <Row
                  icon={<Compass className="h-4 w-4" strokeWidth={2} />}
                  label="Area"
                  value={
                    loadingEnv && !area
                      ? <span className="text-[#5A615C]">Locating…</span>
                      : area ?? (targetLat != null && targetLng != null ? formatCoords(targetLat, targetLng) : "—")
                  }
                />
                <div className="h-px bg-white/[0.06]" />
                <Row
                  icon={<LocateFixed className="h-4 w-4" strokeWidth={2} />}
                  label={isSelf ? "Your position" : "Distance from you"}
                  value={isSelf ? (own ? formatCoords(own.lat, own.lng) : "No fix yet") : distance !== null ? formatDistance(distance) : "—"}
                  mono
                />
                <div className="h-px bg-white/[0.06]" />
                <Row
                  icon={<Clock3 className="h-4 w-4" strokeWidth={2} />}
                  label="Updated"
                  value={timeAgo(isSelf ? own?.ts : member?.recorded_at)}
                />
              </div>
            </>
          )}

          {/* weather */}
          {hasTarget && (
            <>
              <SectionLabel>Weather</SectionLabel>
              <div className="rounded-2xl border border-white/10 bg-[#0B0D0C] px-4 py-3.5">
                {weather ? (
                  <>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[28px] font-bold leading-none tracking-tight text-[#EDEAE0]">
                          {Math.round(weather.temperature)}°
                        </div>
                        <div className="mt-1.5 text-[12.5px] font-medium text-[#8A918B]">
                          {wmoLabel(weather.weatherCode)} · feels {Math.round(weather.apparent)}°
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-[12px] font-semibold text-[#B9BFB8]">
                        <Wind className="h-3.5 w-3.5 text-[#6B716B]" />
                        {Math.round(weather.windSpeed)} km/h
                        <Compass className="ml-1 h-3.5 w-3.5 text-[#6B716B]" style={{ transform: `rotate(${weather.windDirection}deg)` }} />
                      </div>
                    </div>

                    <div className="mt-3 h-px bg-white/[0.06]" />

                    <div className="mt-1">
                      <Row icon={<Thermometer className="h-4 w-4" strokeWidth={2} />} label="Humidity" value={`${Math.round(weather.humidity)}%`} mono />
                      <div className="h-px bg-white/[0.06]" />
                      <Row icon={<Droplets className="h-4 w-4" strokeWidth={2} />} label="Precipitation" value={`${weather.precipitation.toFixed(1)} mm`} mono />
                      <div className="h-px bg-white/[0.06]" />
                      <Row icon={<CloudRain className="h-4 w-4" strokeWidth={2} />} label="Cloud cover" value={`${Math.round(weather.cloudCover)}%`} mono />
                      <div className="h-px bg-white/[0.06]" />
                      <div className="flex items-center justify-between gap-3 py-2">
                        <span className="flex items-center gap-2.5 text-[12.5px] font-medium text-[#8A918B]">
                          <span className="flex items-center gap-2 text-[#6B716B]"><Sunrise className="h-4 w-4" strokeWidth={2} />{weather.sunrise ? new Date(weather.sunrise).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                          <span className="flex items-center gap-2 text-[#6B716B]"><Sunset className="h-4 w-4" strokeWidth={2} />{weather.sunset ? new Date(weather.sunset).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                        </span>
                        <span className="text-[11px] text-[#5A615C]">{timeAgo(weather.at)}</span>
                      </div>
                    </div>
                  </>
                ) : loadingEnv ? (
                  <div className="flex items-center gap-3 py-2 text-[13px] text-[#5A615C]">
                    <Cloud className="h-4 w-4 animate-pulse" /> Reading conditions…
                  </div>
                ) : (
                  <div className="py-2 text-[13px] text-[#5A615C]">Weather unavailable here.</div>
                )}
              </div>
            </>
          )}

          {/* environment */}
          {hasTarget && (
            <>
              <SectionLabel>Environment</SectionLabel>
              <div className="rounded-2xl border border-white/10 bg-[#0B0D0C] px-4 py-1">
                <Row
                  icon={<Leaf className="h-4 w-4" strokeWidth={2} />}
                  label="Air quality"
                  value={
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: aqi.color }} />
                      {air?.aqi != null ? `${aqi.label} · ${Math.round(air.aqi)}` : aqi.label}
                    </span>
                  }
                />
                <div className="h-px bg-white/[0.06]" />
                <Row icon={<Fan className="h-4 w-4" strokeWidth={2} />} label="PM2.5" value={air?.pm25 != null ? `${air.pm25.toFixed(0)} µg/m³` : "—"} mono />
                <div className="h-px bg-white/[0.06]" />
                <Row icon={<Fan className="h-4 w-4" strokeWidth={2} />} label="PM10" value={air?.pm10 != null ? `${air.pm10.toFixed(0)} µg/m³` : "—"} mono />
                <div className="h-px bg-white/[0.06]" />
                <Row icon={<Cloud className="h-4 w-4" strokeWidth={2} />} label="Ozone" value={air?.ozone != null ? `${air.ozone.toFixed(0)} µg/m³` : "—"} mono />
              </div>
            </>
          )}

          {!hasTarget && (
            <div className="mt-2 rounded-xl border border-white/10 bg-[#0B0D0C] px-4 py-3 text-[12.5px] text-[#8A918B]">
              No location received yet. They appear here once their device reports a fix.
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
