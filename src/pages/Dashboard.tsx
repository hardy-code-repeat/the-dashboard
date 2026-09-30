import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  AlarmClock,
  ArrowUpRight,
  Check,
  Circle,
  FileText,
  Flag,
  Loader2,
  LogOut,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

type Filter = "all" | "open" | "done";

/** Priority buckets. `pinned` is the urgent one, `standard` the default. */
const PRIORITY = {
  0: { label: "NOW", className: "bg-primary text-foreground" },
  1: { label: "SOON", className: "bg-accent text-accent-foreground" },
  2: { label: "LATER", className: "bg-muted text-muted-foreground" },
} as const;

function formatDueLabel(dueAt: number | null | undefined) {
  if (dueAt == null) return null;
  const date = new Date(dueAt);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);

  if (days === 0) return "TODAY";
  if (days === 1) return "TOMORROW";
  if (days === -1) return "YESTERDAY";
  if (days < 0) return `${Math.abs(days)}D LATE`;
  if (days < 7) return `IN ${days}D`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const data = useQuery(api.dashboard.getDashboard);

  const addTask = useMutation(api.dashboard.addTask);
  const setCompleted = useMutation(api.dashboard.setTaskCompleted);
  const removeTask = useMutation(api.dashboard.removeTask);
  const clearCompleted = useMutation(api.dashboard.clearCompleted);
  const addNote = useMutation(api.dashboard.addNote);
  const removeNote = useMutation(api.dashboard.removeNote);

  const [filter, setFilter] = useState<Filter>("all");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<0 | 1 | 2>(0);
  const [noteBody, setNoteBody] = useState("");
  const [saving, setSaving] = useState(false);

  const tasks = data?.tasks ?? [];
  const stats = data?.stats;

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
    const value = title.trim();
    if (!value || saving) return;

    setSaving(true);
    try {
      await addTask({ title: value, priority });
      setTitle("");
      if (priority !== 0) setPriority(0);
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
              <p className="font-display text-lg leading-none tracking-tight uppercase">
                Panel
              </p>
              <p className="mt-1 text-[11px] uppercase text-muted-foreground">{today}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
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
        {/* ---------- STATS ---------- */}
        <section className="mb-8">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="brutal bg-primary p-4"
            >
              <p className="text-[11px] font-bold uppercase tracking-wide">Open</p>
              <p className="font-display mt-2 text-4xl leading-none">{openCount}</p>
              <p className="mt-2 text-[11px] uppercase">still to do</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.05 }}
              className="brutal bg-accent p-4 text-accent-foreground"
            >
              <p className="text-[11px] font-bold uppercase tracking-wide">Done today</p>
              <p className="font-display mt-2 text-4xl leading-none">
                {stats?.completedToday ?? 0}
              </p>
              <p className="mt-2 text-[11px] uppercase">finished today</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.1 }}
              className="brutal bg-secondary p-4 text-secondary-foreground"
            >
              <p className="text-[11px] font-bold uppercase tracking-wide">Overdue</p>
              <p className="font-display mt-2 text-4xl leading-none">{stats?.overdue ?? 0}</p>
              <p className="mt-2 text-[11px] uppercase">
                {(stats?.overdue ?? 0) > 0 ? "catch up" : "all clear"}
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.15 }}
              className="brutal bg-card p-4"
            >
              <p className="text-[11px] font-bold uppercase tracking-wide">Rate</p>
              <p className="font-display mt-2 text-4xl leading-none">
                {stats?.completionRate ?? 0}
                <span className="text-2xl">%</span>
              </p>
              <div className="mt-3 h-3 w-full border-2 border-border bg-background">
                <div
                  className="h-full bg-foreground transition-all duration-500"
                  style={{ width: `${stats?.completionRate ?? 0}%` }}
                />
              </div>
            </motion.div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* ---------- TASK COLUMN ---------- */}
          <section className="lg:col-span-2">
            {/* composer */}
            <form onSubmit={handleAddTask} className="brutal-flat mb-6 bg-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <Plus className="size-4" />
                <h2 className="font-display text-sm uppercase tracking-wide">
                  New task
                </h2>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What needs doing?"
                  maxLength={200}
                  aria-label="Task title"
                  className="h-12 flex-1 border-2 border-border bg-background px-4 text-sm focus-visible:ring-0"
                />
                <Button
                  type="submit"
                  disabled={!title.trim() || saving}
                  className="brutal h-12 gap-2 bg-primary px-6 font-bold uppercase"
                >
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Add
                </Button>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase text-muted-foreground">
                  Priority
                </span>
                {([0, 1, 2] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPriority(value)}
                    aria-pressed={priority === value}
                    className={cn(
                      "brutal-flat px-3 py-1.5 text-[11px] font-bold uppercase transition-colors",
                      priority === value
                        ? PRIORITY[value].className
                        : "bg-background text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {PRIORITY[value].label}
                  </button>
                ))}
              </div>
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
                      filter === value
                        ? "bg-foreground text-background"
                        : "bg-card hover:bg-muted",
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
                    : "Add your first task using the box above."}
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
                            {formatDueLabel(task.dueAt)}
                          </span>
                        )}
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
            {/* weekly chart */}
            <section className="brutal-flat bg-card p-5">
              <div className="mb-4 flex items-center gap-2">
                <Flag className="size-4" />
                <h2 className="font-display text-sm uppercase tracking-wide">Last 7 days</h2>
              </div>

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
                    <span className="text-[10px] uppercase text-muted-foreground">
                      {day.day}
                    </span>
                  </div>
                ))}
              </div>

              <p className="mt-4 border-t-2 border-border pt-3 text-[11px] uppercase text-muted-foreground">
                <span className="font-bold text-foreground">
                  {stats?.completedThisWeek ?? 0}
                </span>{" "}
                completed in the last 7 days
              </p>
            </section>

            {/* notes */}
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
      </main>
    </div>
  );
}