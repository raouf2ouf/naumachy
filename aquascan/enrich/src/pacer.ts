// One outbound pacer per destination: calls are serialised and spaced to a fixed rate.
export type Paced = <T>(fn: () => Promise<T>) => Promise<T>;

export function createPacer(callsPerMinute: number, now: () => number = Date.now, sleep = defaultSleep): Paced {
  const interval = 60_000 / callsPerMinute;
  let last = -Infinity;
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = async (): Promise<T> => {
      const wait = last + interval - now();
      if (wait > 0) await sleep(wait);
      last = now();
      return fn();
    };
    const p = chain.then(run, run);
    chain = p.catch(() => undefined);
    return p;
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
