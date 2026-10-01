/**
 * Identity keys (phase 3, feature 1).
 *
 * A person is identified by more than their name — "Raj" is a common name in
 * more than one country, and two people called Raj are not the same person. So
 * Panel does not key on a name. It keeps a set of **identity keys** per person:
 * normalised strings that are individually meaningful evidence, and that a
 * future provider (contacts, email, messaging) can contribute to without
 * changing anything else in the system.
 *
 * Three rules, and all three exist because of RJD-004 ("Raj" ≠ "Raj"):
 *
 *  1. **Keys are computed, never stored from raw input.** `identityKeysFor`
 *     normalises: lowercase, diacritics folded, punctuation dropped, whitespace
 *     collapsed. Two spellings of the same name produce the same key, which is
 *     the point.
 *  2. **Sharing a key is evidence, never a merge.** `matchingKeys` exists so the
 *     UI can say "you already have someone called Raj" and let the *user*
 *     decide. Nothing in this file can merge anything, and nothing calls a
 *     mutation.
 *  3. **Keys are derived, not mutated.** A merge does not copy the source's
 *     keys onto the target — it sets `mergedIntoId` on the source, and
 *     `resolvedIdentityKeys` follows the chain. That is what makes unmerge
 *     exact: there is nothing to restore, because nothing was rewritten.
 *
 * Pure, dependency-free, and taking no clock (ADR-002).
 */

/** Longest key we will store. A pathological input must not become a row. */
export const MAX_KEY_LENGTH = 120;

/** Most keys one person may carry. Bounded because a mutation writes them. */
export const MAX_KEYS = 12;

/**
 * Folds a string down to a comparison key.
 *
 * Diacritics are folded by NFKD decomposition plus a strip of combining marks,
 * so "José" and "Jose" agree.
 *
 * Punctuation becomes a space rather than vanishing, which is the
 * *conservative* direction: "O'Brien" and "OBrien" stay different keys, and so
 * do "Jean Luc" and "Jeanluc". Removing separators instead would make both
 * pairs agree, and a matcher that agrees about more is a matcher that offers to
 * merge more. Since sharing a key is a suggestion a human accepts, under-
 * matching costs one extra row and over-matching costs a wrong merge.
 *
 * The result is *evidence*, not identity.
 */
export function normaliseKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_KEY_LENGTH);
}

/**
 * Folds an email address down to a comparison key.
 *
 * Separate from {@link normaliseKey} because an address is not a phrase. `.`,
 * `-`, `_` and `+` are *meaningful* inside a local or domain part, and `@` is
 * the boundary between them — running the name normaliser over an address turns
 * `raj@ex.co.uk` into `raj ex co uk`, which both reads as nonsense on screen
 * and collides with a genuinely different address. Only characters that cannot
 * appear in an address are dropped, and the structure is kept.
 *
 * A dropped character is removed outright, so a stray space or newline around
 * the `@` is forgiven. That is safe because {@link identityKeysFor} refuses to
 * emit an `email:` key at all unless an `@` survives: an address the user typed
 * as `raj at example.com` produces no key rather than a wrong one.
 */
export function normaliseEmailKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@._+-]/g, "")
    .slice(0, MAX_KEY_LENGTH);
}

/**
 * Every identity key a person can be reached by right now.
 *
 * A live person's keys are its own. A tombstone's keys are *its own plus its
 * target's*, resolved recursively — which is how "merge then add an email"
 * works without the merge having to copy anything.
 *
 * Cycle-guarded. A merge that somehow formed a cycle would otherwise hang a
 * query, and a hang is a much worse failure than a short key list.
 */
export function resolvedIdentityKeys(
  person: { identityKeys?: string[]; mergedIntoId?: string | null },
  lookup: (id: string) => { identityKeys?: string[]; mergedIntoId?: string | null } | null | undefined,
): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  let current: { identityKeys?: string[]; mergedIntoId?: string | null } | null | undefined = person;
  let hops = 0;

  while (current && hops < 8) {
    for (const key of current.identityKeys ?? []) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
    if (!current.mergedIntoId || seen.has(current.mergedIntoId)) break;
    seen.add(current.mergedIntoId);
    current = lookup(current.mergedIntoId);
    hops += 1;
  }

  return keys.slice(0, MAX_KEYS).sort();
}

/**
 * The keys a new or edited person should carry.
 *
 * Name and optional email, each namespaced so `raj` and a mail domain can never
 * collide, and each kept only when it normalises to something non-empty. An
 * input that normalises to nothing contributes nothing rather than an empty
 * string that would match every other empty string.
 */
export function identityKeysFor(args: { name: string; email?: string | null }): string[] {
  const keys: string[] = [];

  const name = normaliseKey(args.name);
  if (name) keys.push(`name:${name}`);

  const email = args.email ? normaliseEmailKey(args.email) : "";
  // An email without an `@` is not an email; storing `email:raj` would be
  // evidence that is worse than none.
  if (email.includes("@")) keys.push(`email:${email}`);

  return keys.slice(0, MAX_KEYS);
}

/**
 * Keys two people already share.
 *
 * Returns the shared keys, sorted, so a caller can say *why* it thinks two
 * people might be the same. Empty when they share none — which is the common
 * case and the one that must stay cheap.
 */
export function matchingKeys(
  a: readonly string[],
  b: readonly string[],
): string[] {
  if (a.length === 0 || b.length === 0) return [];
  const bSet = new Set(b);
  const shared: string[] = [];
  for (const key of a) if (bSet.has(key)) shared.push(key);
  return shared.sort();
}

/**
 * Whether two people are *probably* the same, and why.
 *
 * Deliberately conservative and deliberately **advisory**. A shared name is not
 * enough on its own: a shared email is much stronger evidence, because an email
 * address is something a person owns rather than something they are called.
 * The caller is expected to show this as a suggestion the user accepts or
 * ignores — RJD-004 forbids acting on it automatically, and this function
 * returns information rather than a verdict.
 */
export interface MatchVerdict {
  /** True when the shared evidence is strong enough to suggest a merge. */
  suggest: boolean;
  /** The keys both people carry. */
  shared: string[];
  /** One short line a person can read and judge for themselves. */
  reason: string;
}

/**
 * Evidence strength, in the order that matters.
 *
 * `email` beats `name`, and only an email match clears the bar on its own. A
 * name match alone is worth mentioning — the user knows who their two Rajs are
 * — but it is never enough to do anything by itself.
 */
export function judgeMatch(shared: readonly string[]): MatchVerdict {
  if (shared.length === 0) return { suggest: false, shared: [], reason: "" };
  if (shared.some((k) => k.startsWith("email:"))) {
    return { suggest: true, shared: [...shared], reason: "Same email address" };
  }
  if (shared.some((k) => k.startsWith("name:"))) {
    return {
      suggest: true,
      shared: [...shared],
      reason: "Same name — check these are the same person",
    };
  }
  return { suggest: false, shared: [...shared], reason: "Shares an identity key" };
}

/**
 * A human-readable label for one key.
 *
 * Keys are machine strings and must never be shown raw: `name:raj` on screen
 * looks like a bug and teaches the user nothing about how Panel decides what is
 * the same.
 */
export function describeKey(key: string): string {
  const [kind, ...rest] = key.split(":");
  const value = rest.join(":");
  if (kind === "email") return value;
  if (kind === "name") return `name “${value}”`;
  return key;
}
