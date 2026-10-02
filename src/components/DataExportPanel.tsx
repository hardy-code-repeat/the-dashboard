import { useConvex, useQuery } from "convex/react";
import { Download, FileJson, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The data-export control.
 *
 * **Why the button says what it does before it does it.** A download of
 * "everything I have" is the kind of control people click without reading, so
 * the panel states the scope *above* the button rather than in a dialog after
 * the fact: what comes out, and — more importantly — what does not.
 *
 * That second half is the part that matters. The export deliberately withholds
 * audit records and, absolutely, every credential. Saying so here is what stops
 * a user concluding later that Panel lost something.
 *
 * The filename carries the date so two downloads do not silently overwrite each
 * other, and the object is created with `URL.createObjectURL` and revoked
 * immediately after the click, so no blob URL is left alive in the tab.
 */
export function DataExportPanel() {
  const [busy, setBusy] = useState(false);
  const convex = useConvex();

  // Fetched live so the counts shown are the counts that will be exported,
  // rather than a hard-coded description that can drift from the backend. This
  // query is for the *description*; the download re-reads at click time below,
  // so a file is never a stale cache snapshot.
  const preview = useQuery(api.export.exportMyData, { exportedAt: 0 });

  const counts = preview?.manifest?.counts ?? {};
  const withheld = preview?.manifest?.withheld ?? {};
  const includedKeys = Object.keys(counts).filter((k) => !k.endsWith(".capped"));

  async function download() {
    setBusy(true);
    try {
      // Re-read at the moment of the click rather than reusing `preview`. The
      // reactive query may be a second or two behind, and an export that is
      // quietly stale is worse than one that takes an extra round trip.
      const now = Date.now();
      const result = await convex.query(api.export.exportMyData, { exportedAt: now });
      if (!result) throw new Error("export unavailable");

      const payload = { manifest: result.manifest, data: result.data };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `panel-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Export downloaded", {
        description: "It contains your own records. No credentials are included.",
      });
    } catch {
      toast.error("Could not build the export", {
        description: "Nothing was downloaded. Try again in a moment.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border-2 border-ink/20 bg-card p-4">
      <header className="mb-3 flex items-start gap-2">
        <FileJson className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div>
          <h3 className="text-sm font-semibold">Your data</h3>
          <p className="text-xs text-muted-foreground">
            A JSON file of the records you created, for your own use.
          </p>
        </div>
      </header>

      <div className="mb-3 space-y-1 text-xs">
        <p className="font-medium">Included</p>
        {preview === undefined ? (
          <p className="text-muted-foreground">Checking what would be included…</p>
        ) : includedKeys.length === 0 ? (
          <p className="text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground sm:grid-cols-3">
            {includedKeys.map((k) => (
              <li key={k} className="truncate">
                {k} <span className="tabular-nums">({counts[k]})</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-3 space-y-1 border-t border-ink/10 pt-2 text-xs">
        <p className="font-medium">Not included</p>
        <ul className="list-inside list-disc text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">No credentials</span> — no keys,
            tokens or session material of any kind
          </li>
          <li>No other member&rsquo;s data, even in a space you share</li>
          <li>
            Security records are counted only
            {Object.keys(withheld).length > 0 ? (
              <> — {Object.entries(withheld)
                .map(([k, v]) => `${v} ${k}`)
                .join(", ")}</>
            ) : null}
          </li>
        </ul>
      </div>

      <Button
        onClick={download}
        disabled={busy || preview === undefined}
        className={cn("w-full")}
        variant="outline"
      >
        <Download className="h-4 w-4" aria-hidden />
        {busy ? "Preparing…" : "Download my data"}
      </Button>

      <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="mt-px h-3 w-3 shrink-0" aria-hidden />
        <span>
          Deleting your account is a separate request and is not part of this download.
        </span>
      </p>
    </section>
  );
}