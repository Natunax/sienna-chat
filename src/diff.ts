// A line diff for the changes Claude proposes: longest common subsequence
// on the lines between the common start and end, shown as hunks with a few
// lines of context, like `git diff`.

export interface DiffLine {
  kind: "same" | "add" | "remove";
  text: string;
  /** Line numbers in the old and the new text. */
  old?: number;
  new?: number;
}

/** A run of lines to show, or a gap of unchanged lines left out. */
export type DiffRow = DiffLine | { kind: "gap"; count: number };

const CONTEXT = 3;
// Beyond this many cell comparisons the middle shows as removed, then added.
const MAX_CELLS = 4_000_000;

function lines(text: string): string[] {
  if (!text) return [];
  const all = text.split("\n");
  if (all[all.length - 1] === "") all.pop();
  return all;
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = lines(before);
  const b = lines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ kind: "same", text: a[i], old: i + 1, new: i + 1 });

  const n = endA - start;
  const m = endB - start;
  if (n * m > MAX_CELLS) {
    for (let i = start; i < endA; i++) out.push({ kind: "remove", text: a[i], old: i + 1 });
    for (let j = start; j < endB; j++) out.push({ kind: "add", text: b[j], new: j + 1 });
  } else {
    // lengths[i][j]: common subsequence length of a[start+i..] and b[start+j..].
    const width = m + 1;
    const lengths = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lengths[i * width + j] =
          a[start + i] === b[start + j]
            ? lengths[(i + 1) * width + j + 1] + 1
            : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        out.push({ kind: "same", text: a[start + i], old: start + i + 1, new: start + j + 1 });
        i++;
        j++;
      } else if (j < m && (i === n || lengths[i * width + j + 1] >= lengths[(i + 1) * width + j])) {
        out.push({ kind: "add", text: b[start + j], new: start + j + 1 });
        j++;
      } else {
        out.push({ kind: "remove", text: a[start + i], old: start + i + 1 });
        i++;
      }
    }
    // Removals read better before the additions that replace them.
    for (let k = 0; k < out.length; k++) {
      if (out[k].kind !== "add") continue;
      let end = k;
      while (end < out.length && out[end].kind === "add") end++;
      let removes = end;
      while (removes < out.length && out[removes].kind === "remove") removes++;
      if (removes > end) {
        const run = out.splice(end, removes - end);
        out.splice(k, 0, ...run);
      }
      k = removes - 1;
    }
  }

  for (let i = endA; i < a.length; i++) {
    out.push({ kind: "same", text: a[i], old: i + 1, new: endB + (i - endA) + 1 });
  }
  return out;
}

/** Keeps a few unchanged lines around each change and folds the rest. */
export function withContext(diff: DiffLine[]): DiffRow[] {
  const keep = new Uint8Array(diff.length);
  diff.forEach((line, index) => {
    if (line.kind === "same") return;
    for (let k = Math.max(0, index - CONTEXT); k <= Math.min(diff.length - 1, index + CONTEXT); k++) keep[k] = 1;
  });
  const rows: DiffRow[] = [];
  let skipped = 0;
  diff.forEach((line, index) => {
    if (keep[index]) {
      if (skipped) rows.push({ kind: "gap", count: skipped });
      skipped = 0;
      rows.push(line);
    } else {
      skipped++;
    }
  });
  if (skipped) rows.push({ kind: "gap", count: skipped });
  return rows;
}

export function diffStats(diff: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff) {
    if (line.kind === "add") added++;
    else if (line.kind === "remove") removed++;
  }
  return { added, removed };
}
