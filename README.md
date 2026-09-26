# PetroCraft

**Build an oil & gas empire in a procedurally generated block world.**

PetroCraft is a browser-based, Minecraft-style industrial simulation. Explore a voxel world with real subsurface
geology — folded strata, faults, salt domes, aquifers, and hidden oil & gas reservoirs. Shoot seismic, lease
acreage, drill vertical and horizontal wells while managing mud weight and casing, complete and frac them, then
build pipelines, tank farms, gas plants, refineries and petrochemical complexes. Trade on volatile commodity
markets, fulfil contracts, hire crews, research new technology, survive fires and blowouts, and take your
company offshore.

## Features

- **Procedural voxel world** — biomes, rivers, lakes, mountains and a continental shelf dropping into deep ocean,
  generated lazily in 16×16×160 chunks, meshed in Web Workers with ambient occlusion, sky-light and emissive lamps.
- **Real subsurface geology** — folded strata, sealing faults, salt domes, caprock, fresh & brine aquifers,
  overpressured shales and 10–40 reservoirs per map (anticlines, fault traps, reefs, pinch-outs, shale plays) whose
  rock is physically present in the world when you dig.
- **Exploration** — synthetic 2D/3D seismic (reflectivity ⊛ Ricker wavelet), AVO fluid indicators, wireline logs,
  a hand-held geo-scanner, and an **X-ray view** that reveals discovered reservoirs and well paths underground.
- **Drilling** — vertical, directional and horizontal wells with casing programs, a mud-weight window between pore and
  fracture pressure, bit wear & trips, kicks, well-control methods, blowouts (with fires), capping and relief wells.
- **Production** — material-balance reservoirs with water drive, gas caps and bubble points; Vogel IPRs, choke,
  pumpjacks, ESPs and gas lift; fracking; water/gas/CO₂ injection; decline curves you can watch.
- **Midstream & downstream** — pipelines you drag across the landscape, pumps, compressors, tank farms, gas plants,
  refineries, FCC, LNG, steam crackers, polymer and ammonia plants, power generation (gas, diesel, solar, wind), CCS.
- **Economy** — correlated commodity markets with events, terminals (truck, rail, marine), contracts, leases &
  royalties, loans, workforce with skills and morale, a 55-node research tree, objectives and achievements.
- **Hazards & environment** — equipment wear and failures, spreading fires and explosions, pipeline leaks and spills,
  weather with storms, lightning, blizzards and hurricanes, emissions, flaring, fines and regulator suspensions.
- **Offshore** — jack-ups, semi-submersibles, fixed platforms and FPSOs on the continental shelf.
- **Presentation** — day/night sky, volumetric-style clouds, animated water, shadows, bloom, 46 animated building
  models, GPU particles, vehicles and workers, fully procedural audio & generative music, and a polished glass UI
  with charts, well planner, seismic viewer, and a drone camera for managing your empire.
- **Save/load** — IndexedDB slots with thumbnails, autosave, export/import.

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
| Pause menu / close panel | `Esc` |

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In short: a JSON-serializable `GameState`, a command bus through which
all player intent flows (multiplayer-ready), fixed-step simulation systems (upstream, facilities, economy), and a
three.js presentation layer (chunked voxel renderer with worker meshing, entity models & FX, procedural audio, DOM UI).
