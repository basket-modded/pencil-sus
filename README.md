# PENCIL SUS ✏️

A social deduction game that takes place **on a page of a sketchbook**.

The ship is a 3D diorama drawn in graphite — hatched walls, blue graph-paper floors,
room names scrawled on the ground. The crewmates are flat, hand-drawn crayon doodles
that stand up in the middle of it. One of them holds the **eraser**.

- **2D players, 3D world** — every character is a procedurally drawn sprite billboard;
  the ship is real 3D geometry with a pencil-line render.
- **No art assets** — floors, walls, characters, bodies, icons, consoles and UI are all
  drawn at runtime on `<canvas>`. The whole game is code.
- **Real online play** — Cloudflare Worker + Durable Object per room code, WebSocket
  state replication at ~12 Hz, server-authoritative game logic.
- **Solo mode** — the same authoritative simulation also runs in the browser, so the
  page is fully playable (against doodle bots) even on a static host.

---

## Play

```bash
npm install
npm run dev          # http://localhost:5173
```

1. Pick a name and a crayon colour.
2. **CREATE ROOM** → share the 4-letter code (or the invite link) → **START SCRIBBLING**.
3. Alone? Hit **SOLO WITH DOODLE BOTS** or **+ DOODLE BOT** to fill the lobby.

### Controls

| action | key |
| --- | --- |
| move | `WASD` / arrows / on-screen stick |
| use (task, erase, report, vent, panel, breaker, button) | `E` or `SPACE` |
| ship map | `M` or `TAB` |
| sabotage menu (eraser only) | `Q` |

## The rules

- **Drawings (crew)** complete 5 tasks around the ship. Fill the bar at the top and the
  drawings win, or find the eraser and vote them out.
- **The eraser (impostor)** erases drawings (18 s cooldown), slips through **vents**,
  and can trigger **LIGHTS OUT** (two breakers) or a **REACTOR MELTDOWN** (two panels,
  40 s, impostors win if it is not stabilised).
- Found a body, or want to accuse someone? Slam the big red **EMERGENCY** button (or
  press `E` next to a body) to start a meeting. Everyone votes; the most votes gets
  crumpled up and thrown away.
- Dead? You become a paper ghost: fly through walls and watch the rest of the page.
- Impostors win at parity or by melting the reactor. Drawings win by tasks or ejections.

## Task minigames

Each task station opens a little hand-drawn toy: **wire panel** (drag matching wires),
**ID swipe** (slide the card, not too fast), **calibrate dials** (stop the needles in the
zone), **refuel** (hold the pump) and **trash chute** (drag the scraps in).

## Architecture

```
src/shared/map.ts        the ship: rooms, corridors, walkable grid, A*, stations, vents
src/shared/sim.ts        authoritative RoomSim — phases, roles, tasks, votes, bots
src/shared/protocol.ts   client <-> server wire types
src/shared/hostBridge.ts websocket ⇄ RoomSim bridge (Workers API + `ws` compatible)

worker/index.ts          Cloudflare Worker: static assets + /api/room/:code -> Durable Object
server/devroom.ts        the same rooms, hosted on Vite's http server for local dev

src/render/textures.ts   every pencil stroke, crayon fill and paper texture
src/render/world.ts      three.js scene: walls from the walkable grid, props, sprites, fx
src/game.ts              input, prediction, interaction, event effects
src/ui.ts                menu, lobby, HUD, meetings, verdicts, minimap
src/tasks.ts             the task minigames
src/net.ts               WsLink (real rooms) + LocalLink (offline, same sim in-page)
```

The simulation is pure TypeScript with no platform APIs, so **one** implementation runs
in the Durable Object, in the local dev server and in the browser (solo). Clients predict
their own movement, the server validates it (teleport rejection, wall checks, kill
distance, role checks) and broadcasts snapshots at ~12 Hz.

Doodle bots live inside the simulation: they path-find with A* over the walkable grid,
do tasks, report bodies, fix sabotage, hunt as impostors, vent, and vote.

## Deploying

The repo is set up for **Cloudflare Workers** with static assets (`wrangler.jsonc`):

```bash
npm run build
npx wrangler deploy        # or: npm run deploy
```

`worker/index.ts` serves `dist/` through the `ASSETS` binding and routes
`/api/room/<CODE>` to the `GameRoom` Durable Object (WebSocket). If your Cloudflare
project is instead a plain **Pages** static build, everything still works — the client
notices there is no room server and falls back to offline play with doodle bots.

## Notes

- No tracking, no accounts, no database: rooms are ephemeral Durable Objects.
- Everything is generated at runtime: the repo contains no images, fonts or audio.
- Sound is synthesised with WebAudio (pencil scratches, alarm bells, task chimes).
