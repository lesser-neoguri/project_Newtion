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
