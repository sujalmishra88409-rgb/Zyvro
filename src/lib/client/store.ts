// ZYVRO — client state (zustand)
"use client";

import { create } from "zustand";
import type { LocalIdentity } from "@/lib/client/identity";
import type { ZyvroGroup, MemberState } from "@/lib/types";

export interface OwnFix {
  lat: number;
  lng: number;
  accuracy: number | null;
  ts: number;
}

export interface MapApi {
  flyTo(lat: number, lng: number, zoom?: number): void;
  fitAll(): void;
  zoomIn(): void;
  zoomOut(): void;
}

interface ZyvroState {
  mounted: boolean;
  identity: LocalIdentity | null;
  group: ZyvroGroup | null;

  /** Members as known from server + realtime merge (excludes self). */
  members: MemberState[];
  /** client_ids currently online (presence / status events). */
  onlineIds: Set<string>;

  own: OwnFix | null;
  geoDenied: boolean;
  geoWaiting: boolean;
  /** Permission OK but no fix (timeout / unavailable) — shows the retry banner. */
  geoStuck: boolean;
  sharing: boolean;

  selectedId: string | null;
  nameSheetOpen: boolean;
  settingsOpen: boolean;
  /** A register/join round-trip is in flight — NameSheet submit is locked. */
  registering: boolean;

  mapApi: MapApi | null;
  /** increments to ask the map to re-sync markers */
  markerEpoch: number;

  setMounted(): void;
  setIdentity(id: LocalIdentity | null): void;
  setGroup(g: ZyvroGroup | null): void;
  setMembers(members: MemberState[]): void;
  mergeLoc(clientId: string, lat: number, lng: number, accuracy: number | null, recordedAt: number): void;
  setOnline(clientId: string, online: boolean): void;
  setMemberSharing(clientId: string, enabled: boolean): void;
  setOwn(fix: OwnFix): void;
  setGeoDenied(denied: boolean): void;
  setGeoWaiting(waiting: boolean): void;
  setGeoStuck(stuck: boolean): void;
  setSharing(enabled: boolean): void;
  select(clientId: string | null): void;
  setNameSheetOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  setRegistering(registering: boolean): void;
  setMapApi(api: MapApi | null): void;
  bumpMarkers(): void;
  removeMember(clientId: string): void;
  resetForDeletedProfile(): void;
}

export const useZyvro = create<ZyvroState>((set) => ({
  mounted: false,
  identity: null,
  group: null,
  members: [],
  onlineIds: new Set(),
  own: null,
  geoDenied: false,
  geoWaiting: false,
  geoStuck: false,
  sharing: true,
  selectedId: null,
  nameSheetOpen: false,
  settingsOpen: false,
  registering: false,
  mapApi: null,
  markerEpoch: 0,

  setMounted: () => set({ mounted: true }),
  setIdentity: (identity) => set({ identity }),
  setGroup: (group) => set({ group }),
  setMembers: (members) =>
    set({ members: dedupeMembers(members), markerEpoch: Date.now() }),
  mergeLoc: (clientId, lat, lng, accuracy, recordedAt) =>
    set((s) => {
      const idx = s.members.findIndex((m) => m.client_id === clientId);
      if (idx === -1) {
        // Unknown member moved before a members refresh — request a resync via epoch bump only.
        return { markerEpoch: Date.now() };
      }
      const members = s.members.slice();
      members[idx] = { ...members[idx], lat, lng, accuracy_m: accuracy, recorded_at: recordedAt, sharing: true };
      const onlineIds = new Set(s.onlineIds);
      onlineIds.add(clientId);
      return { members, onlineIds, markerEpoch: Date.now() };
    }),
  setOnline: (clientId, online) =>
    set((s) => {
      const onlineIds = new Set(s.onlineIds);
      if (online) onlineIds.add(clientId);
      else onlineIds.delete(clientId);
      return { onlineIds, markerEpoch: Date.now() };
    }),
  setMemberSharing: (clientId, enabled) =>
    set((s) => {
      const members = s.members.map((m) =>
        m.client_id === clientId
          ? enabled
            ? m
            : { ...m, sharing: false, lat: null, lng: null, accuracy_m: null, recorded_at: null }
          : m
      );
      return { members, markerEpoch: Date.now() };
    }),
  setOwn: (fix) => set({ own: fix, markerEpoch: Date.now() }),
  setGeoDenied: (geoDenied) => set({ geoDenied }),
  setGeoWaiting: (geoWaiting) => set({ geoWaiting }),
  setGeoStuck: (geoStuck) => set({ geoStuck }),
  setSharing: (sharing) => set({ sharing }),
  select: (selectedId) => set({ selectedId }),
  setNameSheetOpen: (nameSheetOpen) => set({ nameSheetOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setRegistering: (registering) => set({ registering }),
  setMapApi: (mapApi) => set({ mapApi }),
  bumpMarkers: () => set({ markerEpoch: Date.now() }),
  removeMember: (clientId) =>
    set((s) => {
      const had = s.members.some((m) => m.client_id === clientId);
      if (!had && !s.onlineIds.has(clientId)) return {};
      const onlineIds = new Set(s.onlineIds);
      onlineIds.delete(clientId);
      return {
        members: s.members.filter((m) => m.client_id !== clientId),
        onlineIds,
        selectedId: s.selectedId === clientId ? null : s.selectedId,
        markerEpoch: Date.now(),
      };
    }),
  resetForDeletedProfile: () =>
    set({
      identity: null,
      group: null,
      members: [],
      onlineIds: new Set(),
      sharing: true,
      selectedId: null,
      settingsOpen: false,
      nameSheetOpen: true,
      markerEpoch: Date.now(),
    }),
}));

/**
 * One human can end up with two rows (e.g. they re-joined from a cleared
 * browser before server-side merging existed). Keep only the freshest row
 * per normalized display name so nobody is ever shown twice on the map.
 */
export function dedupeMembers(members: MemberState[]): MemberState[] {
  const activityOf = (x: MemberState) => x.recorded_at ?? x.last_seen_at ?? 0;
  const winnerByName = new Map<string, MemberState>();
  for (const m of members) {
    const key = m.display_name.trim().toLowerCase();
    const prev = winnerByName.get(key);
    if (!prev || activityOf(m) > activityOf(prev)) winnerByName.set(key, m);
  }
  const seen = new Set<string>();
  const out: MemberState[] = [];
  for (const m of members) {
    const key = m.display_name.trim().toLowerCase();
    if (winnerByName.get(key) !== m || seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}
