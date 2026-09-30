import { motion } from "framer-motion";
import {
  AlarmClock,
  ArrowRight,
  Brain,
  Check,
  Flag,
  MoveRight,
  Repeat,
  Zap,
} from "lucide-react";
import { Link } from "react-router";

import { useAuth } from "@/hooks/use-auth";

const FEATURES = [
  {
    icon: Zap,
    title: "Type it like you'd say it",
    body: "\u201cCall Sam Friday re contract\u201d becomes a task with the date already set. Dates, times, priority and #tags get pulled out for you.",
    tone: "bg-primary",
  },
  {
    icon: Brain,
    title: "It learns what you finish",
    body: "A model trains on your own completions — not on everyone. The work you actually finish rises to the top.",
    tone: "bg-secondary text-secondary-foreground",
  },
  {
    icon: AlarmClock,
    title: "Overdue you can see",
    body: "Late work is flagged in red the moment it slips, so it never quietly disappears from view.",
    tone: "bg-accent text-accent-foreground",
  },
  {
    icon: Repeat,
    title: "Repeats that repeat",
    body: "\u201cEvery Monday\u201d or \u201cevery 3 days\u201d is understood on the way in, not retyped every week.",
    tone: "bg-card",
  },
  {
    icon: Flag,
    title: "A seven-day read",
    body: "A bar chart of what you actually finished. Honest feedback, not a streak you can fake.",
    tone: "bg-primary",
  },
  {
    icon: Check,
    title: "Done means done",
    body: "Tick it off, watch the completion rate move, clear the list and start clean.",
    tone: "bg-card",
  },
] as const;

const STEPS = [
  { n: "01", t: "Sign in with your email", d: "No password to remember. A code lands in your inbox and you're in." },
  { n: "02", t: "Dump everything, plainly", d: "Type tasks the way you'd say them out loud. Dates and priority sort themselves." },
  { n: "03", t: "Work the top of the list", d: "It learns what you actually finish and keeps that first." },
] as const;

function MarqueeRow({ items }: { items: string[] }) {
  // Duplicated once so the -50% translate loops seamlessly.
  const row = [...items, ...items];
  return (
    <div className="overflow-hidden border-y-2 border-border bg-foreground text-background">
      <div className="flex w-max animate-marquee items-center py-2.5" aria-hidden>
        {row.map((item, i) => (
          <span key={i} className="flex shrink-0 items-center gap-8 pr-8 text-xs font-bold uppercase">
            {item}
            <span className="size-2 bg-current" />
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Landing() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      {/* ---------- NAV ---------- */}
      <header className="sticky top-0 z-50 border-b-2 border-border bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="brutal-flat flex size-9 items-center justify-center bg-primary">
              <span className="font-display text-base leading-none">P</span>
            </div>
            <span className="font-display text-lg uppercase tracking-tight">Panel</span>
          </div>

          <nav className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-xs font-bold uppercase underline-offset-4 hover:underline">
              Features
            </a>
            <a href="#how" className="text-xs font-bold uppercase underline-offset-4 hover:underline">
              How it works
            </a>
            <a href="#start" className="text-xs font-bold uppercase underline-offset-4 hover:underline">
              Get started
            </a>
          </nav>

          <Link to={isAuthenticated ? "/dashboard" : "/auth"}>
            <button className="brutal bg-primary px-5 py-2.5 text-xs font-bold uppercase">
              {isAuthenticated ? "Dashboard" : "Start free"}
            </button>
          </Link>
        </div>
      </header>

      {/* ---------- HERO ---------- */}
      <section className="relative overflow-hidden border-b-2 border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[1.1fr_1fr] lg:py-24">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="brutal-flat mb-8 inline-flex items-center gap-2 bg-accent px-3 py-2 text-accent-foreground"
            >
              <span className="size-2 bg-current" />
              <span className="text-[11px] font-bold uppercase">Runs on-device. No AI API.</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.05 }}
              className="font-display text-5xl leading-[0.92] tracking-tight uppercase sm:text-6xl lg:text-7xl"
            >
              Type it
              <br />
              how you'd
              <span className="ml-3 inline-block border-2 border-border bg-primary px-3 py-1">
                say it
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.12 }}
              className="mt-7 max-w-lg text-base leading-relaxed text-muted-foreground"
            >
              Panel is a personal dashboard for the things you actually have to do.
              Type it the way you'd say it, and it pulls out the date, priority and
              tags. Then it learns which work you actually finish — and puts that
              first.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.18 }}
              className="mt-9 flex flex-wrap items-center gap-4"
            >
              <Link to={isAuthenticated ? "/dashboard" : "/auth"}>
                <button className="brutal flex items-center gap-2 bg-primary px-7 py-4 text-sm font-bold uppercase">
                  {isAuthenticated ? "Open dashboard" : "Build my dashboard"}
                  <ArrowRight className="size-4" />
                </button>
              </Link>
              <a href="#how">
                <button className="brutal flex items-center gap-2 bg-card px-7 py-4 text-sm font-bold uppercase">
                  See how it works
                  <MoveRight className="size-4" />
                </button>
              </a>
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.35, delay: 0.25 }}
              className="mt-7 text-[11px] uppercase text-muted-foreground"
            >
              Free · No credit card · Nothing you type leaves your account
            </motion.p>
          </div>

          {/* product preview */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.15 }}
            className="relative"
          >
            <div className="brutal bg-card p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="brutal-flat bg-primary p-3">
                  <p className="text-[10px] font-bold uppercase">Open</p>
                  <p className="font-display mt-1 text-3xl leading-none">7</p>
                </div>
                <div className="brutal-flat bg-accent p-3 text-accent-foreground">
                  <p className="text-[10px] font-bold uppercase">Done today</p>
                  <p className="font-display mt-1 text-3xl leading-none">4</p>
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-2.5">
                {[
                  { t: "Ship the pricing page", done: true },
                  { t: "Reply to Sam about API limits", done: true },
                  { t: "Rewrite the onboarding copy", done: false, hot: true },
                  { t: "Book the dentist", done: false },
                  { t: "Cancel the unused subscription", done: false },
                ].map((row) => (
                  <div
                    key={row.t}
                    className={`flex items-center gap-3 border-2 border-border p-2.5 ${
                      row.hot ? "bg-secondary text-secondary-foreground" : "bg-background"
                    }`}
                  >
                    <span
                      className={`flex size-5 shrink-0 items-center justify-center border-2 border-border ${
                        row.done ? "bg-foreground" : "bg-card"
                      }`}
                    >
                      {row.done ? <Check className="size-3 text-background" strokeWidth={4} /> : null}
                    </span>
                    <span
                      className={`text-[11px] ${row.done ? "text-muted-foreground line-through" : ""}`}
                    >
                      {row.t}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex h-16 items-end gap-1.5 border-2 border-border bg-background p-2">
                {[40, 70, 30, 90, 55, 20, 65].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 border-2 border-border bg-primary"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
            </div>

            {/* offset accent block */}
            <div className="brutal-flat absolute -bottom-5 -right-3 hidden bg-secondary p-3 text-secondary-foreground sm:block">
              <p className="text-[10px] font-bold uppercase">Rate</p>
              <p className="font-display text-2xl leading-none">62%</p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ---------- MARQUEE ---------- */}
      <MarqueeRow items={["No subscriptions", "No teams", "No setup", "Just your list"]} />

      {/* ---------- FEATURES ---------- */}
      <section id="features" className="border-b-2 border-border bg-card">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="mb-3 inline-block border-2 border-border bg-primary px-2.5 py-1 text-[11px] font-bold uppercase">
                What you get
              </p>
              <h2 className="font-display text-4xl leading-none tracking-tight uppercase sm:text-5xl">
                Everything on
                <br />
                the surface
              </h2>
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
              No dashboards inside dashboards. Six things, all visible at once,
              none of them buried behind a menu.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature, i) => (
              <motion.article
                key={feature.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.3, delay: (i % 3) * 0.07 }}
                className={`brutal-flat flex flex-col gap-3 p-5 ${feature.tone}`}
              >
                <div className="brutal-flat flex size-10 items-center justify-center bg-background">
                  <feature.icon className="size-5" />
                </div>
                <h3 className="font-display text-base uppercase leading-tight">{feature.title}</h3>
                <p className="text-[13px] leading-relaxed opacity-80">{feature.body}</p>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- HOW IT WORKS ---------- */}
      <section id="how" className="border-b-2 border-border">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <p className="mb-3 inline-block border-2 border-border bg-accent px-2.5 py-1 text-[11px] font-bold uppercase text-accent-foreground">
            How it works
          </p>
          <h2 className="font-display mb-12 text-4xl leading-none tracking-tight uppercase sm:text-5xl">
            Three steps, once
          </h2>

          <div className="grid gap-5 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <motion.div
                key={step.n}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.3, delay: i * 0.08 }}
                className="brutal-flat relative bg-card p-6"
              >
                <span className="font-display absolute top-4 right-5 text-5xl leading-none text-muted/60">
                  {step.n}
                </span>
                <h3 className="font-display relative pr-14 text-lg uppercase leading-tight">
                  {step.t}
                </h3>
                <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">{step.d}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- SOCIAL PROOF ---------- */}
      <section className="border-b-2 border-border bg-foreground text-background">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <h2 className="font-display mb-10 text-3xl leading-none tracking-tight uppercase sm:text-4xl">
            What people say
          </h2>

          <div className="grid gap-5 md:grid-cols-3">
            {[
              {
                q: "I had 40 tabs open every morning. Now I open one page and start working. That's the whole review.",
                n: "Rae M.",
                r: "Founder, 6-person shop",
              },
              {
                q: "The overdue flag is the part I didn't know I needed. Things that slip actually surface now instead of rotting.",
                n: "Devin K.",
                r: "Freelance engineer",
              },
              {
                q: "It does six things and shows me all six at once. I've deleted three other tools since I started using it.",
                n: "Ana P.",
                r: "Studio owner",
              },
            ].map((quote, i) => (
              <motion.figure
                key={quote.n}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.3, delay: i * 0.08 }}
                className="flex flex-col gap-4 border-2 border-background p-5"
              >
                <p className="text-sm leading-relaxed">“{quote.q}”</p>
                <figcaption className="mt-auto border-t-2 border-background pt-3">
                  <p className="text-xs font-bold uppercase">{quote.n}</p>
                  <p className="text-[11px] uppercase opacity-60">{quote.r}</p>
                </figcaption>
              </motion.figure>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section id="start" className="bg-primary">
        <div className="mx-auto max-w-6xl px-5 py-16 text-center lg:py-24">
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.3 }}
            className="brutal mx-auto max-w-3xl bg-card p-8 lg:p-12"
          >
            <h2 className="font-display text-4xl leading-[0.95] tracking-tight uppercase sm:text-5xl">
              Stop juggling.
              <br />
              Start with one page.
            </h2>
            <p className="mx-auto mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
              Your first task is thirty seconds away. No setup, no tour, no card.
            </p>
            <Link to={isAuthenticated ? "/dashboard" : "/auth"}>
              <button className="brutal mt-8 inline-flex items-center gap-2 bg-primary px-8 py-4 text-sm font-bold uppercase">
                {isAuthenticated ? "Go to dashboard" : "Get started — it's free"}
                <ArrowRight className="size-4" />
              </button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ---------- FOOTER ---------- */}
      <footer className="border-t-2 border-border bg-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6">
          <div className="flex items-center gap-2.5">
            <div className="brutal-flat flex size-7 items-center justify-center bg-primary">
              <span className="font-display text-xs leading-none">P</span>
            </div>
            <span className="font-display text-sm uppercase">Panel</span>
          </div>
          <p className="text-[11px] uppercase text-muted-foreground">
            Your day, on one page. Built for you alone.
          </p>
        </div>
      </footer>
    </div>
  );
}