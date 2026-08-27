import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  addMembership,
  findGroupMemberByName,
  findUserByClientId,
  getOrCreateGroupByCode,
  isMember,
  registerFreshUser,
  upsertUser,
} from "@/lib/server/turso";
import { DEFAULT_GROUP_CODE } from "@/lib/types";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  client_id: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/, "client_id must be url-safe"),
  display_name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(24, "Keep the name under 24 characters")
    .transform((s) => s.replace(/\s+/g, " ")),
  group_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3,12}$/)
    .optional(),
});

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const { client_id, display_name } = parsed.data;
  const groupCode = parsed.data.group_code ?? DEFAULT_GROUP_CODE;

  try {
    const group = await getOrCreateGroupByCode(groupCode);
    const existingSelf = await findUserByClientId(client_id);

    // Returning member of this group: refresh the name, but never let a
    // rename collide with a DIFFERENT member's name (that would hijack
    // their profile).
    if (existingSelf && (await isMember(group.id, existingSelf.id))) {
      const clash = await findGroupMemberByName(group.id, display_name);
      if (clash && clash.id !== existingSelf.id) {
        return NextResponse.json(
          { error: "That name is already used in this group" },
          { status: 409 }
        );
      }
      const user = await upsertUser(client_id, display_name);
      return NextResponse.json({ user, group });
    }

    // Known device identity joining a new group.
    if (existingSelf) {
      const clash = await findGroupMemberByName(group.id, display_name);
      if (clash && clash.id !== existingSelf.id) {
        return NextResponse.json(
          { error: "That name is already used in this group" },
          { status: 409 }
        );
      }
      await addMembership(group.id, existingSelf.id);
      const user = await upsertUser(client_id, display_name);
      return NextResponse.json({ user, group });
    }

    // Fresh device identity. Atomic claim-or-create: if someone already
    // holds this name in the group (same human re-joining — cleared browser,
    // new phone, preview iframe) the batch ADOPTS that profile; otherwise it
    // creates one. Claim + insert happen in a single write transaction so
    // concurrent registers (double-tap / two contexts at once) can never
    // produce two profiles for one person.
    const user = await registerFreshUser(group.id, client_id, display_name);
    return NextResponse.json({ user, group });
  } catch (e) {
    console.error("register failed", e);
    return NextResponse.json({ error: "Could not register right now" }, { status: 500 });
  }
}
