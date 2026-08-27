// ZYVRO — shared types (client + server)

export interface ZyvroGroup {
  id: string;
  name: string;
  code: string;
}

export interface ZyvroIdentity {
  client_id: string;
  display_name: string;
  marker_character: string;
  sharing_enabled: boolean;
}

export interface RegisterResponse {
  user: ZyvroIdentity;
  group: ZyvroGroup;
}

export interface MemberState {
  client_id: string;
  display_name: string;
  marker_character: string;
  sharing: boolean;
  is_self: boolean;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  recorded_at: number | null;
  last_seen_at: number | null;
}

export interface MembersResponse {
  group: ZyvroGroup;
  members: MemberState[];
}

export interface LocationFix {
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  heading_deg: number | null;
  recorded_at: number;
}

/** Realtime "loc" event payload (server → group channel) */
export interface LocBroadcast {
  client_id: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  recorded_at: number;
}

/** Realtime "sharing" event payload */
export interface SharingBroadcast {
  client_id: string;
  enabled: boolean;
}

/** Realtime "status" event payload */
export interface StatusBroadcast {
  client_id: string;
  online: boolean;
}

/** Realtime "left" event payload — a member deleted their profile. */
export interface LeftBroadcast {
  client_id: string;
}

export const DEFAULT_GROUP_CODE = "ZYVRO";
