// `@path` mentions in project chats: finding the one being typed, ranking the
// project's files for it, and splitting text into plain parts and mentions.
// Rust resolves them when the message is sent (`src-tauri/src/mention.rs`).

import type { ProjectEntry } from "./api";

/** The mention the caret is in: where its `@` starts and what follows it. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@("[^"\n]*|[^\s"]*)$/.exec(before);
  if (!match) return null;
  const start = before.length - match[0].length + match[1].length;
  return { start, query: match[2].replace(/^"/, "") };
}

/** How a path is written after `@`: quoted when it has white space. */
export function mentionText(path: string): string {
  return /\s/.test(path) ? `@"${path}"` : `@${path}`;
}

export interface Ranked {
  entry: ProjectEntry;
  /** Positions in the path that matched the query, for highlighting. */
  hits: number[];
}

/**
 * Fuzzy match as in Claude Code: the query's characters in order anywhere in
 * the path, best when they are close together, start a word, or sit in the
 * file name. Without a query, the top level of the folder.
 */
export function rankEntries(entries: ProjectEntry[], query: string, limit = 8): Ranked[] {
  const needle = query.toLowerCase();
  if (!needle) {
    return entries
      .filter((entry) => !entry.path.includes("/"))
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.path.localeCompare(b.path))
      .slice(0, limit)
      .map((entry) => ({ entry, hits: [] }));
  }
  // `src/` lists what is inside src.
  if (needle.endsWith("/")) {
    const inside = entries.filter((entry) => {
      const path = entry.path.toLowerCase();
      return path.startsWith(needle) && !path.slice(needle.length).includes("/");
    });
    if (inside.length) {
      return inside
        .sort((a, b) => Number(b.dir) - Number(a.dir) || a.path.localeCompare(b.path))
        .slice(0, limit)
        .map((entry) => ({ entry, hits: [...Array(needle.length).keys()] }));
    }
  }
  const ranked: (Ranked & { score: number })[] = [];
  for (const entry of entries) {
    const path = entry.path.toLowerCase();
    const nameStart = path.lastIndexOf("/") + 1;
    const hits: number[] = [];
    let score = 0;
    let at = 0;
    for (const char of needle) {
      const found = path.indexOf(char, at);
      if (found < 0) {
        hits.length = 0;
        break;
      }
      if (hits.length && found === hits[hits.length - 1] + 1) score += 6;
      if (found === 0 || "/-_.".includes(path[found - 1])) score += 4;
      if (found >= nameStart) score += 2;
      score -= Math.min(found - at, 8) * 0.5;
      hits.push(found);
      at = found + 1;
    }
    if (hits.length !== needle.length) continue;
    // Shorter paths win a tie: `src/cart.ts` before `src/legacy/old/cart.ts`.
    ranked.push({ entry, hits, score: score - path.length * 0.05 });
  }
  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry, hits }) => ({ entry, hits }));
}

/** Text split into plain runs and the mentions in it, for highlighting. */
export function splitMentions(text: string): { text: string; mention: boolean }[] {
  const parts: { text: string; mention: boolean }[] = [];
  const pattern = /(^|\s)(@"[^"\n]+"|@[^\s"]+)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index + match[1].length;
    // Punctuation after a mention belongs to the sentence.
    const token = match[2].replace(/[.,;:!?)]+$/, "");
    if (token.length < 2) continue;
    if (start > last) parts.push({ text: text.slice(last, start), mention: false });
    parts.push({ text: token, mention: true });
    last = start + token.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), mention: false });
  return parts;
}

/** The path a mention token names, without `@` and quotes. */
export function mentionPath(token: string): string {
  return token.slice(1).replace(/^"|"$/g, "");
}
