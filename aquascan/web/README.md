# aquascan/web

The explorer. Vite, React, TypeScript, Tailwind, TanStack Query, Recharts. Reads `aquascan/api`.

Light by default: a near-white canvas, white tiles with a hairline and a faint shadow, ink, one royal-blue accent for the claim and the interactive state, green for gains and red for losses; a dark theme behind the toggle. Inter with tabular figures everywhere; Geist Mono only for hashes, instruction names and program bytes. Tokens live in `src/index.css`.

Every page is a header and a set of tiles: the overview opens on the venue in four numbers and the same fills marked at four moments, then the makers ranked; a maker or a strategy opens on its score strip, then its fees, result, programs and fills. Every priced number carries its coverage; unpriced stays a word. `src/pages/HowItIsBuilt.tsx` tells the story of the project with its own animated figures.

```sh
yarn workspace @naumachy/aquascan-web dev        # http://localhost:5173, proxies /api to the API on 3100
yarn workspace @naumachy/aquascan-web build      # dist/
```

Set `VITE_API_URL` when the API is not on the same origin.
