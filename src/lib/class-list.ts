import type { ClassRow } from "@/lib/label-client";

/**
 * Insert or replace one class without cloning the other rows.
 * The list stays ordered by permanent class id. Unchanged row objects keep
 * their identity so the table can skip rendering them.
 */
export function mergeClassRow(list: readonly ClassRow[] | null, row: ClassRow): ClassRow[] {
  const current = list ?? [];
  const index = current.findIndex((item) => item.id === row.id);
  if (index >= 0) {
    const next = current.slice();
    next[index] = { ...current[index], ...row };
    return next;
  }
  const last = current[current.length - 1];
  if (!last || row.id > last.id) return [...current, row];
  const next = current.slice();
  let at = 0;
  while (at < next.length && next[at].id < row.id) at += 1;
  next.splice(at, 0, row);
  return next;
}

export type ClassSearchEntry = {
  row: ClassRow;
  ic: string;
  des: string;
  id: string;
};

/** Lowercase search fields once per class list, not on every keystroke. */
export function buildClassSearch(classes: readonly ClassRow[]): ClassSearchEntry[] {
  return classes.map((row) => ({
    row,
    ic: row.ic.toLowerCase(),
    des: row.des.toLowerCase(),
    id: String(row.id),
  }));
}

/**
 * Filter classes by item code, description, or id.
 * An empty query returns the same array instance.
 */
export function filterClassSearch(
  classes: readonly ClassRow[],
  entries: readonly ClassSearchEntry[],
  query: string,
): ClassRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return classes as ClassRow[];
  const matched: ClassRow[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.ic.includes(q) || entry.des.includes(q) || entry.id.includes(q)) {
      matched.push(entry.row);
    }
  }
  return matched;
}
