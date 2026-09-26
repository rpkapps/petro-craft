# PetroCraft

**Build an oil & gas empire in a procedurally generated block world.**

PetroCraft is a browser-based, Minecraft-style industrial simulation. Explore a voxel world with real subsurface
geology — folded strata, faults, salt domes, aquifers, and hidden oil & gas reservoirs. Shoot seismic, lease
acreage, drill vertical and horizontal wells while managing mud weight and casing, complete and frac them, then
build pipelines, tank farms, gas plants, refineries and petrochemical complexes. Trade on volatile commodity
markets, fulfil contracts, hire crews, research new technology, survive fires and blowouts, and take your
company offshore.

## Quick start

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # typecheck + production build to dist/
```

## Controls (default)

| Action | Key |
| --- | --- |
| Move / jump / sneak / sprint | `W A S D` / `Space` / `Shift` / `Ctrl` |
| Break / place / use | `LMB` / `RMB` |
| Hotbar | `1`–`9`, mouse wheel |
| Fly / drone camera | `G` / `V` |
| X-ray subsurface view | `X` |
| Build menu / rotate | `B` / `R` |
| Inventory & shop | `E` |
| Research · Market · Map · Wells | `T` · `M` · `N` · `J` |
| Workforce · Contracts · Finance · Objectives | `H` · `K` · `F` · `O` |
| Game speed | `,` `.` and `` ` `` (pause) |
| Quick save / load | `F5` / `F9` |
| Help | `F1` |

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In short: a JSON-serializable `GameState`, a command bus through which
all player intent flows (multiplayer-ready), fixed-step simulation systems (upstream, facilities, economy), and a
three.js presentation layer (chunked voxel renderer with worker meshing, entity models & FX, procedural audio, DOM UI).
