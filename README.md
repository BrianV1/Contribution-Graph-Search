# Contribution-Graph Search 🤖

A robotics-themed animation for your GitHub profile. Instead of the usual snake,
your contribution graph becomes a **2D occupancy grid** that a LIDAR-equipped
robot navigates with real path-planning:

- 🟩 **Green contribution squares are obstacles.**
- ⬛ **Empty days are free space.**
- The robot spawns on the **left** and, by default, uses **A\*** to find the
  **farthest reachable cell on the right edge** — then drives there while a
  simulated **2D LIDAR** sweeps the environment.

Everything renders to a **self-contained animated SVG** (SMIL only, no
JavaScript) so it embeds directly in your README, in both light and dark themes.

<!-- Point these at your own `output` branch once the Action has run once. -->
<picture>
  <source media="(prefers-color-scheme: dark)"  srcset="https://raw.githubusercontent.com/OWNER/REPO/output/robot-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/OWNER/REPO/output/robot-light.svg">
  <img alt="A LIDAR robot pathfinding across a GitHub contribution graph" src="https://raw.githubusercontent.com/OWNER/REPO/output/robot-dark.svg" width="100%">
</picture>

---

## How it works

```
GitHub GraphQL ─▶ Grid ─▶ Behavior ─▶ Planner (A*) ─▶ Simulator ─▶ SVG renderer
   fetcher       (obstacles)  (mission)   (optimal path)  (route+LIDAR)  (SMIL animation)
```

The animation is a single infinite loop. Its timeline:

| Phase        | Loop fraction | What you see                                             |
| ------------ | ------------- | -------------------------------------------------------- |
| **Search**   | 0.00 – 0.24   | A\* expands; explored cells (the closed set) fade in     |
| **Plan**     | 0.25 – 0.37   | the optimal path draws on                                |
| **Drive**    | 0.40 – 0.92   | the robot follows the path; LIDAR scans every frame      |
| **Dwell**    | 0.92 – 1.00   | pause at the goal, then the loop resets                  |

The LIDAR polygon is a **real ray-cast** of the free region from the robot's
current position at every animation frame (DDA grid traversal), morphed with
SMIL so the scan stays faithful to the map as the robot moves.

## Behaviors

Selected with `--behavior` (or the workflow input). Configured through a single
[`SimConfig`](src/types.ts) object.

| Behavior      | Description                                                             |
| ------------- | --------------------------------------------------------------------- |
| `escape`      | Reach the farthest reachable point on the right edge. *(default)*      |
| `explore`     | Coverage tour of the reachable region (farthest-point sampling).      |
| `wander`      | Random autonomous exploration between reachable goals.                |
| `patrol`      | Continuously loop the perimeter corners of the free region.           |
| `wall_follow` | Reactive navigation using the left-hand-rule wall follower (no planner). |

Deliberative behaviors (`escape`, `explore`, `wander`, `patrol`) **replan
automatically at every waypoint** — you see a fresh search + path each leg.

## Project layout

Every stage is an independent, documented module:

```
src/
├── github/fetcher.ts     GitHub GraphQL contribution fetcher (+ offline demo data)
├── grid/grid.ts          Occupancy-grid generator from the calendar
├── planning/
│   ├── planner.ts        Planner interface + registry + movement model
│   ├── astar.ts          A* (octile heuristic, optimal)
│   ├── dijkstra.ts       Dijkstra (shows how to add algorithms)
│   └── heap.ts           Binary min-heap priority queue
├── sensors/lidar.ts      Configurable 2D LIDAR via DDA ray casting
├── robot/
│   ├── behaviors.ts      escape / explore / wander / patrol / wall_follow
│   └── simulator.ts      Composes behavior + planner into a route
├── render/
│   ├── svg.ts            Self-contained SMIL SVG renderer
│   └── themes.ts         Light + dark palettes
├── types.ts              Shared types, config, math, deterministic RNG
└── index.ts              CLI entrypoint
```

## Extending it

The planner is a registry, so adding **Dijkstra, RRT, D\* Lite, Theta\***, … is
a self-contained file:

```ts
import { Planner, PlanResult, registerPlanner } from './planning/planner.js';

export class RRTPlanner implements Planner {
  readonly name = 'rrt';
  plan(grid, start, goal, options): PlanResult {
    // ...return { path, visitedOrder }
  }
}

registerPlanner('rrt', () => new RRTPlanner());
```

Import it once (for its registration side effect) in `src/index.ts` and it's
available via `--planner rrt`. The renderer visualises `visitedOrder`
automatically. See [`dijkstra.ts`](src/planning/dijkstra.ts) for a worked
example.

New **behaviors** slot into [`behaviors.ts`](src/robot/behaviors.ts); new
**sensors** or **themes** are equally isolated.

## Local development

Requires Node ≥ 20.

```bash
npm install
npm run demo            # generate light+dark SVGs from synthetic data → dist/
npm run typecheck       # strict TypeScript, no emit
```

Try the behaviors offline (no token, no network):

```bash
npx tsx src/index.ts --demo --behavior explore
npx tsx src/index.ts --demo --behavior wall_follow
npx tsx src/index.ts --demo --planner dijkstra --beams 60 --range 6
```

Against a real account:

```bash
GITHUB_TOKEN=<token-with-read:user> \
  npx tsx src/index.ts --user your-login --behavior escape
```

### CLI options

| Flag                     | Default          | Notes                                   |
| ------------------------ | ---------------- | --------------------------------------- |
| `--user`, `--username`   | `$GITHUB_USERNAME` | GitHub login                          |
| `--behavior`             | `escape`         | see table above                         |
| `--planner`              | `astar`          | `astar` \| `dijkstra`                   |
| `--beams`                | `40`             | LIDAR beams per 360° scan               |
| `--range`                | `5.5`            | LIDAR range in cells                    |
| `--duration`             | `14`             | animation loop length (seconds)         |
| `--seed`                 | day-of-year      | deterministic PRNG seed                 |
| `--out`                  | `dist`           | output directory                        |
| `--demo`                 | —                | use synthetic data instead of the API   |

## Automated daily updates

[`.github/workflows/generate.yml`](.github/workflows/generate.yml) runs daily
(and on manual dispatch), regenerates both themes with the built-in
`GITHUB_TOKEN`, and force-pushes `robot-dark.svg` / `robot-light.svg` to an
`output` branch. Your README's `<picture>` block points at that branch's raw
URLs, so your profile stays fresh without touching `main`'s history.

To use it on your own profile:

1. Fork/copy this repo (a repo named after your username works well for a
   profile README).
2. Enable Actions, then **Run workflow** once (Actions tab) to seed the
   `output` branch.
3. Replace `OWNER/REPO` in the `<picture>` block above with your own.

## License

MIT
