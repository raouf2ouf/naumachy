// Average-cost bookkeeping for one book of tokens. Positions are signed: a maker that hands out
// more of a token than it took in since it was first seen holds a negative position, opened at the
// price it sold; covering it later realises the difference. Fees are not a separate line: the
// legs already carry them.

export interface Book { position: number; basis: number; realised: number; legs: number }

export function emptyBook(): Book { return { position: 0, basis: 0, realised: 0, legs: 0 }; }

// Applies one trade of signed quantity dq (positive = received) at unit price p.
export function trade(b: Book, dq: number, p: number): void {
  b.legs += 1;
  if (dq === 0) return;
  if (b.position === 0 || Math.sign(b.position) === Math.sign(dq)) {
    // opening or adding: the basis blends
    b.basis = (Math.abs(b.position) * b.basis + Math.abs(dq) * p) / (Math.abs(b.position) + Math.abs(dq));
    b.position += dq;
    return;
  }
  // reducing, possibly through zero: the closed part realises against the basis
  const closed = Math.min(Math.abs(dq), Math.abs(b.position));
  b.realised += closed * (p - b.basis) * Math.sign(b.position);
  const left = dq + Math.sign(b.position) * closed;   // what remains of dq after closing
  b.position += dq;
  if (Math.abs(b.position) < 1e-12) { b.position = 0; b.basis = 0; }
  else if (left !== 0) b.basis = p;                  // flipped: the new side opens at this price
}

export function unrealised(b: Book, mark: number | null): number | null {
  if (mark === null || b.position === 0) return b.position === 0 ? 0 : null;
  return b.position * (mark - b.basis);
}

export interface LegIn { token: string; qty: number; usd: number | null; rank: number }

// Prices the legs of one fill so it is self-financing: the best-ranked priced leg (stables first,
// then majors) anchors in dollars, and with two legs the other takes the rate the fill set. A fill
// with three or more legs uses each leg's own price and is dropped if one is missing.
export function priceFill(legs: LegIn[]): { token: string; qty: number; price: number }[] | null {
  const priced = legs.filter((l) => l.usd !== null && l.qty !== 0);
  if (priced.length === 0) return null;
  if (legs.length === 2) {
    const anchor = [...priced].sort((a, b) => a.rank - b.rank)[0];
    const other = legs.find((l) => l !== anchor)!;
    if (other.qty === 0) return null;
    const value = Math.abs(anchor.qty) * (anchor.usd as number);
    return [
      { token: anchor.token, qty: anchor.qty, price: anchor.usd as number },
      { token: other.token, qty: other.qty, price: value / Math.abs(other.qty) },
    ];
  }
  if (priced.length !== legs.length) return null;
  return legs.map((l) => ({ token: l.token, qty: l.qty, price: l.usd as number }));
}
