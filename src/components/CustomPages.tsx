/**
 * Custom Pages — the saved-view surface (ADR-033, Q-010).
 *
 * ## The load-bearing property of this file
 *
 * **This component creates no read that the Main Panel did not already
 * perform.** Every block below resolves to an existing query — the dashboard,
 * people, balances, commitments, documents, transactions — and Convex
 * deduplicates identical subscriptions on a client, so a page showing
 * `headline` and `taskList` is served by the *same* `getDashboard`
 * subscription the board is already using. There is no `getPageData` query,
 * deliberately, and that absence is what makes a Custom Page free in reads.
 *
 * The consequence for a reviewer: if a future block needs data Panel does not
 * already read, the change cannot be a block kind — it has to be a new query
 * and a new table, which is a budget conversation rather than a one-line edit.
 * That is the architecture working, not an accident.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";

import type { Id } from "@/convex/_generated/dataModel";

import { api } from "@/convex/_generated/api";
import { ConfirmAction } from "@/components/ConfirmAction";
import {
  PAGE_AREA_SLUGS,
  PAGE_BLOCK_KINDS,
  type PageBlockKind,
} from "@/lib/customPages";
import { PAGE_MAX_BLOCKS } from "@/lib/readLimits";
import {
  PAGE_TEMPLATES,
  applyPageTemplate,
  type PageTemplateId,
} from "@/lib/pageTemplates";
import { AREAS } from "@/lib/areas";

/** How many rows each block lists. A page is a summary of a domain, not a browser of it. */
const BLOCK_ROWS = 5;

function areaLabel(slug: string): string {
  return AREAS.find((a) => a.slug === slug)?.label ?? slug;
}

function blockLabel(kind: PageBlockKind): string {
  switch (kind) {
    case "headline":
      return "Headline numbers";
    case "taskList":
      return "Tasks";
    case "people":
      return "People";
    case "money":
      return "Balances";
    case "commitments":
      return "Commitments";
    case "documents":
      return "Documents";
    case "expenses":
      return "Spending";
    case "note":
      return "Notes";
  }
}

// ---------------------------------------------------------------------------

export function CustomPages() {
  const pages = useQuery(api.customPages.listPages, {});
  const create = useMutation(api.customPages.createPage);
  const update = useMutation(api.customPages.updatePage);
  const remove = useMutation(api.customPages.deletePage);

  const [openId, setOpenId] = useState<Id<"customPages"> | null>(null);
  const [name, setName] = useState("");
  const [area, setArea] = useState<string>("general");
  const [blocks, setBlocks] = useState<PageBlockKind[]>(["headline", "taskList"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const atBlockCap = blocks.length >= PAGE_MAX_BLOCKS;

  /**
   * Pre-fill the form from a template.
   *
   * Named `fillFromTemplate`, not `useTemplate`: it is an event handler, and
   * React reserves the `use` prefix for hooks. A first draft called it
   * `useTemplate` and `react-hooks/rules-of-hooks` turned the build red — which
   * is the rule working exactly as intended, because a `use*` name invites the
   * reader to believe it participates in render ordering when it does not.
   *
   * This **overwrites** rather than merges. A merge would have to decide what
   * "already partly chosen" means — whether the template's blocks or the user's
   * win on overlap — and either answer silently discards something the user
   * could see on screen. Overwriting is the one behaviour the interface can
   * explain: the form visibly becomes the template, and every field below stays
   * editable.
   *
   * The template is a convenience, not a permission: `applyPageTemplate` runs
   * the same validators the mutation runs, and the user still presses Save.
   */
  const fillFromTemplate = (id: PageTemplateId) => {
    setError(null);
    try {
      const next = applyPageTemplate(id);
      setName(next.name);
      setArea(next.area);
      setBlocks(next.blocks);
    } catch (e) {
      // Reachable only if the catalogue drifts from the vocabulary, which the
      // unit tests catch. Surfacing it beats a form that quietly did nothing.
      setError(e instanceof Error ? e.message : "That template is not available.");
    }
  };

  const toggleBlock = (kind: PageBlockKind) => {
    setError(null);
    setBlocks((prev) =>
      prev.includes(kind)
        ? prev.filter((k) => k !== kind)
        : prev.length >= PAGE_MAX_BLOCKS
          ? prev
          : [...prev, kind],
    );
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await create({ name, area, blocks: blocks.map((kind) => ({ kind })) });
      setName("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that page.");
    } finally {
      setBusy(false);
    }
  };

  if (pages === undefined) {
    return (
      <section className="border-2 border-foreground bg-card p-4">
        <p className="text-[13px] text-muted-foreground">Loading your pages…</p>
      </section>
    );
  }

  const open = pages.pages.find((p) => p.id === openId) ?? null;

  return (
    <section className="border-2 border-foreground bg-card">
      <div className="border-b-2 border-foreground px-4 py-3">
        <h2 className="text-[15px] font-bold">Pages</h2>
        <p className="text-[12px] text-muted-foreground">
          A page is a saved arrangement of what Panel already shows. It stores no
          new data of its own.
        </p>
      </div>

      {/*
        The cap receipt (D67). `listPages` takes cap+1 and reports `capped`;
        saying nothing here would mean a saved page silently vanished from a
        list the user can still scroll.
      */}
      {pages.capped ? (
        <p className="border-b-2 border-foreground bg-muted px-4 py-2 text-[12px]">
          Showing your {pages.pages.length} most recent pages. Delete one to save
          another.
        </p>
      ) : null}

      <div className="space-y-2 p-4">
        {pages.pages.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No pages yet. Build one below.
          </p>
        ) : (
          pages.pages.map((page) => (
            <div
              key={page.id}
              className="flex flex-wrap items-center gap-2 border-2 border-border px-3 py-2"
            >
              <button
                type="button"
                onClick={() => setOpenId(openId === page.id ? null : page.id)}
                aria-expanded={openId === page.id}
                className="flex-1 text-left text-[13px] font-bold underline decoration-2 underline-offset-2"
              >
                {page.name}
              </button>
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {areaLabel(page.area)}
              </span>
              <ConfirmAction
                label={`Delete the page ${page.name}`}
                confirmLabel="Delete it"
                disabled={busy}
                onConfirm={async () => {
                  setBusy(true);
                  try {
                    await remove({ id: page.id });
                    if (openId === page.id) setOpenId(null);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {({ onClick, ...rest }) => (
                  <button
                    type="button"
                    onClick={onClick}
                    aria-label={rest["aria-label"]}
                    className="border-2 border-foreground px-2 py-0.5 text-[11px]"
                  >
                    Delete
                  </button>
                )}
              </ConfirmAction>
              {openId === page.id ? (
                <p className="w-full font-mono text-[10px] text-muted-foreground">
                  {page.blocks.map((b) => blockLabel(b.kind)).join(" · ")}
                </p>
              ) : null}
            </div>
          ))
        )}

        {open ? (
          <PageEditor
            page={open}
            busy={busy}
            onSave={async (next) => {
              setBusy(true);
              try {
                await update({
                  id: next.id,
                  name: next.name,
                  area: next.area,
                  blocks: next.blocks.map((kind) => ({ kind })),
                });
                setError(null);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not save that page.");
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : null}
      </div>

      <div className="border-t-2 border-foreground p-4">
        <h3 className="mb-2 text-[13px] font-bold">New page</h3>

        <fieldset className="mb-3">
          <legend className="text-[12px]">Start from</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {PAGE_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => fillFromTemplate(t.id)}
                className="border-2 border-border px-2 py-0.5 text-[12px] hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              >
                {t.name}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Fills the form below. Everything stays editable.
          </p>
        </fieldset>

        <label className="mb-2 block text-[12px]" htmlFor="page-name">
          Name
          <input
            id="page-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            className="mt-1 w-full border-2 border-foreground bg-background px-2 py-1 text-[13px]"
          />
        </label>

        <label className="mb-2 block text-[12px]" htmlFor="page-area">
          Area
          <select
            id="page-area"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            className="mt-1 w-full border-2 border-foreground bg-background px-2 py-1 text-[13px]"
          >
            {PAGE_AREA_SLUGS.map((slug) => (
              <option key={slug} value={slug}>
                {areaLabel(slug)}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="mb-2">
          <legend className="text-[12px]">
            Blocks — {blocks.length} of {PAGE_MAX_BLOCKS}
            {atBlockCap ? " (cap reached)" : ""}
          </legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {PAGE_BLOCK_KINDS.map((kind) => {
              const on = blocks.includes(kind);
              return (
                <label
                  key={kind}
                  className="flex items-center gap-1 border-2 border-border px-2 py-0.5 text-[12px]"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && atBlockCap}
                    onChange={() => toggleBlock(kind)}
                  />
                  {blockLabel(kind)}
                </label>
              );
            })}
          </div>
        </fieldset>

        {error ? (
          <p role="alert" className="mb-2 text-[12px] text-destructive">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={busy || blocks.length === 0}
          onClick={save}
          className="border-2 border-foreground bg-foreground px-3 py-1 text-[13px] font-bold text-background disabled:opacity-50"
        >
          Save page
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

/**
 * The editor for a saved page.
 *
 * Order is editable, because a saved *arrangement* whose order cannot be changed
 * is a set. Move up/down rather than drag-and-drop: drag needs a pointer, a
 * keyboard equivalent and a focus story, and this is a list of at most twelve
 * closed-vocabulary items where two buttons are both cheaper and more
 * accessible than any of that.
 *
 * Edits are held locally and applied on Save rather than on every click. A
 * mutation per toggle would make a reordering pass write twelve rows, which is
 * the write amplification the embedded shape exists to avoid.
 */
function PageEditor({
  page,
  busy,
  onSave,
}: {
  page: { id: Id<"customPages">; name: string; area: string; blocks: Array<{ kind: string }> };
  /** The parent's in-flight flag. Editing state is owned up here so the editor stays presentational. */
  busy: boolean;
  onSave: (next: {
    id: Id<"customPages">;
    name: string;
    area: string;
    blocks: PageBlockKind[];
  }) => Promise<void>;
}) {
  const [draftName, setDraftName] = useState(page.name);
  const [draftArea, setDraftArea] = useState(page.area);
  const [draftBlocks, setDraftBlocks] = useState<PageBlockKind[]>(
    page.blocks.map((b) => b.kind as PageBlockKind),
  );

  const move = (index: number, by: number) => {
    setDraftBlocks((prev) => {
      const target = index + by;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const toggle = (kind: PageBlockKind) => {
    setDraftBlocks((prev) =>
      prev.includes(kind)
        ? prev.filter((k) => k !== kind)
        : prev.length >= PAGE_MAX_BLOCKS
          ? prev
          : [...prev, kind],
    );
  };

  const dirty =
    draftName !== page.name ||
    draftArea !== page.area ||
    JSON.stringify(draftBlocks) !==
      JSON.stringify(page.blocks.map((b) => b.kind));

  return (
    <div className="w-full space-y-3 border-2 border-foreground p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex-1 text-[12px]" htmlFor={`page-edit-${page.id}`}>
          Name
          <input
            id={`page-edit-${page.id}`}
            value={draftName}
            maxLength={60}
            onChange={(e) => setDraftName(e.target.value)}
            className="mt-1 w-full border-2 border-foreground bg-background px-2 py-1 text-[13px]"
          />
        </label>
        <label className="text-[12px]" htmlFor={`page-area-${page.id}`}>
          Area
          <select
            id={`page-area-${page.id}`}
            value={draftArea}
            onChange={(e) => setDraftArea(e.target.value)}
            className="mt-1 block border-2 border-foreground bg-background px-2 py-1 text-[13px]"
          >
            {PAGE_AREA_SLUGS.map((slug) => (
              <option key={slug} value={slug}>
                {areaLabel(slug)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Blocks, in order — {draftBlocks.length} of {PAGE_MAX_BLOCKS}
        </p>
        <ol className="space-y-1">
          {draftBlocks.map((kind, i) => (
            <li
              key={kind}
              className="flex items-center gap-2 border-2 border-border px-2 py-1 text-[12px]"
            >
              <span className="font-mono text-[11px]">{i + 1}</span>
              <span className="flex-1">{blockLabel(kind)}</span>
              <button
                type="button"
                disabled={i === 0 || busy}
                onClick={() => move(i, -1)}
                aria-label={`Move ${blockLabel(kind)} up`}
                className="border-2 border-foreground px-1.5 py-0.5 text-[11px] disabled:opacity-40"
              >
                Up
              </button>
              <button
                type="button"
                disabled={i === draftBlocks.length - 1 || busy}
                onClick={() => move(i, 1)}
                aria-label={`Move ${blockLabel(kind)} down`}
                className="border-2 border-foreground px-1.5 py-0.5 text-[11px] disabled:opacity-40"
              >
                Down
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => toggle(kind)}
                aria-label={`Remove ${blockLabel(kind)} from this page`}
                className="border-2 border-foreground px-1.5 py-0.5 text-[11px]"
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-2 flex flex-wrap gap-2">
          {PAGE_BLOCK_KINDS.filter((k) => !draftBlocks.includes(k)).map((kind) => (
            <button
              key={kind}
              type="button"
              disabled={busy || draftBlocks.length >= PAGE_MAX_BLOCKS}
              onClick={() => toggle(kind)}
              className="border-2 border-border px-2 py-0.5 text-[11px] disabled:opacity-40"
            >
              + {blockLabel(kind)}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        disabled={busy || !dirty || draftBlocks.length === 0}
        onClick={() =>
          onSave({
            id: page.id,
            name: draftName,
            area: draftArea,
            blocks: draftBlocks,
          })
        }
        className="border-2 border-foreground bg-foreground px-3 py-1 text-[13px] font-bold text-background disabled:opacity-50"
      >
        {dirty ? "Save changes" : "No changes"}
      </button>

      <PageBody blocks={draftBlocks} />
    </div>
  );
}

/**
 * Renders a saved arrangement from existing queries.
 *
 * Each block below is a *view* of a query the product already runs. Nothing
 * here fetches; it selects. That is why a page costs no new read.
 */
function PageBody({ blocks }: { blocks: PageBlockKind[] }) {
  const dashboard = useQuery(api.assistant.getDashboard, {});
  const people = useQuery(api.people.listPeople, {});
  const balances = useQuery(api.transactions.listBalances, {});
  const commitments = useQuery(api.commitments.listCommitments, {});
  const documents = useQuery(api.documents.listDocuments, {});
  const transactions = useQuery(api.transactions.listTransactions, {
    limit: BLOCK_ROWS,
  });

  return (
    <div className="w-full space-y-3 border-2 border-foreground p-3">
      <h3 className="text-[13px] font-bold">Page</h3>

      {blocks.includes("headline") && dashboard ? (
        <Block title="Headline numbers">
          <p className="text-[13px]">
            {dashboard.stats.open} open · {dashboard.stats.overdue} overdue ·{" "}
            {dashboard.stats.completedToday} done today
          </p>
        </Block>
      ) : null}

      {blocks.includes("taskList") && dashboard ? (
        <Block title="Tasks">
          <ul className="space-y-0.5">
            {dashboard.tasks
              .filter((t) => !t.completed)
              .slice(0, BLOCK_ROWS)
              .map((t) => (
                <li key={t._id} className="text-[13px]">
                  {t.title}
                </li>
              ))}
          </ul>
        </Block>
      ) : null}

      {blocks.includes("people") ? (
        <Block title="People">
          <ul className="space-y-0.5">
            {(people?.people ?? [])
              .slice(0, BLOCK_ROWS)
              .map((p) => (
                <li key={p.id} className="text-[13px]">
                  {p.name}
                </li>
              ))}
          </ul>
        </Block>
      ) : null}

      {blocks.includes("money") ? (
        <Block title="Balances">
          <ul className="space-y-0.5">
            {(balances ?? []).map((b) => (
              <li key={b.accountId} className="text-[13px]">
                {b.label}:{" "}
                {b.balances.length === 0
                  ? "no transactions"
                  : b.balances
                      .map((x) => `${x.amountMinor} ${x.currency}`)
                      .join(", ")}
                {/* `provisional` is the D62 receipt. It rides along because a
                    page is a view: showing a partial balance here without
                    saying so is the same wrong-number-wearing-a-symbol that
                    the Finance area already guards against. */}
                {b.provisional ? " (partial)" : null}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {blocks.includes("commitments") ? (
        <Block title="Commitments">
          <ul className="space-y-0.5">
            {[...(commitments?.owed ?? []), ...(commitments?.owedTo ?? [])]
              .slice(0, BLOCK_ROWS)
              .map((c) => (
                <li key={c.id} className="text-[13px]">
                  {c.title}
                </li>
              ))}
          </ul>
        </Block>
      ) : null}

      {blocks.includes("documents") ? (
        <Block title="Documents">
          <ul className="space-y-0.5">
            {(documents?.documents ?? [])
              .slice(0, BLOCK_ROWS)
              .map((d) => (
                <li key={d.id} className="text-[13px]">
                  {d.label}
                </li>
              ))}
          </ul>
        </Block>
      ) : null}

      {blocks.includes("expenses") ? (
        <Block title="Spending">
          <ul className="space-y-0.5">
            {(transactions ?? []).slice(0, BLOCK_ROWS).map((t) => (
              <li key={t._id} className="text-[13px]">
                {t.label} — {t.amountMinor} {t.currency ?? ""}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {blocks.includes("note") && dashboard ? (
        <Block title="Notes">
          <ul className="space-y-0.5">
            {dashboard.notes.slice(0, BLOCK_ROWS).map((n) => (
              <li key={n._id} className="text-[13px]">
                {n.body}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
    </div>
  );
}

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-2 border-border p-2">
      <h4 className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  );
}