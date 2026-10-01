import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  GitMerge,
  HeartPulse,
  Home,
  Info,
  Landmark,
  Link2,
  Loader2,
  PlugZap,
  Plus,
  Trash2,
  Undo2,
  UserPlus,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { describeDue, parseTaskInput } from "@/lib/nlp";
import { cn } from "@/lib/utils";

/** Maps an area kind to its icon. */
export function areaIcon(kind: string) {
  switch (kind) {
    case "finance": return Landmark;
    case "people": return Users;
    case "health": return HeartPulse;
    case "home": return Home;
    default: return Circle;
  }
}

// ---------------------------------------------------------------------------
// Generic task-backed area (general, home, and any custom area)
// ---------------------------------------------------------------------------

export function TasksArea({ area, label }: { area: string; label: string }) {
  const tasks = useQuery(api.life.getAreaTasks, { area }) ?? [];
  const people = useQuery(api.people.listPeople)?.people;
  const addTask = useMutation(api.assistant.addTask);
  const setCompleted = useMutation(api.assistant.setTaskCompleted);
  const removeTask = useMutation(api.assistant.removeTask);

  const [input, setInput] = useState("");
  const [personId, setPersonId] = useState<Id<"people"> | "">("");
  const [busy, setBusy] = useState(false);

  const open = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);

  const preview = input.trim().length > 1 ? parseTaskInput(input.trim()) : null;

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      // The area is part of the insert, so this is one atomic mutation (D6).
      // A person is optional and, when given, checked for ownership server-side.
      await addTask({ input: value, area, personId: personId || undefined });
      setInput("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add task");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={handleAdd} className="brutal-flat bg-card p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Add something to ${label.toLowerCase()}...`}
            aria-label={`New task for ${label}`}
            className="h-11 flex-1 border-2 border-border bg-background focus-visible:ring-0"
          />
          <Button
            type="submit"
            disabled={!input.trim() || busy}
            className="brutal h-11 gap-2 bg-primary px-5 font-bold uppercase"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add
          </Button>
        </div>
        {(people?.length ?? 0) > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <label
              htmlFor={`person-for-${area}`}
              className="shrink-0 text-[10px] font-bold uppercase text-muted-foreground"
            >
              About
            </label>
            <select
              id={`person-for-${area}`}
              value={personId}
              onChange={(e) => setPersonId(e.target.value as Id<"people">)}
              className="h-9 flex-1 border-2 border-border bg-background px-2 text-[10px] font-bold uppercase focus-visible:ring-0 focus-visible:outline-none"
            >
              <option value="">Nobody in particular</option>
              {people?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {preview && (
          <p className="mt-2.5 flex flex-wrap items-center gap-2 border-2 border-dashed border-border p-2 text-[10px] uppercase text-muted-foreground">
            <span className="text-foreground">{preview.title}</span>
            {preview.dueAt && <span>{describeDue(preview.dueAt)}</span>}
            {preview.recurrence && <span>↻ {preview.recurrence}</span>}
          </p>
        )}
      </form>

      {tasks.length === 0 ? (
        <div className="brutal-flat bg-card px-6 py-12 text-center">
          <Circle className="mx-auto mb-3 size-7 text-muted-foreground" />
          <p className="font-display text-base uppercase">Nothing in {label}</p>
          <p className="mt-1 text-[11px] uppercase text-muted-foreground">
            Add the first one above
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {[...open, ...done].map((t) => (
            <motion.li
              key={t._id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18 }}
              className={cn(
                "brutal-flat flex items-center gap-3 bg-card p-3",
                t.completed && "bg-muted",
              )}
            >
              <button
                type="button"
                onClick={() => void setCompleted({ id: t._id, completed: !t.completed })}
                aria-label={t.completed ? "Mark as not done" : "Mark as done"}
                aria-pressed={t.completed}
                className={cn(
                  "brutal-press flex size-7 shrink-0 items-center justify-center border-2 border-border",
                  t.completed ? "bg-foreground" : "bg-background",
                )}
              >
                {t.completed && <Check className="size-4 text-background" strokeWidth={4} />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm break-words", t.completed && "text-muted-foreground line-through")}>
                  {t.title}
                </p>
                {t.dueAt && !t.completed && (
                  <p className="mt-0.5 text-[10px] uppercase text-muted-foreground">
                    {describeDue(t.dueAt)}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void removeTask({ id: t._id })}
                aria-label={`Delete ${t.title}`}
                className="brutal-press shrink-0 border-2 border-border p-1.5 hover:bg-primary"
              >
                <Trash2 className="size-4" />
              </button>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// People — a person is a row, not a task title
// ---------------------------------------------------------------------------

/**
 * The shape a person card needs from `listPeople`.
 *
 * Written out rather than inferred, because a change to the query is caught at
 * the `people.map` call site below: if the query stops returning one of these,
 * the map stops compiling.
 */
type PersonSummary = {
  id: Id<"people">;
  name: string;
  note: string | null;
  hasEmail: boolean;
  openTasks: number;
  matchHint: { id: Id<"people">; name: string; suggest: boolean; reason: string; shared: string[] } | null;
};

/** How often a keep-in-touch task can come back. Mirrors the parser's grammar. */const CADENCES = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "every week", label: "Every week" },
  { value: "every 2 weeks", label: "Every 2 weeks" },
  { value: "every month", label: "Every month" },
] as const;

const selectClass =
  "h-11 border-2 border-border bg-background px-3 text-xs font-bold uppercase focus-visible:ring-0 focus-visible:outline-none";

/**
 * One person, their open work, and the two irreversible-looking buttons that
 * are actually both reversible.
 *
 * Merge is a user decision taken here, not a suggestion Panel applies: RJD-004
 * ("Raj" ≠ "Raj") means a shared name is *evidence*, and the only person who
 * knows whether two Rajs are one is the user. So this offers, explains, and
 * waits.
 */
function PersonCard({
  person,
  others,
  open,
  onToggle,
}: {
  person: PersonSummary;
  others: { id: Id<"people">; name: string }[];
  open: boolean;
  onToggle: () => void;
}) {
  const detail = useQuery(api.people.getPerson, { id: person.id });
  const setCompleted = useMutation(api.assistant.setTaskCompleted);
  const removeTask = useMutation(api.assistant.removeTask);
  const addTask = useMutation(api.assistant.addTask);
  const merge = useMutation(api.people.mergePeople);
  const unmerge = useMutation(api.people.unmergePerson);

  const [taskInput, setTaskInput] = useState("");
  const [cadence, setCadence] = useState<string>("every week");
  const [mergeInto, setMergeInto] = useState<Id<"people"> | "">("");
  const [busy, setBusy] = useState(false);

  const mergedFrom = detail?.mergedFrom ?? [];
  const tasks = detail?.tasks ?? [];
  const openList = tasks.filter((t) => !t.completed);

  const addForPerson = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = taskInput.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await addTask({
        input: `${value} ${cadence}`,
        area: "relationships",
        personId: person.id,
      });
      setTaskInput("");
      toast.success("Added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add");
    } finally {
      setBusy(false);
    }
  };

  const doMerge = async () => {
    if (!mergeInto) return;
    setBusy(true);
    try {
      const result = await merge({ sourceId: person.id, targetId: mergeInto });
      setMergeInto("");
      toast.success(`Merged ${result.from} into ${result.into} — undo it any time`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not merge");
    } finally {
      setBusy(false);
    }
  };

  const doUnmerge = async (id: Id<"people">, name: string) => {
    try {
      const result = await unmerge({ id });
      if (result.unmerged) toast.success(`${name} is their own person again`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not undo merge");
    }
  };

  return (
    <motion.li
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18 }}
      className="brutal-flat bg-card"
    >
      <div className="flex items-center gap-3 p-3">
        <span className="flex size-9 shrink-0 items-center justify-center border-2 border-border bg-background">
          <Users className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold uppercase">{person.name}</p>
          <p className="mt-0.5 text-[10px] uppercase text-muted-foreground">
            {person.openTasks === 0 ? "Nothing open" : `${person.openTasks} open`}
            {person.hasEmail ? " · has email" : ""}
            {mergedFrom.length > 0 ? ` · ${mergedFrom.length} merged in` : ""}
          </p>
          {person.note && (
            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
              {person.note}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} ${person.name}`}
          className="brutal-press shrink-0 border-2 border-border p-1.5 hover:bg-muted"
        >
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
      </div>

      {person.matchHint && (
        <p className="flex items-start gap-2 border-t-2 border-border bg-muted px-3 py-2 text-[10px] uppercase text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <span className="font-bold text-foreground">{person.matchHint.reason}</span> as{" "}
            {person.matchHint.name}. Two people can share a name and still be two
            people — merge only if you are sure.
          </span>
        </p>
      )}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-t-2 border-border"
          >
            <div className="flex flex-col gap-4 p-3">
              {/* linked work */}
              <section>
                <h3 className="mb-2 text-[10px] font-bold uppercase text-muted-foreground">
                  Linked work
                </h3>
                {openList.length === 0 ? (
                  <p className="border-2 border-dashed border-border p-3 text-[10px] uppercase text-muted-foreground">
                    Nothing linked to {person.name} yet
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {openList.map((t) => (
                      <li key={t.id} className="flex items-center gap-2.5 border-2 border-border bg-background p-2">
                        <button
                          type="button"
                          onClick={() => void setCompleted({ id: t.id, completed: true })}
                          aria-label={`Mark "${t.title}" as done`}
                          className="brutal-press flex size-6 shrink-0 items-center justify-center border-2 border-border bg-background"
                        >
                          <Check className="size-3.5" />
                        </button>
                        <span className="min-w-0 flex-1 text-sm">{t.title}</span>
                        <button
                          type="button"
                          onClick={() => void removeTask({ id: t.id })}
                          aria-label={`Delete ${t.title}`}
                          className="brutal-press shrink-0 border-2 border-border p-1 hover:bg-primary"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <form onSubmit={addForPerson} className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={taskInput}
                    onChange={(e) => setTaskInput(e.target.value)}
                    placeholder={`Something to do with ${person.name}...`}
                    aria-label={`New task for ${person.name}`}
                    className="h-10 flex-1 border-2 border-border bg-background focus-visible:ring-0"
                  />
                  <select
                    value={cadence}
                    onChange={(e) => setCadence(e.target.value)}
                    aria-label="How often"
                    className={selectClass}
                  >
                    {CADENCES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="submit"
                    disabled={!taskInput.trim() || busy}
                    className="brutal h-10 gap-2 bg-primary px-4 font-bold uppercase"
                  >
                    <Plus className="size-4" />
                    Add
                  </Button>
                </form>
              </section>

              {/* merge / unmerge */}
              <section>
                <h3 className="mb-2 text-[10px] font-bold uppercase text-muted-foreground">
                  If these are the same person
                </h3>
                {mergedFrom.length > 0 && (
                  <ul className="mb-3 flex flex-col gap-2">
                    {mergedFrom.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-center gap-2.5 border-2 border-border bg-background p-2"
                      >
                        <Undo2 className="size-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-xs">
                          {m.name} was merged into {person.name}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void doUnmerge(m.id, m.name)}
                          className="brutal-flat shrink-0 border-2 border-border bg-background px-2.5 py-1 text-[9px] font-bold uppercase hover:bg-muted"
                        >
                          Undo
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {others.length > 0 && (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select
                      value={mergeInto}
                      onChange={(e) => setMergeInto(e.target.value as Id<"people">)}
                      aria-label={`Merge ${person.name} into`}
                      className={selectClass}
                    >
                      <option value="">Merge {person.name} into…</option>
                      {others.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      onClick={() => void doMerge()}
                      disabled={!mergeInto || busy}
                      className="brutal h-11 gap-2 bg-primary px-4 font-bold uppercase"
                    >
                      <GitMerge className="size-4" />
                      Merge
                    </Button>
                  </div>
                )}
                <p className="mt-2 text-[9px] uppercase text-muted-foreground">
                  A merge hides {person.name} and moves their work. Nothing is
                  deleted, and Undo brings it all straight back.
                </p>
              </section>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

export function PeopleArea() {
  const list = useQuery(api.people.listPeople);
  const create = useMutation(api.people.createPerson);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  /**
   * The refusal. `createPerson` declines a probable duplicate and names the row
   * it had in mind; this holds that answer so the user can open the person
   * instead, or insist. Nothing is merged either way.
   */
  const [refusal, setRefusal] = useState<{ id: string; name: string; reason: string } | null>(null);
  const [openId, setOpenId] = useState<Id<"people"> | null>(null);

  const submit = async (event: React.FormEvent, force = false) => {
    event.preventDefault();
    const who = name.trim();
    if (!who || busy) return;
    setBusy(true);
    try {
      const result = await create({
        name: who,
        email: email.trim() || undefined,
        force: force || undefined,
      });
      if (result.created) {
        setName("");
        setEmail("");
        setRefusal(null);
        toast.success(`${who} added`);
      } else {
        setRefusal(result.duplicateOf);
        toast.info(`You already have someone called ${result.duplicateOf.name}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add");
    } finally {
      setBusy(false);
    }
  };

  const people = list?.people ?? [];
  const others = people.map((p) => ({ id: p.id, name: p.name }));
  const loading = list === undefined;

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={(e) => void submit(e)} className="brutal-flat bg-card p-4">
        <p className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase text-muted-foreground">
          <UserPlus className="size-4" />
          Someone worth keeping
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            aria-label="Person's name"
            className="h-11 flex-1 border-2 border-border bg-background focus-visible:ring-0"
          />
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email (optional)"
            type="email"
            aria-label="Person's email address"
            className="h-11 flex-1 border-2 border-border bg-background focus-visible:ring-0"
          />
          <Button
            type="submit"
            disabled={!name.trim() || busy}
            className="brutal h-11 gap-2 bg-primary px-5 font-bold uppercase"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add
          </Button>
        </div>

        {refusal && (
          <div className="mt-3 border-2 border-border bg-muted p-3">
            <p className="flex items-start gap-2 text-[10px] uppercase text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <span className="font-bold text-foreground">{refusal.reason}</span> — not
                adding a second {refusal.name}. Two people can share a name and
                still be two people.
              </span>
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => {
                  setOpenId(refusal.id as Id<"people">);
                  setRefusal(null);
                }}
                className="brutal h-9 gap-2 bg-primary px-4 font-bold uppercase"
              >
                Open {refusal.name}
              </Button>
              <Button
                type="button"
                onClick={(e) => void submit(e, true)}
                disabled={busy}
                className="brutal-flat h-9 border-2 border-border bg-background px-4 text-[10px] font-bold uppercase hover:bg-muted"
              >
                They are different people
              </Button>
            </div>
          </div>
        )}
      </form>

      {list && list.mergedCount > 0 && (
        <p className="border-2 border-dashed border-border p-2.5 text-[10px] uppercase text-muted-foreground">
          {list.mergedCount} {list.mergedCount === 1 ? "person" : "people"} merged and
          hidden. Open a person below to undo.
        </p>
      )}

      {loading ? (
        <div className="brutal-flat bg-card p-8 text-center text-xs uppercase text-muted-foreground">
          <Loader2 className="mx-auto mb-2 size-5 animate-spin" />
          Loading people…
        </div>
      ) : people.length === 0 ? (
        <div className="brutal-flat bg-card px-6 py-12 text-center">
          <Users className="mx-auto mb-3 size-7 text-muted-foreground" />
          <p className="font-display text-base uppercase">No one tracked yet</p>
          <p className="mt-1 text-[11px] uppercase text-muted-foreground">
            Add the people who actually matter
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {people.map((p) => (
            <PersonCard
              key={p.id}
              person={p}
              others={others.filter((o) => o.id !== p.id)}
              open={openId === p.id}
              onToggle={() => setOpenId(openId === p.id ? null : p.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Health — habit board
// ---------------------------------------------------------------------------

const HABITS = [
  { id: "steps", label: "Steps", target: 8000, unit: "steps" },
  { id: "water", label: "Water", target: 8, unit: "glasses" },
  { id: "sleep", label: "Sleep", target: 8, unit: "hours" },
  { id: "movement", label: "Movement", target: 30, unit: "min" },
];

export function HealthArea() {
  const [values, setValues] = useState<Record<string, number>>({});

  return (
    <div className="flex flex-col gap-6">
      <div className="brutal-flat bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <HeartPulse className="size-4" />
          <h2 className="font-display text-sm uppercase tracking-wide">Today</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {HABITS.map((h) => {
            const value = values[h.id] ?? 0;
            const pct = Math.min(100, Math.round((value / h.target) * 100));
            return (
              <div key={h.id} className="border-2 border-border bg-background p-3">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-[11px] font-bold uppercase">{h.label}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {value}/{h.target} {h.unit}
                  </span>
                </div>
                <div className="mb-3 h-3 w-full border-2 border-border bg-card">
                  <div
                    className="h-full bg-accent transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex gap-1.5">
                  {[-1, +1, +5].map((step) => (
                    <button
                      key={step}
                      type="button"
                      onClick={() =>
                        setValues((prev) => ({
                          ...prev,
                          [h.id]: Math.max(0, (prev[h.id] ?? 0) + step),
                        }))
                      }
                      aria-label={`${step > 0 ? "Add" : "Remove"} ${Math.abs(step)} ${h.unit}`}
                      className="brutal-flat flex-1 bg-card py-1.5 text-[11px] font-bold hover:bg-muted"
                    >
                      {step > 0 ? `+${step}` : step}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-4 border-t-2 border-border pt-3 text-[10px] uppercase text-muted-foreground">
          Counters reset each morning. Nothing is synced or stored off this device.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Integrations hub
// ---------------------------------------------------------------------------

export function IntegrationsArea() {
  const data = useQuery(api.life.listConnections);
  const connect = useMutation(api.life.connectTool);
  const disconnect = useMutation(api.life.disconnectTool);
  const [busy, setBusy] = useState<string | null>(null);

  if (data === undefined) {
    return (
      <div className="brutal-flat bg-card p-8 text-center text-xs uppercase text-muted-foreground">
        Loading tools…
      </div>
    );
  }

  const categories = [...new Set(data.providers.map((p) => p.category))];

  const handleToggle = async (provider: string, connected: boolean) => {
    setBusy(provider);
    try {
      if (connected) {
        await disconnect({ provider });
        toast.success("Disconnected");
      } else {
        await connect({ provider });
        toast.success("Added — finish setup with the keys below");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="brutal-flat flex items-start gap-3 border-dashed bg-muted p-4">
        <PlugZap className="mt-0.5 size-4 shrink-0" />
        <p className="text-[11px] leading-relaxed uppercase">
          <span className="font-bold">Connect your tools.</span> Panel never stores your
          passwords. Each service is authorised through its own OAuth screen, and we
          only ever request the minimum scopes needed.
        </p>
      </div>

      {data.connected.length > 0 && (
        <section>
          <h2 className="font-display mb-3 text-sm uppercase tracking-wide">
            Connected ({data.connected.length})
          </h2>
          <ul className="flex flex-col gap-2.5">
            {data.connected.map((c) => (
              <li key={c._id} className="brutal-flat flex items-center gap-3 bg-card p-3">
                <Link2 className="size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold uppercase">{c.label}</p>
                  <p className="mt-0.5 text-[10px] uppercase text-muted-foreground">
                    {c.status === "pending-credentials"
                      ? "Awaiting API keys — not syncing yet"
                      : c.status === "coming-soon"
                        ? "Not wired up yet"
                        : "Connected"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleToggle(c.provider, true)}
                  className="brutal-flat shrink-0 border-2 border-border bg-background px-3 py-1.5 text-[10px] font-bold uppercase hover:bg-muted"
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {categories.map((cat) => (
        <section key={cat}>
          <h2 className="font-display mb-3 text-sm uppercase tracking-wide">{cat}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.providers
              .filter((p) => p.category === cat)
              .map((p) => {
                const comingSoon = p.status === "coming-soon";
                const active = Boolean(p.connected);
                return (
                  <div
                    key={p.slug}
                    className={cn(
                      "brutal-flat flex flex-col gap-2.5 p-4",
                      active ? "bg-primary" : comingSoon ? "bg-muted" : "bg-card",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold uppercase">{p.label}</p>
                        <p className="mt-1 text-[11px] leading-relaxed opacity-75">{p.blurb}</p>
                      </div>
                      {active && <Check className="size-4 shrink-0" />}
                    </div>

                    {comingSoon && (
                      <p className="border-2 border-dashed border-border px-2 py-1 text-center text-[9px] font-bold uppercase opacity-60">
                        Not built yet
                      </p>
                    )}

                    {!comingSoon && p.requiredEnvVars && !active && (
                      <p className="text-[9px] uppercase opacity-70">
                        Needs: {p.requiredEnvVars.join(", ")}
                      </p>
                    )}

                    <div className="mt-auto flex items-center justify-between gap-2">
                      {p.docsUrl && (
                        <a
                          href={p.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[9px] uppercase underline underline-offset-2 opacity-60"
                        >
                          Docs
                        </a>
                      )}
                      <Button
                        type="button"
                        onClick={() => void handleToggle(p.slug, active)}
                        disabled={comingSoon || busy === p.slug}
                        className={cn(
                          "ml-auto gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase",
                          active ? "brutal-flat border-2 border-border bg-background hover:bg-muted" : "brutal bg-primary",
                          comingSoon && "opacity-50",
                        )}
                      >
                        {busy === p.slug ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : active ? (
                          "Connected"
                        ) : (
                          <>
                            <Calendar className="size-3" />
                            Connect
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add-area picker
// ---------------------------------------------------------------------------

export function AreaPicker({ onClose }: { onClose: () => void }) {
  const available = useQuery(api.life.getAvailableAreas) ?? [];
  const enable = useMutation(api.life.enableArea);
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/70 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.96, y: 10 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.96, y: 10 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => e.stopPropagation()}
          className="brutal w-full max-w-lg bg-card p-5"
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg uppercase">Add an area</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="brutal-flat border-2 border-border p-1.5 hover:bg-muted"
            >
              ✕
            </button>
          </div>

          {available.length === 0 ? (
            <p className="border-2 border-dashed border-border px-3 py-6 text-center text-[11px] uppercase text-muted-foreground">
              You've added every area
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {available.map((a) => {
                const Icon = areaIcon(a.kind);
                return (
                  <li key={a.slug}>
                    <button
                      type="button"
                      disabled={busy === a.slug}
                      onClick={async () => {
                        setBusy(a.slug);
                        try {
                          await enable({ slug: a.slug, seed: true });
                          toast.success(`${a.label} added`);
                          onClose();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Could not add");
                        } finally {
                          setBusy(null);
                        }
                      }}
                      className="brutal-flat flex w-full items-center gap-3 bg-background p-3 text-left hover:bg-muted disabled:opacity-50"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center border-2 border-border bg-card">
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold uppercase">{a.label}</span>
                        <span className="block text-[11px] opacity-70">{a.blurb}</span>
                      </span>
                      {busy === a.slug ? (
                        <Loader2 className="size-4 shrink-0 animate-spin" />
                      ) : (
                        <Plus className="size-4 shrink-0" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}