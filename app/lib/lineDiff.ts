// UI tier-2 #6 — a pure line-level diff for the Gate #3 SKILL.md review (the highest-blast action
// in the product: overwriting a repo file). An LCS diff classifies each line as unchanged /
// removed / added so the review surface can highlight exactly what changes, instead of asking the
// reviewer to eyeball two full bodies. No DOM / 'server-only', so it is unit-testable under the
// dependency-free `node --test` harness and usable from a Client Component.

export type DiffKind = 'same' | 'del' | 'add';

export interface DiffLine {
  readonly kind: DiffKind;
  readonly text: string;
}

function splitLines(text: string): readonly string[] {
  // '' is "no content" (zero lines), not one empty line — avoids a spurious blank diff row.
  return text === '' ? [] : text.split('\n');
}

/**
 * Classic LCS line diff of `before` → `after`. Returns the lines in output order: unchanged lines
 * (`same`), lines only in `before` (`del`), lines only in `after` (`add`). O(n·m) in line counts,
 * which is fine for SKILL.md-sized inputs.
 */
export function lineDiff(before: string, after: string): readonly DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: 'del', text: a[i]! });
      i++;
    } else {
      out.push({ kind: 'add', text: b[j]! });
      j++;
    }
  }
  while (i < n) {
    out.push({ kind: 'del', text: a[i]! });
    i++;
  }
  while (j < m) {
    out.push({ kind: 'add', text: b[j]! });
    j++;
  }
  return out;
}

/** True when the two bodies differ (any add/del line) — lets the UI label an unchanged proposal. */
export function hasChanges(diff: readonly DiffLine[]): boolean {
  return diff.some((line) => line.kind !== 'same');
}
