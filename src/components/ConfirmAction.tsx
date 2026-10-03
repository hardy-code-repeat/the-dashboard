/**
 * Two steps before something irreversible happens.
 *
 * ## Why this exists
 *
 * Every delete in Panel was a single click on a small trash icon, with no
 * confirmation and no undo. That is not a stylistic disagreement: `removeTask`
 * and `clearCompleted` are **real deletes** — there is no tombstone, no soft
 * delete, no undo column — so a misclick loses data with no path back. "Clear
 * completed" is the worst of them, because one click on a link that looks like
 * a caption removes up to `DASHBOARD_TASKS` rows at once.
 *
 * Merge and unmerge are deliberately **not** routed through here: ADR-023 makes
 * a merge a tombstone and `unmerge` clears two fields, so both are already
 * reversible and a confirmation would be noise on a button the user can undo.
 *
 * ## Why inline rather than `window.confirm`
 *
 * `window.confirm` blocks the event loop, cannot be styled, is suppressed in
 * some embedded webviews, and reads as a browser dialog in a product with a
 * deliberate visual language. An inline swap keeps the control where the user's
 * eye already is.
 *
 * ## Why the confirm button takes focus
 *
 * The pair replaces the trigger, so without this a keyboard user's focus falls
 * back to `<body>` and they have to tab from the top of the document to find out
 * what just happened. Moving focus to the confirm button puts them exactly where
 * the decision is, which is also where Escape belongs.
 *
 * ## Escape and blur
 *
 * Escape cancels. Clicking away does **not**: an accidental click outside is not
 * a decision, and dismissing on blur would let a stray click silently cancel
 * something the user was in the middle of confirming.
 */

import { useEffect, useRef, useState } from "react";

/** Tailwind classes for the destructive button. Shared so both sites match. */
const CONFIRM_CLASS =
  "brutal-press inline-flex items-center gap-1.5 border-2 border-foreground bg-primary px-2 py-1 " +
  "text-[10px] font-bold uppercase text-primary-foreground";

const CANCEL_CLASS =
  "brutal-press border-2 border-border px-2 py-1 text-[10px] font-bold uppercase text-muted-foreground " +
  "hover:bg-muted";

export interface ConfirmActionProps {
  /**
   * Runs only after the second click. May be async; the button waits for it.
   *
   * `unknown` rather than `void`, because Convex mutations return their own
   * value (`removeTask` returns `null`) and `() => Promise<null>` is not
   * assignable to `() => Promise<void>`. The return value is discarded either
   * way — what matters is that a rejection is caught, not what it resolves to.
   */
  readonly onConfirm: () => unknown;
  /** The trigger's accessible name. Icon-only triggers must supply this. */
  readonly label: string;
  /** What the confirm button says. Should name the consequence, not "Yes". */
  readonly confirmLabel: string;
  /** The trigger's own className, so it keeps the caller's shape. */
  readonly className?: string;
  /** Render the trigger yourself. Receives the click handler to spread. */
  readonly children?: (props: { onClick: () => void; "aria-label": string }) => React.ReactNode;
  /** Disable the trigger entirely, e.g. while a mutation is in flight. */
  readonly disabled?: boolean;
}

export function ConfirmAction({
  onConfirm,
  label,
  confirmLabel,
  className,
  children,
  disabled,
}: ConfirmActionProps) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (asking) confirmRef.current?.focus();
  }, [asking]);

  if (!asking) {
    if (children) {
      return (
        <>
          {children({
            onClick: () => setAsking(true),
            "aria-label": label,
          })}
        </>
      );
    }
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAsking(true)}
        aria-label={label}
        className={className}
      >
        {label}
      </button>
    );
  }

  const commit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
      // Only leave the confirming state when the action actually succeeded. A
      // rejected mutation throws and the caller toasts; the pair stays put so the
      // user can retry without re-arming the whole interaction.
    } catch {
      // Deliberately swallowed: every call site already reports its own error.
      // The button must not fall back to a second attempt at the same action.
      setBusy(false);
      return;
    }
    setBusy(false);
    setAsking(false);
  };

  return (
    <span
      className="inline-flex items-center gap-1"
      role="group"
      aria-label={confirmLabel}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setAsking(false);
        }
      }}
    >
      <button
        ref={confirmRef}
        type="button"
        disabled={busy}
        onClick={() => void commit()}
        className={CONFIRM_CLASS}
      >
        {busy ? "Working…" : confirmLabel}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setAsking(false)}
        className={CANCEL_CLASS}
      >
        Keep
      </button>
    </span>
  );
}