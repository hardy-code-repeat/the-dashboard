/**
 * Life-area catalogue and integration provider catalogue.
 *
 * Both are static, UI-facing metadata. Kept out of the database because it
 * changes with the app, not with the user — the database only stores which
 * areas a user has enabled and which providers they have connected.
 */

export interface AreaDef {
  slug: string;
  label: string;
  /** One-line pitch shown in the "add an area" picker. */
  blurb: string;
  /** Which dashboard tab body this area renders. */
  kind: "tasks" | "finance" | "people" | "health" | "home" | "custom";
  accent: "primary" | "secondary" | "accent" | "card" | "muted";
  /** Suggested starter tasks, created only if the user asks to seed. */
  starterTasks?: string[];
}

export const AREAS: AreaDef[] = [
  {
    slug: "general",
    label: "General",
    blurb: "Everything that doesn't belong anywhere else.",
    kind: "tasks",
    accent: "card",
  },
  {
    slug: "finance",
    label: "Finance",
    blurb: "Tax deadlines, expenses and what you can write off.",
    kind: "finance",
    accent: "primary",
    starterTasks: [
      "gather last year's tax documents tomorrow",
      "review bank statements every week",
      "check quarterly estimated tax every 3 months",
    ],
  },
  {
    slug: "relationships",
    label: "Relationships",
    blurb: "People who matter, and the moments you'd otherwise forget.",
    kind: "people",
    accent: "secondary",
    starterTasks: [
      "call mum this week",
      "birthday reminders every year",
      "plan dinner with friends every month",
    ],
  },
  {
    slug: "health",
    label: "Health",
    blurb: "Sleep, training, appointments and checkups.",
    kind: "health",
    accent: "accent",
    starterTasks: [
      "book dentist checkup every 6 months",
      "walk 30 minutes every day",
      "drink water daily",
    ],
  },
  {
    slug: "home",
    label: "Home",
    blurb: "Repairs, cleaning, and the admin of running a place.",
    kind: "home",
    accent: "card",
    starterTasks: [
      "change filters every 3 months",
      "deep clean every month",
      "service boiler every year",
    ],
  },
];

export function areaBySlug(slug: string): AreaDef | undefined {
  return AREAS.find((a) => a.slug === slug);
}

/** Maps a Tailwind token name to its theme classes. */
export function accentClasses(accent: AreaDef["accent"]): string {
  switch (accent) {
    case "primary":
      return "bg-primary text-foreground";
    case "secondary":
      return "bg-secondary text-secondary-foreground";
    case "accent":
      return "bg-accent text-accent-foreground";
    case "muted":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-card text-card-foreground";
  }
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export type ProviderStatus = "connected" | "available" | "coming-soon";

export interface ProviderDef {
  slug: string;
  label: string;
  /** What this connection actually does for the user. */
  blurb: string;
  category: "Calendar" | "Money" | "Work" | "Health" | "Notes" | "Files";
  /**
   * Whether the backend can complete a real OAuth handshake for this
   * provider today. "coming-soon" entries are shown so the roadmap is
   * visible, but the connect button is disabled rather than faked.
   */
  status: ProviderStatus;
  /** Env vars the user must supply before it can be wired up. */
  requiredEnvVars?: string[];
  docsUrl?: string;
}

export type ProviderWithState = ProviderDef & { connected: boolean };

export const PROVIDERS: ProviderDef[] = [
  {
    slug: "google-calendar",
    label: "Google Calendar",
    blurb: "Pull today's meetings and the next one into your brief.",
    category: "Calendar",
    status: "available",
    requiredEnvVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    docsUrl: "https://developers.google.com/calendar",
  },
  {
    slug: "outlook-calendar",
    label: "Outlook Calendar",
    blurb: "Work and personal Microsoft 365 events in one place.",
    category: "Calendar",
    status: "coming-soon",
  },
  {
    slug: "nylas",
    label: "Nylas (mail + calendar)",
    blurb: "One connection covering Gmail, Outlook and iCloud, plus mail.",
    category: "Calendar",
    status: "available",
    requiredEnvVars: ["NYLAS_CLIENT_ID", "NYLAS_API_KEY"],
    docsUrl: "https://developer.nylas.com",
  },
  {
    slug: "plaid",
    label: "Bank accounts",
    blurb: "Read-only transaction feed to categorise expenses automatically.",
    category: "Money",
    status: "available",
    requiredEnvVars: ["PLAID_CLIENT_ID", "PLAID_SECRET"],
    docsUrl: "https://plaid.com/docs/",
  },
  {
    slug: "github",
    label: "GitHub",
    blurb: "Issues and review requests pulled into one inbox.",
    category: "Work",
    status: "available",
    requiredEnvVars: ["GITHUB_TOKEN"],
    docsUrl: "https://docs.github.com",
  },
  {
    slug: "linear",
    label: "Linear",
    blurb: "Assigned issues surface as tasks, so nothing slips.",
    category: "Work",
    status: "available",
    requiredEnvVars: ["LINEAR_API_KEY"],
    docsUrl: "https://developers.linear.app",
  },
  {
    slug: "notion",
    label: "Notion",
    blurb: "Mirror a database as a read-only board.",
    category: "Notes",
    status: "available",
    requiredEnvVars: ["NOTION_TOKEN"],
    docsUrl: "https://developers.notion.com",
  },
  {
    slug: "google-drive",
    label: "Google Drive",
    blurb: "Attach receipts and statements straight to a task.",
    category: "Files",
    status: "coming-soon",
  },
  {
    slug: "strava",
    label: "Strava",
    blurb: "Runs and rides logged into your health area.",
    category: "Health",
    status: "coming-soon",
  },
];