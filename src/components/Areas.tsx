import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Calendar,
  Check,
  Circle,
  HeartPulse,
  Home,
  Landmark,
  Link2,
  Loader2,
  PlugZap,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
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
  const addTask = useMutation(api.assistant.addTask);
  const setCompleted = useMutation(api.assistant.setTaskCompleted);
  const removeTask = useMutation(api.assistant.removeTask);
  const setArea = useMutation(api.life.setTaskArea);

  const [input, setInput] = useState("");
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
      const id = await addTask({ input: value });
      // The shared addTask mutation has no area arg, so tag after insert.
      await setArea({ id, area });
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
// Relationships — people you need to stay in touch with
// ---------------------------------------------------------------------------

export function PeopleArea() {
  const tasks = useQuery(api.life.getAreaTasks, { area: "relationships" }) ?? [];
  const setCompleted = useMutation(api.assistant.setTaskCompleted);
  const removeTask = useMutation(api.assistant.removeTask);
  const [name, setName] = useState("");
  const [cadence, setCadence] = useState("every week");
  const [busy, setBusy] = useState(false);
  const addTask = useMutation(api.assistant.addTask);
  const setArea = useMutation(api.life.setTaskArea);

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    const who = name.trim();
    if (!who || busy) return;
    setBusy(true);
    try {
      const id = await addTask({ input: `catch up with ${who} ${cadence}` });
      await setArea({ id, area: "relationships" });
      setName("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={handleAdd} className="brutal-flat bg-card p-4">
        <p className="mb-3 text-[11px] font-bold uppercase text-muted-foreground">
          Someone to keep in touch with
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            aria-label="Person's name"
            className="h-11 flex-1 border-2 border-border bg-background focus-visible:ring-0"
          />
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value)}
            aria-label="How often"
            className="h-11 border-2 border-border bg-background px-3 text-xs font-bold uppercase focus-visible:ring-0 focus-visible:outline-none"
          >
            <option value="today">Today</option>
            <option value="tomorrow">Tomorrow</option>
            <option value="every week">Every week</option>
            <option value="every 2 weeks">Every 2 weeks</option>
            <option value="every month">Every month</option>
          </select>
          <Button
            type="submit"
            disabled={!name.trim() || busy}
            className="brutal h-11 gap-2 bg-primary px-5 font-bold uppercase"
          >
            <Plus className="size-4" />
            Add
          </Button>
        </div>
      </form>

      {tasks.length === 0 ? (
        <div className="brutal-flat bg-card px-6 py-12 text-center">
          <Users className="mx-auto mb-3 size-7 text-muted-foreground" />
          <p className="font-display text-base uppercase">No one tracked yet</p>
          <p className="mt-1 text-[11px] uppercase text-muted-foreground">
            Add the people who actually matter
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {tasks.map((t) => (
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
              <p className={cn("flex-1 text-sm", t.completed && "text-muted-foreground line-through")}>
                {t.title}
              </p>
              {t.recurrence && (
                <span className="shrink-0 border-2 border-border bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase">
                  {t.recurrence.replace(":", " · ")}
                </span>
              )}
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