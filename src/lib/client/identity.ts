// ZYVRO — local identity persistence (localStorage keys per master spec §10)

export interface LocalIdentity {
  name: string;
  clientId: string;
  groupId: string; // shareable group code (e.g. "ZYVRO")
}

const K_NAME = "zyvro_name";
const K_CLIENT = "zyvro_client_id";
const K_GROUP = "zyvro_group_id";
import { DEFAULT_GROUP_CODE } from "@/lib/types";

export function loadIdentity(): LocalIdentity | null {
  if (typeof window === "undefined") return null;
  const name = window.localStorage.getItem(K_NAME);
  let clientId = window.localStorage.getItem(K_CLIENT);
  if (!name || !clientId) return null;
  if (!/^[A-Za-z0-9-]{8,64}$/.test(clientId)) {
    // Corrupt legacy value — regenerate so registration still works.
    clientId = crypto.randomUUID();
    window.localStorage.setItem(K_CLIENT, clientId);
  }
  const groupId = window.localStorage.getItem(K_GROUP) ?? DEFAULT_GROUP_CODE;
  return { name, clientId, groupId };
}

export function saveIdentity(identity: LocalIdentity): void {
  window.localStorage.setItem(K_NAME, identity.name);
  window.localStorage.setItem(K_CLIENT, identity.clientId);
  window.localStorage.setItem(K_GROUP, identity.groupId);
}

export function clearIdentity(): void {
  window.localStorage.removeItem(K_NAME);
  window.localStorage.removeItem(K_CLIENT);
  window.localStorage.removeItem(K_GROUP);
}
