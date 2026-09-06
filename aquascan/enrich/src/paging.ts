// Cursor arithmetic for paging a subgraph by an ordered numeric field (block, shippedAt...).
// A page holds at most `pageSize` rows ordered ascending. Ties at the end of a full page
// are re-read on the next call by stepping the cursor back to just before the last key.

export interface PagePlan {
  done: boolean;          // the page was not full: everything up to `cursor` has been read
  cursor: number;         // the next `_gt` value
  overflowKey?: number;   // a full page made of one single key: fetch that key with skip paging
}

export function planNextPage(keys: number[], pageSize: number, previousCursor: number): PagePlan {
  if (keys.length === 0) return { done: true, cursor: previousCursor };
  let min = keys[0], max = keys[0];
  for (const k of keys) { if (k < min) min = k; if (k > max) max = k; }
  if (keys.length < pageSize) return { done: true, cursor: max };
  if (min === max) return { done: false, cursor: max, overflowKey: max };
  return { done: false, cursor: max - 1 };
}
