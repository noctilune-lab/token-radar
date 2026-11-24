# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/noctilune-lab/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/noctilune-lab/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A static token launch radar built from a sealed DefiLlama snapshot (758 protocols, as of 2026-11-14). It finds the protocols that have no token yet, ranks them by implied value, and ships a no-network dashboard with a detail view and a farm plan for every row.

The value model uses only the snapshot's own figures: implied value = TVL x the median market-cap/TVL multiple of token-bearing protocols in the same category (the global median when a category has fewer than five such peers), adjusted by 7-day TVL growth and by how long the protocol has been listed without a token. Wrapped, staked, bridged, versioned and exchange products are excluded, and protocols whose token already trades are shown in a separate view. The board covers all 40 watchlist protocols plus every other pre-token protocol down to the snapshot's $5M floor: 198 rows.

## Run it

```sh
node main.ts --input snapshot.json --output out
```

Node 22 or later, standard library only. It writes board.json, data.js, dashboard/, screenshots/ and dossier.json into the output directory, and two runs on the same snapshot write the same bytes.

---

<sub>Entered on [make.fun](https://make.fun/?ref=ec83f8e6&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
