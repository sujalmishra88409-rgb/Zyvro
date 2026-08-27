"use client";

// ZYVRO — settings sheet: sharing control, identity, group code, profile deletion.
import { useEffect, useState } from "react";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { useZyvro } from "@/lib/client/store";
import { markerCharacterFor } from "@/lib/marker-style";
import { Badge as SharedBadge } from "@/components/zyvro/FriendSheet";
import { Check, Copy, Pencil, PauseCircle, PlayCircle, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

export default function SettingsSheet({
  onToggleSharing,
  onRename,
  onSwitchGroup,
  onDeleteProfile,
}: {
  onToggleSharing: (enabled: boolean) => void;
  onRename: (name: string) => Promise<boolean>;
  onSwitchGroup: (code: string) => Promise<boolean>;
  onDeleteProfile: () => Promise<boolean>;
}) {
  const open = useZyvro((s) => s.settingsOpen);
  const setOpen = useZyvro((s) => s.setSettingsOpen);
  const identity = useZyvro((s) => s.identity);
  const group = useZyvro((s) => s.group);
  const sharing = useZyvro((s) => s.sharing);
  const own = useZyvro((s) => s.own);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const shownName = nameDraft ?? identity?.name ?? "";

  const code = group?.code ?? identity?.groupId ?? "";

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Group code copied");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy");
    }
  };

  const saveName = async () => {
    const trimmed = (nameDraft ?? "").trim().replace(/\s+/g, " ");
    setEditingName(false);
    setNameDraft(null);
    if (!trimmed || !identity || trimmed === identity.name) return;
    const ok = await onRename(trimmed);
    if (ok) toast.success("Name updated");
  };

  const join = async () => {
    const c = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,12}$/.test(c)) {
      toast.error("Codes are 3–12 letters or digits");
      return;
    }
    setJoining(true);
    const ok = await onSwitchGroup(c);
    setJoining(false);
    if (ok) {
      setJoinCode("");
      setOpen(false);
    }
  };

  const doDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    const ok = await onDeleteProfile();
    setDeleting(false);
    setConfirmDelete(false);
    if (ok) {
      setOpen(false);
      toast.success("Profile deleted");
    }
  };

  return (
    <Drawer open={open} onOpenChange={setOpen} repositionInputs={false}>
      <DrawerContent aria-describedby={undefined} className="zyvro-sheet border border-white/10 bg-[#101312]">
        <div className="mx-auto w-full max-w-md px-5 pt-1 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          <DrawerTitle className="sr-only">Settings</DrawerTitle>
          <div className="py-2 text-[19px] font-bold tracking-tight text-[#EDEAE0]">Settings</div>

          {/* identity */}
          <div className="mt-2 rounded-2xl border border-white/10 bg-[#0B0D0C] px-4 py-3.5">
            <div className="flex items-center gap-3.5">
              <SharedBadge character={identity ? markerCharacterFor(identity.clientId) : "Z"} hue="#3ECF8E" size={42} />
              <div className="min-w-0 flex-1">
                {editingName ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={shownName}
                      maxLength={24}
                      onChange={(e) => setNameDraft(e.target.value.slice(0, 24))}
                      onKeyDown={(e) => e.key === "Enter" && saveName()}
                      className="h-10 w-full rounded-xl border border-white/10 bg-[#101312] px-3 text-[14px] font-semibold text-[#EDEAE0] outline-none focus:border-[#3ECF8E]/50"
                    />
                    <button onClick={saveName} className="flex h-10 shrink-0 items-center rounded-xl bg-[#3ECF8E] px-3.5 text-[12px] font-bold text-[#07130C]">
                      Save
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[16px] font-bold text-[#EDEAE0]">{identity?.name ?? "—"}</span>
                      <button
                        aria-label="Edit name"
                        onClick={() => {
                          setNameDraft(identity?.name ?? "");
                          setEditingName(true);
                        }}
                        className="text-[#5A615C] transition-colors hover:text-[#8A918B]"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-[#5A615C]">Anonymous ID · stays on this device</div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* sharing */}
          <div className="mt-3 rounded-2xl border border-white/10 bg-[#0B0D0C] px-4 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-[#EDEAE0]">Location sharing</div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-[#8A918B]">
                  {sharing
                    ? own
                      ? "On — friends in your group can see you."
                      : "On — waiting for a GPS fix."
                    : "Paused — nobody can see you."}
                </div>
              </div>
              <button
                onClick={() => onToggleSharing(!sharing)}
                aria-label={sharing ? "Pause sharing" : "Resume sharing"}
                className={
                  "flex h-11 shrink-0 items-center gap-2 rounded-full px-5 text-[12.5px] font-bold transition-all active:scale-[0.97] " +
                  (sharing ? "border border-white/10 text-[#EDEAE0]" : "bg-[#3ECF8E] text-[#07130C]")
                }
              >
                {sharing ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                {sharing ? "Pause" : "Resume"}
              </button>
            </div>
          </div>

          {/* group */}
          <div className="mt-3 rounded-2xl border border-white/10 bg-[#0B0D0C] px-4 py-3.5">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-[#EDEAE0]">
              <Users className="h-4 w-4 text-[#8A918B]" />
              {group?.name ?? "Group"}
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <div className="flex h-11 flex-1 items-center rounded-xl border border-white/10 bg-[#101312] px-4">
                <span className="text-[15px] font-bold tracking-[0.22em] text-[#EDEAE0]">{code}</span>
              </div>
              <button
                onClick={copyCode}
                aria-label="Copy group code"
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-[#101312] text-[#B9BFB8] active:bg-[#1B201D]"
              >
                {copied ? <Check className="h-4 w-4 text-[#3ECF8E]" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[#5A615C]">
              Friends enter this code to join your circle. Only members can see each other.
            </p>

            <div className="mt-3 flex items-center gap-2">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 12))}
                onKeyDown={(e) => e.key === "Enter" && join()}
                placeholder="Join another code"
                autoComplete="off"
                spellCheck={false}
                className="h-11 flex-1 rounded-xl border border-white/10 bg-[#101312] px-4 text-[13.5px] font-semibold tracking-wider text-[#EDEAE0] placeholder:font-medium placeholder:tracking-normal placeholder:text-[#5A615C] outline-none focus:border-[#3ECF8E]/50"
              />
              <button
                onClick={join}
                disabled={joining || !joinCode.trim()}
                className="h-11 rounded-xl border border-white/10 bg-[#101312] px-4 text-[12.5px] font-bold text-[#EDEAE0] active:bg-[#1B201D] disabled:opacity-35"
              >
                {joining ? "…" : "Join"}
              </button>
            </div>
          </div>

          {/* danger zone — delete profile */}
          <div className="mt-3 rounded-2xl border border-[#E5484D]/25 bg-[#140E0E] px-4 py-3.5">
            <div className="text-[14px] font-semibold text-[#E5484D]">Delete profile</div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-[#8A918B]">
              Removes you from the map and every friend's view, and deletes your
              stored location. This cannot be undone.
            </p>
            <button
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  setTimeout(() => setConfirmDelete(false), 6000);
                  return;
                }
                void doDelete();
              }}
              disabled={deleting}
              className={
                "mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[13px] font-bold transition-colors disabled:opacity-50 " +
                (confirmDelete
                  ? "bg-[#E5484D] text-white"
                  : "border border-[#E5484D]/40 bg-transparent text-[#E5484D]")
              }
            >
              <Trash2 className="h-4 w-4" strokeWidth={2.2} />
              {deleting ? "Deleting…" : confirmDelete ? "Tap again to permanently delete" : "Delete my profile"}
            </button>
          </div>

          <p className="mt-4 text-center text-[10.5px] leading-relaxed text-[#4A504B]">
            ZYVRO · private friend locations · dark by design
          </p>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
