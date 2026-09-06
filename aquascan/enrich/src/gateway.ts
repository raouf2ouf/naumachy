import type { Paced } from "./pacer.js";

export interface GatewayResult<T> {
  data: T;
  block: number;          // _meta.block.number: how far the subgraph had synced when it answered
}

interface MetaShape { _meta?: { block?: { number?: number | string } } }

// Queries one published subgraph through The Graph gateway with the account's API key.
// Every query goes through the shared pacer; 429s and 5xxs are retried with backoff.
export class Gateway {
  constructor(
    private readonly apiKey: string,
    private readonly paced: Paced,
    private readonly onCall: (subgraphId: string) => void = () => {},
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async query<T extends MetaShape>(subgraphId: string, query: string, variables: Record<string, unknown>): Promise<GatewayResult<T>> {
    const url = `https://gateway.thegraph.com/api/${this.apiKey}/subgraphs/id/${subgraphId}`;
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const res = await this.paced(() => this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "naumachy-aquascan-enrich/0.1" },
        body: JSON.stringify({ query, variables }),
      }));
      this.onCall(subgraphId);
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= 6) throw new Error(`gateway ${res.status} after ${attempt} attempts`);
        await new Promise((r) => setTimeout(r, Math.min(60_000, 2_000 * 2 ** (attempt - 1))));
        continue;
      }
      const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
      if (!body.data) throw new Error(`gateway error: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
      const block = Number(body.data._meta?.block?.number ?? 0);
      return { data: body.data, block };
    }
  }
}
