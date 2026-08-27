"use client";

// ZYVRO — first-visit name prompt (compact bottom sheet over the map, spec §2)
import { useState, useRef, useEffect } from "react";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { useZyvro } from "@/lib/client/store";

export default function NameSheet({ onSubmit, busy }: { onSubmit: (name: string) => void; busy: boolean }) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const open = useZyvro((s) => s.nameSheetOpen);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 350);
      return () => clearTimeout(t);
    }
  }, [open]);

  const submit = () => {
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (!trimmed || busy) return;
    onSubmit(trimmed);
  };

  return (
    <Drawer open={open} dismissible={false}>
      <DrawerContent aria-describedby={undefined} className="zyvro-sheet-no-handle border-t border-white/10 bg-[#101312]">
        <div className="mx-auto w-full max-w-md px-6 pt-3 pb-[calc(env(safe-area-inset-bottom)+1.75rem)]">
          <DrawerTitle className="sr-only">Join ZYVRO</DrawerTitle>

          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-[#0B0D0C]">
              { }
              <img src="/zyvro-mark.png" alt="ZYVRO logo" className="h-7 w-7" draggable={false} />
            </div>

            <h2 className="text-[22px] font-bold tracking-tight text-[#EDEAE0]">
              What should your friends <span className="text-[#3ECF8E]">call you?</span>
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#8A918B]">
              One name. No signup. Your identity stays on this device.
            </p>
          </div>

          <div className="mt-6 space-y-3">
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 24))}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Your name"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={24}
              className="h-14 w-full rounded-2xl border border-white/10 bg-[#0B0D0C] px-5 text-[16px] font-medium text-[#EDEAE0] placeholder:text-[#5A615C] outline-none transition-colors focus:border-[#3ECF8E]/50"
            />
            <button
              onClick={submit}
              disabled={!name.trim() || busy}
              className="h-14 w-full rounded-2xl bg-[#3ECF8E] text-[15px] font-bold tracking-wide text-[#07130C] transition-all active:scale-[0.985] disabled:opacity-35 disabled:active:scale-100"
            >
              {busy ? "Entering…" : "Enter ZYVRO"}
            </button>
          </div>

          <p className="mt-4 text-center text-[11px] leading-relaxed text-[#5A615C]">
            By entering, your live location is shared only with members of your ZYVRO group.
            You can pause sharing anytime.
          </p>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
