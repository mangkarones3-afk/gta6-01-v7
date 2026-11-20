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

Fifteen story missions — *Steal the Caspián* ($850), *Hot Cargo* ($1,200),
*The Cielo Shakedown* ($1,550), *Paper Trail* ($2,100), *High Tide Heist*
($3,200), *The Night Deposit* ($3,400), *Beach Money* ($3,750), *Prisma After
Dark* ($4,100), *The Contador's Ride* ($4,500), *Aurora Matinee* ($4,900),
*Mercado Muscle* ($5,300), *Faro Run* ($5,800), *Prisma Papers* ($6,300),
*Last Van Standing* ($6,900) and *Solano Bay Is Yours* ($8,000) — plus
repeatable Courier Run (pays $120 + $0.22 per metre) and Repo Job ($265) side
work, four street races (Faro Sprint, Mercado Loop, Puerto Run, Prisma Dash —
best times saved), eight stunt jumps, twelve hidden caracolas (+$120 each),
a three-person crew (Valeria Ríos, Fixer · Marco Delgado, Taller Delgado ·
Tomás Ibarra, El Contador), a career percentage computed from the save
(story, jobs, races, stunts, caracolas), manual camera zoom (mouse wheel and
+/− keys; 48 m default view, 21.0 m closest, 78.7 m widest), a live minimap
HUD (cash, health, weapon, speedometer, wanted stars) and a save/continue
system.

The game is plain JavaScript under `game/src/`, one module per job — `random`,
`city`, `audio`, `input`, `vehicles`, `pedestrians`, `wanted`, `combat`,
`save`, `minimap`, `missions`, `activities`, `render` — driven by
`solano-bay-game.js`.
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
