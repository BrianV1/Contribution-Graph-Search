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

<!-- Replace <OWNER>/<REPO> with your fork, e.g. octocat/Contribution-Graph-Search -->
<picture>
  <source media="(prefers-color-scheme: dark)"  srcset="https://raw.githubusercontent.com/<OWNER>/<REPO>/output/robot-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/<OWNER>/<REPO>/output/robot-light.svg">
  <img alt="A LIDAR robot pathfinding across a GitHub contribution graph" src="https://raw.githubusercontent.com/<OWNER>/<REPO>/output/robot-dark.svg" width="100%">
</picture>

---

## Use it on your own profile

This repo is a **template** — it automatically visualises whoever owns the fork,
because the workflow reads `github.repository_owner`. You never edit any code.

1. **Get your own copy.** Click **Use this template ▸ Create a new repository**
   (or fork). Any repo name works; a repo named exactly after your username is a
   [special profile repo](https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-github-profile/customizing-your-profile/managing-your-profile-readme).
2. **Allow the workflow to publish.** In your new repo: **Settings ▸ Actions ▸
   General ▸ Workflow permissions ▸ Read and write permissions ▸ Save.**
3. **Run it once.** **Actions** tab ▸ enable workflows ▸
   *Generate contribution-graph animation* ▸ **Run workflow**. This creates an
   `output` branch containing `robot-dark.svg` and `robot-light.svg`. After
   that it self-updates daily.
4. **Embed it** in your profile `README.md` (the one in `<username>/<username>`)
   with the `<picture>` block above, replacing `<OWNER>/<REPO>` with the repo you
   just created — for example
   `https://raw.githubusercontent.com/octocat/Contribution-Graph-Search/output/robot-dark.svg`.

That's it. No token to create (the built-in `GITHUB_TOKEN` covers your own
public graph), nothing to run locally.

### Customize (optional)

Edit [`robot.config.json`](robot.config.json) and commit — the workflow
regenerates on push. No code changes:

```jsonc
{
  "behavior": "escape",     // escape | explore | wander | patrol | wall_follow
  "planner": "astar",       // astar | dijkstra
  "lidar":  { "beamCount": 40, "range": 5.5 },
  "motion": { "durationSeconds": 14, "lidarSamples": 44, "allowDiagonal": true }
}
```

The bundled JSON schema gives you autocomplete and validation in most editors.
You can also override `behavior`/`planner` for a single run from the
**Run workflow** dialog.

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

Set `behavior` in [`robot.config.json`](robot.config.json) (or `--behavior` on
the CLI). Everything is driven by one [`SimConfig`](src/types.ts) object.

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

`npm run demo` needs no token or network — it uses built-in synthetic data.
Try the behaviors (flags override `robot.config.json`):

```bash
npx tsx src/index.ts --demo --behavior explore
npx tsx src/index.ts --demo --behavior wall_follow
npx tsx src/index.ts --demo --planner dijkstra --beams 60 --range 6
```

Against a real account:

```bash
GITHUB_TOKEN=<token-with-read:user> \
  npx tsx src/index.ts --user your-login
```

### CLI options

Config resolves in layers, later wins: **defaults → `robot.config.json` → CLI flags**.

| Flag                     | Default            | Notes                                          |
| ------------------------ | ------------------ | ---------------------------------------------- |
| `--config`               | `robot.config.json`| path to a JSON config file                     |
| `--user`, `--username`   | `$GITHUB_USERNAME` | GitHub login                                   |
| `--behavior`             | `escape`           | see table above                                |
| `--planner`              | `astar`            | `astar` \| `dijkstra`                          |
| `--beams`                | `40`               | LIDAR beams per 360° scan                      |
| `--range`                | `5.5`              | LIDAR range in cells                           |
| `--duration`             | `14`               | animation loop length (seconds)                |
| `--seed`                 | day-of-year        | deterministic PRNG seed                        |
| `--out`                  | `dist`             | output directory                               |
| `--demo`                 | —                  | use synthetic data instead of the API          |

## How the automation works

[`.github/workflows/generate.yml`](.github/workflows/generate.yml) runs daily
(and on manual dispatch, and on pushes that touch `src/` or `robot.config.json`).
It regenerates both themes for the repo owner's graph using the built-in
`GITHUB_TOKEN`, then force-pushes `robot-dark.svg` / `robot-light.svg` to an
orphan `output` branch — so your default branch history stays clean and your
README always points at a stable, always-fresh URL.

Because the username comes from `github.repository_owner`, the same code works
unchanged for every fork. See [**Use it on your own profile**](#use-it-on-your-own-profile) above.

> Maintainer tip: enable **Settings ▸ Template repository** so others get a
> clean **Use this template** button instead of a fork tied to your history.

## License

MIT
