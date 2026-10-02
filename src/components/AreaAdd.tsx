/**
 * Contextual Add (phase 4, feature 4A).
 *
 * One control, mounted by an area, offering that area's verbs and nothing else.
 * The verbs come from `src/lib/areaActions.ts`, where each one is bound to a
 * mutation that already exists — so the menu cannot offer a capability Panel
 * does not have, which is the failure mode a hand-written action menu has and a
 * descriptor table does not.
 *
 * ## Why the area supplies the handlers
 *
 * This component deliberately knows nothing about forms. The area already owns
 * its forms, its validation and its toasts; re-implementing them here would
 * duplicate every mutation's guard in a second place, and a guard duplicated in
 * a UI is a guard that eventually disagrees with the server. The contract is
 * therefore narrow: render the menu, call back with a verb id, let the area do
 * what it already knows how to do.
 *
 * ## A verb with no handler is not rendered
 *
 * If an area forgets to wire a verb, the button does not appear rather than
 * opening an empty form. Silence is the honest failure; a button that does
 * nothing is a lie about capability.
 */

import { ChevronDown, Plus } from "lucide-react";
import { useState } from "react";

import type { AreaVerb, AreaVerbId } from "@/lib/areaActions";
import { verbsForArea } from "@/lib/areaActions";
import { cn } from "@/lib/utils";

export function AreaAdd({
  area,
  label = "Add",
  onSelect,
  className,
}: {
  area: string;
  label?: string;
  /** Handlers keyed by verb id. A verb with no entry is not offered. */
  onSelect: Partial<Record<AreaVerbId, () => void>>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const offered = verbsForArea(area).filter((verb) => onSelect[verb.id] !== undefined);

  if (offered.length === 0) return null;

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="brutal flex h-11 items-center gap-2 bg-primary px-5 text-[11px] font-bold uppercase transition-colors"
      >
        <Plus className="size-4" />
        {label}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          {/* Click-away: a menu that stays open after the user has moved on is a
              menu that ends up covering the thing they wanted to see. */}
          <button
            type="button"
            aria-label="Close"
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <ul
            role="menu"
            className="brutal absolute left-0 z-20 mt-2 flex w-72 flex-col border-2 border-border bg-card"
          >
            {offered.map((verb: AreaVerb) => (
              <li key={verb.id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onSelect[verb.id]?.();
                  }}
                  className="flex w-full flex-col gap-0.5 border-b-2 border-border px-3 py-2.5 text-left last:border-b-0 hover:bg-muted"
                >
                  <span className="text-[11px] font-bold uppercase">{verb.label}</span>
                  <span className="text-[10px] leading-relaxed text-muted-foreground">
                    {verb.hint}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
