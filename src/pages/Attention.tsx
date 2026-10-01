import { Link } from "react-router";

import { AttentionFeed } from "@/components/AttentionFeed";

/**
 * The attention screen.
 *
 * Separate from the dashboard on purpose. The dashboard is "your stuff";
 * attention is "what Panel thinks you should do next", and mixing them makes
 * both harder to read. The link back is always visible so neither is a trap.
 */
export default function Attention() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <nav className="mb-6">
        <Link
          to="/dashboard"
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          ← Back to your dashboard
        </Link>
      </nav>
      <AttentionFeed />
    </main>
  );
}
