// ZYVRO — the session orchestrator: identity, geolocation, Ably realtime, resync.
//
// Realtime transport is ADAPTIVE:
// - If the group token's effective capability includes "subscribe", channel
//   messages are delivered as true push (ideal).
// - Otherwise (restricted Ably key), the client polls the Ably channel HISTORY
//   (~2.5 s cadence) which the server broadcasts into — same delivery path
//   (server → Ably → friends), slightly higher latency. The token endpoint
//   returns the ACTUAL issued capability so the client picks the right mode.
"use client";

import { useEffect, useRef, useCallback } from "react";
import * as Ably from "ably";
import { useZyvro } from "@/lib/client/store";
import { loadIdentity, saveIdentity } from "@/lib/client/identity";
import { haversineMeters } from "@/lib/client/geo";
import type {
  MembersResponse,
  RegisterResponse,
  LocBroadcast,
  SharingBroadcast,
  StatusBroadcast,
  LeftBroadcast,
} from "@/lib/types";
import { clearIdentity } from "@/lib/client/identity";
import { toast } from "sonner";

const SEND_MIN_INTERVAL_MS = 2500;
const SEND_MOVE_MIN_M = 8;
const SEND_HEARTBEAT_MS = 12000;
const RESYNC_MS = 60_000;
const HISTORY_POLL_MS = 2500;

interface TokenResponse {
  token: string;
  capability: string;
  expires: number;
}

export function useZyvroSession(): {
  registerAndStart: (name: string, groupId: string) => Promise<boolean>;
  switchGroup: (code: string) => Promise<boolean>;
  rename: (name: string) => Promise<boolean>;
  toggleSharing: (enabled: boolean) => Promise<void>;
  requestLocation: () => void;
  deleteProfile: () => Promise<boolean>;
} {
  const store = useZyvro;

  const ablyRef = useRef<Ably.Realtime | null>(null);
  const channelRef = useRef<Ably.RealtimeChannel | null>(null);
  const watchRef = useRef<number | null>(null);
  const lastSendRef = useRef<{ ts: number; lat: number; lng: number } | null>(null);
  const lastFixRef = useRef<{ lat: number; lng: number; accuracy: number | null; ts: number } | null>(null);
  const sessionRef = useRef<{ clientId: string; groupId: string } | null>(null);
  const resyncTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const historyTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pageHideRef = useRef<(() => void) | null>(null);
  const seenMsgIds = useRef<Set<string>>(new Set());
  const canSubscribeRef = useRef(false);
  const pollInflight = useRef(false);
  const geoFallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const registeringRef = useRef(false);

  // ------------------------------------------------------------- members sync
  const resyncMembers = useCallback(
    async (clientId: string, groupId: string) => {
      try {
        const res = await fetch(
          `/api/group/members?client_id=${encodeURIComponent(clientId)}&group_id=${encodeURIComponent(groupId)}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as MembersResponse;
        const s = store.getState();
        const others = data.members.filter((m) => !m.is_self);
        s.setGroup(data.group);
        s.setMembers(others);
        const self = data.members.find((m) => m.is_self);
        if (self) s.setSharing(self.sharing);
      } catch {
        // silent — periodic retries handle it
      }
    },
    [store]
  );

  // --------------------------------------------------- realtime event appliers
  const applyLoc = useCallback(
    (d: LocBroadcast, selfId: string) => {
      if (!d || d.client_id === selfId) return;
      store.getState().mergeLoc(d.client_id, d.lat, d.lng, d.accuracy_m ?? null, d.recorded_at);
    },
    [store]
  );
  const applySharing = useCallback(
    (d: SharingBroadcast, selfId: string) => {
      if (!d || d.client_id === selfId) return;
      store.getState().setMemberSharing(d.client_id, d.enabled);
    },
    [store]
  );
  const applyStatus = useCallback(
    (d: StatusBroadcast, selfId: string) => {
      if (!d || d.client_id === selfId) return;
      store.getState().setOnline(d.client_id, d.online);
    },
    [store]
  );
  const applyLeft = useCallback(
    (d: LeftBroadcast, selfId: string) => {
      if (!d || d.client_id === selfId) return;
      store.getState().removeMember(d.client_id);
    },
    [store]
  );

  // ---------------------------------------------- history-polling transport
  const startHistoryPolling = useCallback(
    (channel: Ably.RealtimeChannel, selfId: string) => {
      if (historyTimer.current) clearInterval(historyTimer.current);

      const poll = async () => {
        if (pollInflight.current) return;
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        pollInflight.current = true;
        try {
          const page = await channel.history({ direction: "forwards", limit: 100 });
          const items = (page?.items ?? []) as Ably.Message[];
          for (const msg of items) {
            const id =
              (msg as unknown as { id?: string }).id ??
              `${msg.timestamp}:${msg.name}:${JSON.stringify(msg.data).slice(0, 64)}`;
            if (seenMsgIds.current.has(id)) continue;
            seenMsgIds.current.add(id);
            if (msg.name === "loc") applyLoc(msg.data as LocBroadcast, selfId);
            else if (msg.name === "sharing") applySharing(msg.data as SharingBroadcast, selfId);
            else if (msg.name === "status") applyStatus(msg.data as StatusBroadcast, selfId);
            else if (msg.name === "left") applyLeft(msg.data as LeftBroadcast, selfId);
          }
          // Bound the dedupe set.
          if (seenMsgIds.current.size > 800) {
            const keep = Array.from(seenMsgIds.current).slice(-400);
            seenMsgIds.current = new Set(keep);
          }
        } catch {
          // transient errors are fine; next tick retries
        } finally {
          pollInflight.current = false;
        }
      };

      void poll();
      historyTimer.current = setInterval(() => void poll(), HISTORY_POLL_MS);

      const onVisible = () => {
        if (document.visibilityState === "visible") void poll();
      };
      document.addEventListener("visibilitychange", onVisible);
    },
    [applyLoc, applySharing, applyStatus, applyLeft]
  );

  // -------------------------------------------------------------- geolocation
  const sendFix = useCallback(
    async (
      clientId: string,
      groupId: string,
      fix: { lat: number; lng: number; accuracy: number | null; speed: number | null; heading: number | null }
    ) => {
      try {
        const res = await fetch("/api/location", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: clientId,
            group_id: groupId,
            latitude: fix.lat,
            longitude: fix.lng,
            accuracy_m: fix.accuracy,
            speed_mps: fix.speed,
            heading_deg: fix.heading,
            recorded_at: Date.now(),
          }),
        });
        if (res.status === 409) {
          // Server says sharing paused — align local state.
          store.getState().setSharing(false);
        }
      } catch {
        // network hiccup — next accepted fix retries
      }
    },
    [store]
  );

  const onGeoFix = useCallback(
    (pos: GeolocationPosition) => {
      const session = sessionRef.current;
      const s = store.getState();
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null;
      const stale = !!pos.timestamp && Date.now() - pos.timestamp > 60_000;

      // DISPLAY FIRST: show the user wherever their device thinks it is.
      // A noisy fix beats no fix — the old accuracy gate here dropped fixes
      // on weak-GPS devices, leaving the map stuck on its fallback view.
      s.setGeoDenied(false);
      s.setGeoWaiting(false);
      s.setGeoStuck(false);
      const fix = { lat, lng, accuracy, ts: Date.now() };
      lastFixRef.current = fix;
      s.setOwn(fix);

      if (!session || !s.sharing) return;

      // SENDING stays quality-gated per spec §9.
      if (accuracy !== null && accuracy > 500) return; // too noisy to share
      if (stale) return; // stale fix

      const now = Date.now();
      const lastSend = lastSendRef.current;
      if (lastSend) {
        const moved = haversineMeters(lastSend.lat, lastSend.lng, lat, lng);
        const due = now - lastSend.ts >= SEND_MIN_INTERVAL_MS;
        const meaningful = moved >= SEND_MOVE_MIN_M || now - lastSend.ts >= SEND_HEARTBEAT_MS;
        if (!due || !meaningful) return;
      }
      lastSendRef.current = { ts: now, lat, lng };
      void sendFix(session.clientId, session.groupId, {
        lat,
        lng,
        accuracy,
        speed: Number.isFinite(pos.coords.speed) ? pos.coords.speed : null,
        heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
      });
    },
    [sendFix, store]
  );

  const onGeoError = useCallback(
    (err: GeolocationPositionError) => {
      const s = store.getState();
      if (err.code === err.PERMISSION_DENIED) {
        s.setGeoDenied(true);
        s.setGeoWaiting(false);
        return;
      }
      // TIMEOUT / POSITION_UNAVAILABLE: the device cannot produce a fix right
      // now (airplane mode, no GPS/network location, radio off…). Stop the
      // endless spinner and surface the tappable retry banner — but only when
      // no fix ever landed; a device that already has a fix just keeps the
      // last one on screen.
      if (!s.own && !lastFixRef.current) {
        s.setGeoWaiting(false);
        s.setGeoStuck(true);
      }
    },
    [store]
  );

  const startGeolocation = useCallback(() => {
    if (watchRef.current !== null) return;
    if (!("geolocation" in navigator)) {
      store.getState().setGeoDenied(true);
      return;
    }
    store.getState().setGeoWaiting(true);
    watchRef.current = navigator.geolocation.watchPosition(onGeoFix, onGeoError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 25000,
    });
    // Devices with a slow GPS lock: after 9 s without any fix, fall back to
    // coarse network location so the map never sits waiting forever.
    if (geoFallbackTimer.current) clearTimeout(geoFallbackTimer.current);
    geoFallbackTimer.current = setTimeout(() => {
      geoFallbackTimer.current = null;
      if (lastFixRef.current) return; // a fix already arrived
      if (!("geolocation" in navigator)) return;
      navigator.geolocation.getCurrentPosition(onGeoFix, onGeoError, {
        enableHighAccuracy: false,
        maximumAge: 30_000,
        timeout: 15_000,
      });
    }, 9_000);
  }, [onGeoFix, onGeoError, store]);

  const requestLocation = useCallback(() => {
    // A single immediate fix helps re-permission flows after a denial — and
    // clears the stuck banner as soon as any position comes back.
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(onGeoFix, onGeoError, {
      enableHighAccuracy: true,
      timeout: 20000,
    });
  }, [onGeoFix, onGeoError]);

  // -------------------------------------------------------------- realtime
  const teardownRealtime = useCallback(() => {
    if (historyTimer.current) {
      clearInterval(historyTimer.current);
      historyTimer.current = null;
    }
    try {
      void Promise.resolve(channelRef.current?.presence.leave()).catch(() => {
        /* detached / already gone — fine */
      });
    } catch {
      /* noop */
    }
    try {
      channelRef.current?.unsubscribe();
    } catch {
      /* noop */
    }
    channelRef.current = null;
    try {
      ablyRef.current?.close();
    } catch {
      /* noop */
    }
    ablyRef.current = null;
    canSubscribeRef.current = false;
  }, []);

  const startRealtime = useCallback(
    async (clientId: string) => {
      teardownRealtime();
      seenMsgIds.current = new Set();

      // The channel is keyed by the server-confirmed internal group id —
      // resolved via the members sync (which accepts the code too).
      const group = store.getState().group;
      if (!group) {
        console.warn("realtime skipped: group not resolved yet");
        return;
      }
      const groupId = group.id;

      // Fetch the token once up-front so we can read the EFFECTIVE capability
      // (Ably downgrades requested capabilities to the issuing key's powers).
      let canSubscribe = false;
      const fetchToken = async (): Promise<Ably.TokenDetails> => {
        const res = await fetch(
          `/api/realtime/token?client_id=${encodeURIComponent(clientId)}&group_id=${encodeURIComponent(groupId)}`
        );
        if (!res.ok) throw new Error(`token ${res.status}`);
        const data = (await res.json()) as TokenResponse;
        try {
          const cap = JSON.parse(data.capability) as Record<string, string[]>;
          const perms = Object.values(cap).flat();
          canSubscribe = perms.includes("subscribe");
        } catch {
          canSubscribe = false;
        }
        return {
          token: data.token,
          capability: data.capability,
          issued: Math.floor(Date.now() / 1000),
          expires: data.expires,
        } as Ably.TokenDetails;
      };

      let initialToken: Ably.TokenDetails | null = null;
      try {
        initialToken = await fetchToken();
        canSubscribeRef.current = canSubscribe;
      } catch (e) {
        console.warn("initial token fetch failed", e);
      }

      const client = new Ably.Realtime({
        clientId,
        tokenDetails: initialToken ?? undefined,
        authCallback: async (_tokenParams, callback) => {
          try {
            callback(null, await fetchToken());
            canSubscribeRef.current = canSubscribe;
          } catch (e) {
            callback((e as Error).message ?? "token error", null);
          }
        },
        autoConnect: true,
      });
      ablyRef.current = client;

      const channelName = `zyvro:g:${groupId}:v1`;
      const channel = client.channels.get(channelName);
      channelRef.current = channel;

      try {
        await channel.attach();
      } catch {
        // attach failure must not break the session — history polling still works
      }

      // Push transport (only when the token really allows subscribe).
      if (canSubscribeRef.current) {
        channel.subscribe("loc", (msg) => applyLoc(msg.data as LocBroadcast, clientId));
        channel.subscribe("sharing", (msg) => applySharing(msg.data as SharingBroadcast, clientId));
        channel.subscribe("status", (msg) => applyStatus(msg.data as StatusBroadcast, clientId));
        channel.subscribe("left", (msg) => applyLeft(msg.data as LeftBroadcast, clientId));
      } else {
        // Restricted key: poll the broadcast history instead (server → Ably → us).
        startHistoryPolling(channel, clientId);
      }

      // Presence: keep a lightweight presence record for ourselves. On keys
      // with presence_subscribe this also delivers LIVE status to friends.
      try {
        await channel.presence.enter({ sharing: true });
      } catch {
        // presence is best-effort
      }
    },
    [applyLoc, applySharing, applyStatus, applyLeft, startHistoryPolling, teardownRealtime]
  );

  // ------------------------------------------------------------- lifecycle
  const stopAll = useCallback(() => {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    if (geoFallbackTimer.current) {
      clearTimeout(geoFallbackTimer.current);
      geoFallbackTimer.current = null;
    }
    if (resyncTimer.current) {
      clearInterval(resyncTimer.current);
      resyncTimer.current = null;
    }
    if (pageHideRef.current) {
      window.removeEventListener("pagehide", pageHideRef.current);
      pageHideRef.current = null;
    }
    teardownRealtime();
    sessionRef.current = null;
  }, [teardownRealtime]);

  const startSession = useCallback(
    async (clientId: string, groupIdOrCode: string) => {
      stopAll();
      sessionRef.current = { clientId, groupId: groupIdOrCode };
      await resyncMembers(clientId, groupIdOrCode);
      await startRealtime(clientId);

      resyncTimer.current = setInterval(() => {
        void resyncMembers(clientId, groupIdOrCode);
      }, RESYNC_MS);

      const s = store.getState();
      if (s.sharing) startGeolocation();

      // Best-effort offline signal when the page closes.
      const onHide = () => {
        try {
          void Promise.resolve(channelRef.current?.presence.leave()).catch(() => {
            /* noop */
          });
        } catch {
          /* noop */
        }
        try {
          navigator.sendBeacon(
            "/api/offline",
            new Blob([JSON.stringify({ client_id: clientId, group_id: groupIdOrCode })], { type: "text/plain" })
          );
        } catch {
          /* noop */
        }
      };
      if (pageHideRef.current) window.removeEventListener("pagehide", pageHideRef.current);
      pageHideRef.current = onHide;
      window.addEventListener("pagehide", onHide);
    },
    [resyncMembers, startRealtime, startGeolocation, stopAll, store]
  );

  // ---------------------------------------------------------------- actions
  const registerAndStart = useCallback(
    async (name: string, groupId: string): Promise<boolean> => {
      // Reentrancy lock: a double-tap on "Enter ZYVRO" (or boot + tap racing)
      // must not fire two concurrent registers — each would mint its own
      // fresh client_id before the first response saves the identity, which
      // is exactly how one person ends up with two profiles.
      if (registeringRef.current) return false;
      registeringRef.current = true;
      store.getState().setRegistering(true);
      try {
        const current = loadIdentity();
        const clientId = current?.clientId ?? crypto.randomUUID();
        try {
          const res = await fetch("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_id: clientId, display_name: name, group_code: groupId }),
          });
          if (!res.ok) {
            const j = (await res.json().catch(() => ({}))) as { error?: string };
            toast.error(j.error ?? "Could not join ZYVRO");
            return false;
          }
          const data = (await res.json()) as RegisterResponse;
          saveIdentity({ name: data.user.display_name, clientId, groupId: data.group.code });
          const s = store.getState();
          s.setIdentity({ name: data.user.display_name, clientId, groupId: data.group.code });
          s.setGroup(data.group);
          s.setSharing(data.user.sharing_enabled);
          s.setNameSheetOpen(false);
          await startSession(clientId, data.group.code);
          startGeolocation();
          return true;
        } catch {
          toast.error("Network error — try again");
          return false;
        }
      } finally {
        registeringRef.current = false;
        store.getState().setRegistering(false);
      }
    },
    [startSession, startGeolocation, store]
  );

  const switchGroup = useCallback(
    async (code: string): Promise<boolean> => {
      const s = store.getState();
      if (!s.identity) return false;
      const ok = await registerAndStart(s.identity.name, code);
      if (ok) toast.success(`Joined group ${code.toUpperCase()}`);
      return ok;
    },
    [registerAndStart]
  );

  const rename = useCallback(
    async (name: string): Promise<boolean> => {
      const s = store.getState();
      if (!s.identity) return false;
      return registerAndStart(name, s.identity.groupId);
    },
    [registerAndStart]
  );

  const toggleSharing = useCallback(
    async (enabled: boolean): Promise<void> => {
      const s = store.getState();
      if (!s.identity || !s.group) return;
      const clientId = s.identity.clientId;
      const groupId = s.group.id;
      s.setSharing(enabled);
      try {
        await fetch("/api/sharing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: clientId, group_id: groupId, enabled }),
        });
        try {
          await channelRef.current?.presence.update({ sharing: enabled });
        } catch {
          /* noop */
        }
        if (enabled) {
          startGeolocation();
          lastSendRef.current = null; // push the next fix immediately
          const fix = lastFixRef.current;
          if (fix) {
            void sendFix(clientId, groupId, {
              lat: fix.lat,
              lng: fix.lng,
              accuracy: fix.accuracy,
              speed: null,
              heading: null,
            });
          }
        } else {
          if (watchRef.current !== null) {
            navigator.geolocation.clearWatch(watchRef.current);
            watchRef.current = null;
          }
        }
      } catch {
        toast.error("Could not update sharing");
        s.setSharing(!enabled);
      }
    },
    [sendFix, startGeolocation, store]
  );

  const deleteProfile = useCallback(async (): Promise<boolean> => {
    const s = store.getState();
    if (!s.identity) return false;
    const clientId = s.identity.clientId;
    const doReq = () =>
      fetch("/api/profile/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });
    try {
      const res = await doReq();
      if (!res.ok) throw new Error("delete failed");
    } catch {
      // One retry — deleting the server profile matters for friends too.
      try {
        await new Promise((r) => setTimeout(r, 600));
        const res = await doReq();
        if (!res.ok) throw new Error("delete failed");
      } catch {
        toast.error("Could not delete right now — try again");
        return false;
      }
    }
    stopAll();
    clearIdentity();
    store.getState().resetForDeletedProfile();
    return true;
  }, [stopAll, store]);

  // -------------------------------------------------------------- boot
  useEffect(() => {
    store.getState().setMounted();
    const identity = loadIdentity();
    store.getState().setIdentity(identity);
    // Own GPS fix starts immediately — long before any network round-trips —
    // so the map flies to the user the moment the device has a position.
    startGeolocation();
    if (identity) {
      void registerAndStart(identity.name, identity.groupId);
    } else {
      store.getState().setNameSheetOpen(true);
    }
  }, [registerAndStart, startGeolocation, store]);

  useEffect(() => () => stopAll(), [stopAll]);

  return { registerAndStart, switchGroup, rename, toggleSharing, requestLocation, deleteProfile };
}
