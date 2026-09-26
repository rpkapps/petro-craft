# PetroCraft — Architecture & Cross-Module Contracts

PetroCraft is a browser voxel oil & gas industrial simulation. Stack: **Vite + TypeScript (strict) + three.js 0.186**,
package manager **pnpm**. No other runtime deps besides `simplex-noise` and `fflate`. All art and audio are procedural
(no binary assets).

```
src/
  core/        engine-agnostic contracts & loop (types.ts, blocks.ts, commands.ts, EventBus.ts, Game.ts, App.ts, state.ts,
               buildingUtil.ts, client.ts, constants.ts, rng.ts, settings.ts)
  content/     data catalogs: buildings.ts, items.ts, tech.ts (+ recipes.ts owned by facilities)
  world/       terrain + geology generation, chunk storage          (entry: world/index.ts)
  render/      three.js renderer, chunk meshing, sky, water, post   (entry: render/index.ts)
  render/entities/  building models, animation, particles/FX, vehicles, NPCs (entry: render/entities/index.ts)
  player/      first-person/drone controller, interaction, build/pipe modes (entry: player/index.ts, player/sim.ts)
  audio/       procedural WebAudio SFX, ambience, music             (entry: audio/index.ts)
  sim/upstream/    exploration, seismic, drilling, wells, reservoirs, production
  sim/facilities/  construction, pipe networks, processing, storage, power, logistics, maintenance, fires, spills
  sim/economy/     markets, sales, contracts, workforce, research, finance, leases, weather, environment, objectives
  ui/          all DOM UI: menus, HUD, panels, charts                (entry: ui/index.ts)
  save/        IndexedDB save slots (gzip JSON)
  net/         Transport abstraction for future multiplayer
```

## Principles
* **GameState** (`core/types.ts`) is plain JSON — the only persistent sim state. No class instances, Maps, or typed arrays in it.
* **Commands** (`core/commands.ts`) are the only way player intent mutates state. UI/player code calls
  `ctx.commands.dispatch({type, ...})`. Systems register handlers in `init()`. This makes multiplayer (authoritative host)
  possible. Handlers return `{ok, error?}`; the bus emits `ui:error` automatically on failure.
* **Events** (`core/EventBus.ts`) are fire-and-forget notifications (sim → render/audio/UI).
* **Systems** (`SimSystem`) run on a fixed 100 ms step. `step.minutes` = game minutes advanced (already × speed).
  1 game day = 10 real minutes at 1×. Speeds 1/2/5/10/25×. Systems must handle large steps (25× → 6 game minutes per step).
  Randomness in sim code: **only `ctx.rng()`** (deterministic). Presentation code may use `Math.random()`.
* **Services** (`ctx.services`) are query APIs installed by systems in `init()` (replace the default no-op objects):
  `seismic` & `wells` → upstream; `construction` & `networks` → facilities; `economy` → economy.
* `ctx.transact(amount, category, note, requireFunds)` for all money. `ctx.notify(level, title, text, at)` for player-facing messages.
* `ctx.hasTech(id)`, `ctx.modifier(key)` for research effects.

## Scale & units
* World: square `WORLD_SIZES[size]` blocks (256/512/768), height 160, sea level 62. Chunks are 16×16 full-height columns.
  Chunk data index = `x + z*16 + y*256` (local coords).
* Engineering scale: **1 block = 40 m** (depths, lateral lengths, pipeline lengths). Display depth = (surfaceY − y) × 40 m.
* Oil/water in **bbl**, gas in **mcf**, chemicals in **t**. Rates are per game day. Money in USD.

## Buildings
* Catalogue in `content/buildings.ts` (ids are contracts). Origin (x,y,z) = min corner, y = first level above the pad.
  `size` is post-rotation [w,d,h].
* Placement (facilities) levels the ground: pad blocks (CONCRETE_PAD or GRAVEL_PAD) at y−1 under the footprint, fills
  below with dirt, clears terrain above. Then `writeStructure()` fills the volume with invisible, solid `B.STRUCTURE`
  blocks (player collision, raycast hits). The 3D model is rendered by the entity layer. Offshore (`placement: 'water'`)
  buildings sit with origin y = SEA_LEVEL + 1; their legs are purely visual.
* Use `core/buildingUtil.ts`: `createBuildingState`, `addBuilding`, `removeBuilding`, `findBuildingAt` (smallest
  building containing a block — lets a wellhead inside a rig footprint be picked), `crewFactor`, `isOperational`.
* **Status ownership:** facilities sets generic statuses for every building (`constructing`, `disabled`, `broken`,
  `fire`, `destroyed`, `unstaffed`, `no_power`). For `UPSTREAM_TYPES` (rigs, frac spread, wellhead) the upstream system sets
  `active`/`idle` when the building is otherwise operational; facilities must not overwrite those two for upstream types.
* Building opex (def.opex, daily) is charged by facilities for **all** buildings. Wages by economy.

## Wells & production flow
* A rig (`drilling_rig_*`, `jackup_rig`, `semi_sub_rig`) drills one well at a time; the well's surface location is the rig
  footprint centre. Drilling writes `B.CASING` blocks along the drilled trajectory (world.setBlock generates chunks on demand).
* On completion upstream spawns a `wellhead` building (3×3) centred on the well with `wellId`, `data.underRig = rigId`
  while the rig still stands there. Rigs are moved with `rig/skid` (upstream) or demolished.
* Upstream computes well rates and deposits **produced fluids into the wellhead's `storage`**
  (`crude_oil` or `condensate`, `natural_gas`, `produced_water`), never exceeding def storage capacity (back-pressure
  throttles production). Offshore wells deliver directly into the storage of the nearest operational
  `production_platform` (≤24 blocks) or `fpso` (≤40 blocks); without one they cannot produce.
* Facilities moves fluids out of building storage through **pipe networks**:
  pipe blocks `PIPE_OIL|PIPE_GAS|PIPE_WATER|PIPE_PRODUCT` connect 6-way to same-type pipe blocks and to any building
  whose footprint is adjacent and whose def `ports` include that category. Each network carries only items of its
  category (`ITEMS[id].category`). Excess wellhead gas with no gas outlet is flared at the wellhead if
  `config.flareExcessGas !== false` (counts toward `environment.flaredToday` & emissions) else vented (`ventedToday`).
* Injector wells (`purpose` injector_*) consume water/gas from the wellhead storage which facilities fills from connected
  water/gas networks.
* **Terminals** (`truck_terminal`, `rail_terminal`, `export_terminal`, `gas_sales_meter`, and `fpso` for crude) are filled by
  facilities; the **economy** sells from terminal storage (auto-sell rules, contracts, daily capacity) and via `market/sell`.
  Daily capacities: truck 3,000 bbl, rail 25,000 bbl, export 150,000 bbl (+ LNG), gas meter 60,000 mcf, fpso offload 80,000 bbl.
* Recipes for processing plants live in `content/recipes.ts` (facilities).

## Hazards
* `state.hazards.fires` is the single list of fires (buildings, wells, grass). Facilities runs spread/damage/extinguish
  for all fires. Upstream creates fires for burning blowouts (with `wellId`) and handles capping. Economy's weather may
  create fires via lightning. Everyone emits `hazard:*` events for FX/audio.
* Spills: facilities writes `B.OIL_POOL` blocks and `environment.spills`. Economy scores the environment daily from the
  counters (`emissionsToday`, `flaredToday`, `ventedToday`, spills) and issues fines/violations.

## Client / presentation
* `RenderHost` (`core/client.ts`) is implemented by the renderer; entity layer, player and audio receive it.
* Input split: **player** module handles movement, mouse look, hotbar (1–9, wheel), block break/place, tools,
  `X` x-ray overlay (sets `host.overlay` and emits `ui:overlay`), `V` drone camera, `G` fly, `R` rotate in build mode,
  `Q` / `Ctrl+Q` drop one item / the stack (auto-pickup by walking over drops),
  build-mode ghost & placement (listens to `ui:buildMode`), pipe line mode (listens to `ui:pipeMode`), picking
  (emits `ui:select`, `player:target`). **UI** handles panel hotkeys (E, B, T, M, N, J, H, K, F, O, Esc, F1, F3, F5, F9,
  speed keys) and menus. When `app.uiCapturing` is true the player controller ignores gameplay input.
  Keybinds are in `settings.keybinds` (`core/settings.ts`).
* Pointer lock: the player requests it on canvas click when not capturing and not in drone mode. The UI shows the pause
  menu when pointer lock is lost while nothing else is open (and not in drone mode).
* Visual quality bar: this should look and feel like a premium, polished game — cohesive art direction
  (warm industrial palette with orange accent `#ff8a1f`), smooth animations, no placeholder art.

## Conventions
* **Rotation:** building rotation `r` turns clockwise seen from above; models use `rotation.y = -r·π/2`.
* **Player view:** `yaw = 0` looks along −Z (three.js 'YXZ' order), forward = (−sin yaw, 0, −cos yaw); `pitch > 0` looks up.
  Compass north is −Z. The player position is the feet.
* **Per-module extra state** lives in plain-JSON escape hatches: `well.up` / `reservoirState.up` (upstream),
  `state.economy` (economy), `building.data` (any system; documented keys in each module).
* `build/place` carries the building id in `buildingType` (not `type`, which is the command discriminator).

## Testing
| What | Command |
| --- | --- |
| Typecheck + production build | `pnpm build` |
| Upstream sim (97 checks) | `node --experimental-transform-types --no-warnings --import ./dev/upstream/register.mjs dev/upstream/sim.test.ts` |
| Facilities sim (139 checks) | `node --experimental-transform-types --no-warnings --import ./dev/facilities/register.mjs dev/facilities/sim.test.ts` |
| Economy sim (365-day run / edge cases) | `node --experimental-transform-types --no-warnings --import ./dev/economy/register.mjs dev/economy/sim.ts` (or `edge.ts`) |
| World generation | `node --experimental-strip-types --import ./dev/world/register.mjs dev/world/test.ts [seed] [size]` |
| Player logic (unit) | `node --experimental-strip-types --no-warnings --import ./dev/player/register.mjs --test dev/player/unit.test.mjs` |
| End-to-end gameplay (real game in headless Chromium) | `pnpm dev --port 5190` then `node scripts/scenario.mjs` (`SOAK=60` for a long run), `node scripts/interact.mjs`, `node scripts/play.mjs` |

Each module also has a visual dev harness under `dev/<module>/` (open `http://localhost:5173/dev/<module>/` with `pnpm dev`).

## Multiplayer readiness
All mutations are serializable commands tagged with `playerId`; state is JSON; RNG is in-state. `net/Transport.ts` defines
the host/client message protocol. Buildings/wells carry `owner`.
