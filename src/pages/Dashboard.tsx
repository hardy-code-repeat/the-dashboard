import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlarmClock,
  ArrowUpRight,
  Brain,
  Check,
  Circle,
  FileText,
  Loader2,
  LogOut,
  PlugZap,
  Plus,
  Repeat,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { AttentionFeed } from "@/components/AttentionFeed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AreaPicker, HealthArea, IntegrationsArea, PeopleArea, TasksArea, areaIcon } from "@/components/Areas";
import { FinanceArea } from "@/components/FinanceArea";
import { useAuth } from "@/hooks/use-auth";
import { describeDue, parseTaskInput } from "@/lib/nlp";
import { FEATURE_NAMES } from "@/lib/scorer";
import { cn } from "@/lib/utils";

type Filter = "all" | "open" | "done";

/**
 * The dashboard is two screens with an explicit switch between them.
 *
 * Phase 1.0 split it this way on purpose: "your things" and "what needs you"
 * are different questions and mixing them makes both harder to read. A plain
 * two-way toggle is deliberate — there is no plugin registry, no block system
 * and no way to add a third panel, because every one of those is a framework
 * this product does not need.
 */
type View = "board" | "attention";

const PRIORITY = {
  0: { label: "NOW", className: "bg-primary text-foreground" },
  1: { label: "SOON", className: "bg-accent text-accent-foreground" },
  2: { label: "LATER", className: "bg-muted text-muted-foreground" },
} as const;

/** Below this many labelled outcomes the model is mostly prior, not learned. */
const LEARNING_THRESHOLD = 12;

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const data = useQuery(api.assistant.getDashboard);
  const model = useQuery(api.assistant.getModel);
  const areas = useQuery(api.life.listAreas);
  const [view, setView] = useState<View>("board");

  const addTask = useMutation(api.assistant.addTask);
  const setCompleted = useMutation(api.assistant.setTaskCompleted);
  const removeTask = useMutation(api.assistant.removeTask);
  const clearCompleted = useMutation(api.assistant.clearCompleted);
  const addNote = useMutation(api.assistant.addNote);
  const removeNote = useMutation(api.assistant.removeNote);

  const [filter, setFilter] = useState<Filter>("all");
  const [input, setInput] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [showModel, setShowModel] = useState(false);
  const [activeArea, setActiveArea] = useState("general");
  const [showAreaPicker, setShowAreaPicker] = useState(false);

  // Parsed locally for an instant preview; the server re-parses on submit so
  // the persisted value is never dependent on the client having run.
  const preview = useMemo(() => {
    const trimmed = input.trim();
    if (trimmed.length < 2) return null;
    return parsePreview(trimmed);
  }, [input]);

  const tasks = data?.tasks ?? [];
  const stats = data?.stats;
  const samples = stats?.samples ?? 0;
  const learning = samples < LEARNING_THRESHOLD;

  const visibleTasks = useMemo(() => {
    if (filter === "open") return tasks.filter((t) => !t.completed);
    if (filter === "done") return tasks.filter((t) => t.completed);
    return tasks;
  }, [tasks, filter]);

  const openCount = tasks.filter((t) => !t.completed).length;
  const doneCount = tasks.length - openCount;
  const maxBar = Math.max(1, ...(stats?.week.map((d) => d.count) ?? [1]));

  const handleAddTask = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    if (!value || saving) return;

    setSaving(true);
    try {
      await addTask({ input: value });
      setInput("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add task");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id: (typeof tasks)[number]["_id"], completed: boolean) => {
    try {
      await setCompleted({ id, completed });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update task");
    }
  };

  const handleDelete = async (id: (typeof tasks)[number]["_id"]) => {
    try {
      await removeTask({ id });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete task");
    }
  };

  const handleClearCompleted = async () => {
    try {
      const removed = await clearCompleted();
      toast.success(`Cleared ${removed} completed ${removed === 1 ? "task" : "tasks"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not clear tasks");
    }
  };

  const handleAddNote = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = noteBody.trim();
    if (!value || saving) return;

    setSaving(true);
    try {
      await addNote({ body: value });
      setNoteBody("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save note");
    } finally {
      setSaving(false);
    }
  };

  const displayName = user?.name || (user?.email ? user.email.split("@")[0] : "there");
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-background">
      {/* ---------- TOP BAR ---------- */}
      <header className="border-b-2 border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="brutal-flat flex size-11 items-center justify-center bg-primary">
              <span className="font-display text-xl leading-none">P</span>
            </div>
            <div>
              <p className="font-display text-lg leading-none tracking-tight uppercase">Panel</p>
              <p className="mt-1 text-[11px] uppercase text-muted-foreground">{today}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div
              role="group"
              aria-label="View"
              className="brutal flex overflow-hidden bg-card"
            >
              {(["board", "attention"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={view === option}
                  onClick={() => setView(option)}
                  className={cn(
                    "px-4 py-2 text-xs font-bold uppercase transition-colors",
                    view === option ? "bg-foreground text-background" : "hover:bg-muted",
                  )}
                >
                  {option === "board" ? "Your stuff" : "Needs you"}
                </button>
              ))}
            </div>
            <div className="hidden text-right sm:block">
              <p className="text-xs uppercase text-muted-foreground">Signed in as</p>
              <p className="text-sm font-bold uppercase">{displayName}</p>
            </div>
            <Button
              type="button"
              onClick={() => void signOut()}
              className="brutal gap-2 bg-card font-bold uppercase"
            >
              <LogOut className="size-4" />
              Exit
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">
        {view === "attention" ? (
          <AttentionFeed />
        ) : (
        <>
        {/* ---------- AREA TABS ---------- */}
        <nav aria-label="Life areas" className="mb-8">
          <div className="-mx-1 flex flex-wrap items-stretch gap-2">
            {areas === undefined
              ? null
              : areas.map((area) => {
                  const Icon = areaIcon(area.kind);
                  const active = activeArea === area.slug;
                  return (
                    <button
                      key={area.slug}
                      type="button"
                      onClick={() => setActiveArea(area.slug)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "brutal flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase transition-colors",
                        active
                          ? "bg-foreground text-background"
                          : "bg-card hover:bg-muted",
                      )}
                    >
                      <Icon className="size-3.5" />
                      {area.label}
                    </button>
                  );
                })}

            <button
              type="button"
              onClick={() => setShowAreaPicker(true)}
              className="brutal-press flex items-center gap-2 border-2 border-dashed border-border px-4 py-2.5 text-xs font-bold uppercase text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Plus className="size-3.5" />
              Area
            </button>
          </div>
        </nav>

        {showAreaPicker && <AreaPicker onClose={() => setShowAreaPicker(false)} />}

        {/* ---------- TOOLS (integration hub) ---------- */}
        {activeArea === "general" && (
          <section className="mb-8">
            <details className="brutal-flat bg-card">
              <summary className="flex cursor-pointer items-center gap-2 p-4 text-xs font-bold uppercase">
                <PlugZap className="size-4" />
                Connect a tool
              </summary>
              <div className="border-t-2 border-border p-4">
                <IntegrationsArea />
              </div>
            </details>
          </section>
        )}

        {/* ---------- BRIEF (only on the general tab) ---------- */}
        {activeArea === "general" && (
          <>
        {/* ---------- ASSISTANT BRIEF ---------- */}
        {data?.brief && data.brief.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="brutal mb-8 flex items-start gap-3 bg-foreground p-4 text-background"
          >
            <Sparkles className="mt-0.5 size-5 shrink-0" />
            <div className="min-w-0">
              <p className="mb-1 text-[11px] font-bold uppercase opacity-60">Brief</p>
              <ul className="flex flex-col gap-1">
                {data.brief.map((line, i) => (
                  <li key={i} className="text-sm leading-snug">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              onClick={() => setShowModel((s) => !s)}
              aria-label="Inspect the model"
              aria-pressed={showModel}
              className="brutal-press ml-auto shrink-0 border-2 border-background p-1.5 hover:bg-background hover:text-foreground"
            >
              <Brain className="size-4" />
            </button>
          </motion.section>
        )}

        {/* ---------- MODEL INSPECTOR ---------- */}
        <AnimatePresence>
          {showModel && model && (
            <motion.section
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="brutal-flat mb-8 overflow-hidden bg-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-4 p-5">
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <Brain className="size-4" />
                    <h2 className="font-display text-sm uppercase tracking-wide">
                      Your model
                    </h2>
                  </div>
                  <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                    An online logistic regression trained on your own completions —{" "}
                    <span className="font-bold text-foreground">
                      {model.samples} labelled {model.samples === 1 ? "outcome" : "outcomes"}
                    </span>
                    . Every task you finish pulls these weights toward the shape of work
                    you actually complete. Nothing is sent anywhere.
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {model.weights.map((w, i) => (
                    <span
                      key={i}
                      title={FEATURE_NAMES[i]}
                      className="brutal-flat bg-background px-2 py-1 text-[10px] uppercase"
                    >
                      <span className="text-muted-foreground">{FEATURE_NAMES[i]}</span>
                      <span className="ml-1.5 font-bold">{w.toFixed(2)}</span>
                    </span>
                  ))}
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* ---------- STATS ---------- */}
        <section className="mb-8">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Open" value={openCount} sub="still to do" tone="bg-primary" />
            <StatTile
              label="Done today"
              value={stats?.completedToday ?? 0}
              sub="finished today"
              tone="bg-accent text-accent-foreground"
              delay={0.05}
            />
            <StatTile
              label="Overdue"
              value={stats?.overdue ?? 0}
              sub={(stats?.overdue ?? 0) > 0 ? "catch up" : "all clear"}
              tone="bg-secondary text-secondary-foreground"
              delay={0.1}
            />
            <StatTile
              label="Rate"
              value={stats?.completionRate ?? 0}
              suffix="%"
              sub={learning ? "model still warming up" : "model trained on your history"}
              tone="bg-card"
              delay={0.15}
              progress={stats?.completionRate ?? 0}
            />
          </div>
        </section>
          </>
        )}

        {/* ---------- AREA BODIES (everything below is area-specific) ---------- */}
        {activeArea !== "general" && (
          <section>
            {activeArea === "finance" ? (
              <FinanceArea />
            ) : activeArea === "relationships" ? (
              <PeopleArea />
            ) : activeArea === "health" ? (
              <HealthArea />
            ) : (
              <TasksArea
                area={activeArea}
                label={areas?.find((a) => a.slug === activeArea)?.label ?? activeArea}
              />
            )}
          </section>
        )}

        {activeArea === "general" && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* ---------- TASK COLUMN ---------- */}
          <section className="lg:col-span-2">
            <form onSubmit={handleAddTask} className="brutal-flat mb-6 bg-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <Plus className="size-4" />
                <h2 className="font-display text-sm uppercase tracking-wide">Capture</h2>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="call sam friday re contract"
                  maxLength={200}
                  aria-label="Task in plain language"
                  className="h-12 flex-1 border-2 border-border bg-background px-4 focus-visible:ring-0"
                />
                <Button
                  type="submit"
                  disabled={!input.trim() || saving}
                  className="brutal h-12 gap-2 bg-primary px-6 font-bold uppercase"
                >
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  Add
                </Button>
              </div>

              {/* live parse preview */}
              <AnimatePresence>
                {preview && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}
                    className="mt-4 border-2 border-dashed border-border bg-background p-3"
                  >
                    <p className="mb-2 text-[10px] font-bold uppercase text-muted-foreground">
                      Reads as
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm">{preview.title}</span>
                      <span
                        className={cn(
                          "border-2 border-border px-1.5 py-0.5 text-[10px] font-bold uppercase",
                          PRIORITY[preview.priority].className,
                        )}
                      >
                        {PRIORITY[preview.priority].label}
                      </span>
                      {preview.dueLabel && (
                        <span className="flex items-center gap-1 border-2 border-border bg-card px-1.5 py-0.5 text-[10px] font-bold uppercase">
                          <AlarmClock className="size-3" />
                          {preview.dueLabel}
                        </span>
                      )}
                      {preview.recurrence && (
                        <span className="flex items-center gap-1 border-2 border-border bg-card px-1.5 py-0.5 text-[10px] font-bold uppercase">
                          <Repeat className="size-3" />
                          {preview.recurrence.replace(":", " · ")}
                        </span>
                      )}
                      {preview.tags.map((tag) => (
                        <span
                          key={tag}
                          className="border-2 border-border bg-card px-1.5 py-0.5 text-[10px] font-bold uppercase"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </form>

            {/* filters */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {(["all", "open", "done"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    aria-pressed={filter === value}
                    className={cn(
                      "brutal-flat px-4 py-2 text-xs font-bold uppercase transition-colors",
                      filter === value ? "bg-foreground text-background" : "bg-card hover:bg-muted",
                    )}
                  >
                    {value}
                    {value === "all" && tasks.length > 0 && ` (${tasks.length})`}
                    {value === "open" && openCount > 0 && ` (${openCount})`}
                    {value === "done" && doneCount > 0 && ` (${doneCount})`}
                  </button>
                ))}
              </div>

              {doneCount > 0 && (
                <button
                  type="button"
                  onClick={handleClearCompleted}
                  className="text-[11px] font-bold uppercase text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  Clear completed
                </button>
              )}
            </div>

            {/* task list */}
            {visibleTasks.length === 0 ? (
              <div className="brutal-flat flex flex-col items-center gap-3 bg-card px-6 py-14 text-center">
                <Circle className="size-8 text-muted-foreground" />
                <p className="font-display text-lg uppercase">
                  {filter === "done" ? "Nothing finished yet" : "Nothing here"}
                </p>
                <p className="max-w-xs text-xs uppercase text-muted-foreground">
                  {filter === "done"
                    ? "Tick something off and it will show up here."
                    : "Try typing “pay rent tomorrow” in the box above."}
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {visibleTasks.map((task, index) => (
                  <motion.li
                    key={task._id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.2) }}
                    className={cn(
                      "brutal-flat flex items-center gap-3 bg-card p-3",
                      task.isOverdue && "bg-secondary text-secondary-foreground",
                      task.completed && "bg-muted",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleToggle(task._id, !task.completed)}
                      aria-label={task.completed ? "Mark as not done" : "Mark as done"}
                      aria-pressed={task.completed}
                      className={cn(
                        "brutal-press flex size-8 shrink-0 items-center justify-center border-2 border-border",
                        task.completed ? "bg-foreground" : "bg-background",
                      )}
                    >
                      {task.completed ? (
                        <Check className="size-5 text-background" strokeWidth={3} />
                      ) : null}
                    </button>

                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-sm break-words",
                          task.completed && "text-muted-foreground line-through",
                        )}
                      >
                        {task.title}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {!task.completed && (
                          <span
                            className={cn(
                              "border-2 border-border px-1.5 py-0.5 text-[10px] font-bold uppercase",
                              PRIORITY[(task.priority ?? 0) as 0 | 1 | 2].className,
                            )}
                          >
                            {PRIORITY[(task.priority ?? 0) as 0 | 1 | 2].label}
                          </span>
                        )}
                        {task.isOverdue && (
                          <span className="flex items-center gap-1 text-[10px] font-bold uppercase">
                            <AlarmClock className="size-3" />
                            Overdue
                          </span>
                        )}
                        {task.recurrence && !task.completed && (
                          <span className="flex items-center gap-1 text-[10px] font-bold uppercase">
                            <Repeat className="size-3" />
                            {task.recurrence.replace(":", " · ")}
                          </span>
                        )}
                        {/* learned ranking reasons */}
                        {!task.completed &&
                          task.reasons?.slice(0, 1).map((r) => (
                            <span
                              key={r.label}
                              className="flex items-center gap-1 text-[10px] font-bold uppercase opacity-70"
                            >
                              <Brain className="size-3" />
                              {r.label}
                            </span>
                          ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDelete(task._id)}
                      aria-label={`Delete ${task.title}`}
                      className="brutal-press shrink-0 border-2 border-border p-1.5 hover:bg-primary"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </motion.li>
                ))}
              </ul>
            )}
          </section>

          {/* ---------- SIDE COLUMN ---------- */}
          <aside className="flex flex-col gap-6">
            <section className="brutal-flat bg-card p-5">
              <h2 className="font-display mb-4 text-sm uppercase tracking-wide">Last 7 days</h2>
              <div className="flex h-32 items-end gap-2">
                {(stats?.week ?? []).map((day, i) => (
                  <div key={i} className="flex flex-1 flex-col items-center gap-2">
                    <span className="text-[10px] font-bold">{day.count || ""}</span>
                    <div
                      className="w-full border-2 border-border bg-primary transition-all duration-500"
                      style={{
                        height: `${Math.max((day.count / maxBar) * 88, day.count > 0 ? 14 : 6)}px`,
                      }}
                    />
                    <span className="text-[10px] uppercase text-muted-foreground">{day.day}</span>
                  </div>
                ))}
              </div>
              <p className="mt-4 border-t-2 border-border pt-3 text-[11px] uppercase text-muted-foreground">
                <span className="font-bold text-foreground">{stats?.completedThisWeek ?? 0}</span>{" "}
                completed in the last 7 days
              </p>
            </section>

            <section className="brutal-flat bg-card p-5">
              <div className="mb-4 flex items-center gap-2">
                <FileText className="size-4" />
                <h2 className="font-display text-sm uppercase tracking-wide">Notes</h2>
              </div>

              <form onSubmit={handleAddNote} className="mb-4 flex flex-col gap-2">
                <Textarea
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  placeholder="Scratch something down..."
                  maxLength={2000}
                  aria-label="Note body"
                  rows={3}
                  className="resize-none border-2 border-border bg-background text-sm focus-visible:ring-0"
                />
                <Button
                  type="submit"
                  disabled={!noteBody.trim() || saving}
                  className="brutal gap-2 bg-primary font-bold uppercase"
                >
                  <Plus className="size-4" />
                  Save note
                </Button>
              </form>

              {data?.notes.length ? (
                <ul className="flex flex-col gap-3">
                  {data.notes.map((note) => (
                    <li
                      key={note._id}
                      className="flex items-start gap-2 border-2 border-border bg-background p-3"
                    >
                      <p className="flex-1 text-xs leading-relaxed break-words whitespace-pre-wrap">
                        {note.body}
                      </p>
                      <button
                        type="button"
                        onClick={() => void removeNote({ id: note._id })}
                        aria-label="Delete note"
                        className="brutal-press shrink-0 hover:text-destructive"
                      >
                        <X className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="border-2 border-dashed border-border px-3 py-4 text-center text-[11px] uppercase text-muted-foreground">
                  No notes yet
                </p>
              )}
            </section>
          </aside>
        </div>
        )}

        <footer className="mt-12 border-t-2 border-border pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] uppercase text-muted-foreground">
              Panel — one page for your day
            </p>
            <a
              href="/"
              className="flex items-center gap-1 text-[11px] font-bold uppercase underline-offset-4 hover:underline"
            >
              Back to home <ArrowUpRight className="size-3" />
            </a>
          </div>
        </footer>
        </>
        )}
      </main>
    </div>
  );
}

function StatTile({
  label,
  value,
  suffix,
  sub,
  tone,
  delay = 0,
  progress,
}: {
  label: string;
  value: number;
  suffix?: string;
  sub: string;
  tone: string;
  delay?: number;
  progress?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay }}
      className={cn("brutal p-4", tone)}
    >
      <p className="text-[11px] font-bold uppercase tracking-wide">{label}</p>
      <p className="font-display mt-2 text-4xl leading-none">
        {value}
        {suffix && <span className="text-2xl">{suffix}</span>}
      </p>
      {progress !== undefined ? (
        <div className="mt-3 h-3 w-full border-2 border-border bg-background">
          <div
            className="h-full bg-foreground transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : (
        <p className="mt-2 text-[11px] uppercase">{sub}</p>
      )}
    </motion.div>
  );
}

/**
 * Client-side parse for the live preview.
 *
 * Runs the exact same parser the server uses, so what the preview shows is
 * what gets saved. Wrapped defensively — a preview failure must never block
 * capture, since the server parses again on submit regardless.
 */
function parsePreview(raw: string) {
  try {
    const parsed = parseTaskInput(raw);
    return {
      title: parsed.title,
      priority: parsed.priority,
      recurrence: parsed.recurrence,
      tags: parsed.tags,
      dueLabel: describeDue(parsed.dueAt),
    };
  } catch {
    return null;
  }
}