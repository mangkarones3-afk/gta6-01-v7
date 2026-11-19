# gta6-01-v7

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/mangkarones3-afk/gta6-01-v7/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/mangkarones3-afk/gta6-01-v7/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Solano Bay** — an original top-down open-world crime game that runs as static
files, offline, in a desktop browser. Drive or walk a sun-soaked coastal city
with its own named districts and businesses (El Mercado, Mercado Central,
Torre Oficinas, Cine Aurora, Restaurante Cielo, Floristería Lila, Taller
Delgado), working traffic and pedestrians, and an SBPD wanted system that
escalates from patrol cars to a helicopter pursuit.

Five story missions — *Steal the Caspián*, *Hot Cargo*, *The Cielo
Shakedown*, *Paper Trail* and *High Tide Heist* — plus repeatable Courier Run
and Repo Job side work, a live minimap HUD (cash, health, weapon, speedometer,
wanted stars) and a save/continue system.

The game is plain JavaScript under `game/src/`, one module per job — `random`,
`city`, `audio`, `input`, `vehicles`, `pedestrians`, `wanted`, `combat`,
`save`, `minimap`, `missions`, `render` — driven by `solano-bay-game.js`.
`main.ts` at the root is the hand-in program: it copies `game/` and
`screenshots/` to the output directory and writes the dossier with the kit's
vendored `buildDossier` (`vendor/makefun-game.ts`, unmodified).

## Run it

```sh
node dev-server.ts --port 8080
# then open http://localhost:8080 in a desktop browser to play
# (opening game/index.html directly also works — no build step, no network)

mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
# builds the hand-in dossier into out/
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=ram1fzcx&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
