export type DiffLine =
  | { type: "same"; text: string; oldNo: number; newNo: number }
  | { type: "del"; text: string; oldNo: number }
  | { type: "add"; text: string; newNo: number };

export type DiffRow = DiffLine | { type: "skip"; count: number };

/** Line diff via longest common subsequence. Fine for documents up to a few thousand lines. */
export function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split("\n");
  const B = b.split("\n");

  // Trim common prefix/suffix first so the DP table stays small.
  let start = 0;
  while (start < A.length && start < B.length && A[start] === B[start]) start++;
  let endA = A.length, endB = B.length;
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) { endA--; endB--; }

  const a2 = A.slice(start, endA);
  const b2 = B.slice(start, endB);
  const n = a2.length, m = b2.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a2[i] === b2[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  for (let k = 0; k < start; k++) out.push({ type: "same", text: A[k], oldNo: k + 1, newNo: k + 1 });
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a2[i] === b2[j]) {
      out.push({ type: "same", text: a2[i], oldNo: start + i + 1, newNo: start + j + 1 });
      i++; j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      out.push({ type: "add", text: b2[j], newNo: start + j + 1 });
      j++;
    } else {
      out.push({ type: "del", text: a2[i], oldNo: start + i + 1 });
      i++;
    }
  }
  for (let k = 0; k < A.length - endA; k++) {
    out.push({ type: "same", text: A[endA + k], oldNo: endA + k + 1, newNo: endB + k + 1 });
  }
  return out;
}

/** Collapses long unchanged runs, keeping `context` lines around each change. */
export function withContext(lines: DiffLine[], context = 3): DiffRow[] {
  const keep = new Array(lines.length).fill(false);
  lines.forEach((l, idx) => {
    if (l.type !== "same") {
      for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) keep[k] = true;
    }
  });
  const rows: DiffRow[] = [];
  let skipped = 0;
  lines.forEach((l, idx) => {
    if (keep[idx]) {
      if (skipped) rows.push({ type: "skip", count: skipped });
      skipped = 0;
      rows.push(l);
    } else skipped++;
  });
  if (skipped) rows.push({ type: "skip", count: skipped });
  return rows;
}

export type WordSeg = { type: "same" | "add" | "del"; text: string };

/** Word-level diff of two strings (keeps whitespace/punctuation as tokens). */
export function diffWords(a: string, b: string): WordSeg[] {
  const tok = (s: string) => s.match(/\s+|[.,!?;:()[\]{}"'`·~]|[^\s.,!?;:()[\]{}"'`·~]+/g) ?? [];
  const A = tok(a), B = tok(b);
  const n = A.length, m = B.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: WordSeg[] = [];
  const push = (type: WordSeg["type"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { push("same", A[i]); i++; j++; }
    else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) { push("del", A[i]); i++; }
    else { push("add", B[j]); j++; }
  }
  // Show deletions before additions inside a changed run ("old → new" reading order).
  for (let k = 0; k + 1 < out.length; k++) {
    if (out[k].type === "add" && out[k + 1].type === "del") [out[k], out[k + 1]] = [out[k + 1], out[k]];
  }
  // Refine "word → word'" replacements to character level when the words overlap,
  // so Korean ending changes (결정함 → 결정했다) only mark the changed syllables.
  const refined: WordSeg[] = [];
  for (let k = 0; k < out.length; k++) {
    const d = out[k], a = out[k + 1];
    if (d.type === "del" && a?.type === "add" && !/\s/.test(d.text + a.text) && d.text.length <= 40 && a.text.length <= 40) {
      const chars = diffChars(d.text, a.text);
      const same = chars.filter((c) => c.type === "same").reduce((n, c) => n + c.text.length, 0);
      if (same > 0 && same >= Math.min(d.text.length, a.text.length) / 2) {
        refined.push(...chars);
        k++;
        continue;
      }
    }
    refined.push(d);
  }
  // Merge neighbours of the same type created by refinement.
  return refined.reduce<WordSeg[]>((acc, seg) => {
    const last = acc[acc.length - 1];
    if (last && last.type === seg.type) last.text += seg.text;
    else acc.push({ ...seg });
    return acc;
  }, []);
}

function diffChars(a: string, b: string): WordSeg[] {
  const A = [...a], B = [...b];
  const n = A.length, m = B.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: WordSeg[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { out.push({ type: "same", text: A[i] }); i++; j++; }
    else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) { out.push({ type: "del", text: A[i] }); i++; }
    else { out.push({ type: "add", text: B[j] }); j++; }
  }
  return out;
}
