/**
 * CLI entrypoint.
 *
 * Fetches (or synthesises) a contribution calendar, builds the occupancy grid,
 * runs the robot simulation once, and renders a light + dark animated SVG.
 *
 * Usage:
 *   tsx src/index.ts --user <login> [options]
 *   tsx src/index.ts --demo                 # offline, no token required
 *
 * Options:
 *   --user, --username <login>   GitHub login (or env GITHUB_USERNAME)
 *   --behavior <name>            escape | explore | wander | patrol | wall_follow
 *   --planner <name>             astar | dijkstra
 *   --beams <n>                  LIDAR beam count
 *   --range <n>                  LIDAR range in cells
 *   --duration <seconds>         animation loop length
 *   --seed <n>                   PRNG seed (defaults to day-of-year)
 *   --out <dir>                  output directory (default: dist)
 *   --demo                       use synthetic data instead of the GitHub API
 *
 * Token: reads GITHUB_TOKEN from the environment (the Actions default token
 * works). Not needed with --demo.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { DEFAULT_CONFIG, type BehaviorName, type PlannerName, type SimConfig } from './types.js';
import { fetchContributions, demoContributions } from './github/fetcher.js';
import { gridFromCalendar } from './grid/grid.js';
import { simulate } from './robot/simulator.js';
import { renderSvg } from './render/svg.js';
import { THEMES } from './render/themes.js';

// Registering planners is a side effect of importing them.
import './planning/astar.js';
import './planning/dijkstra.js';

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const name = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[name] = true;
    } else {
      args[name] = next;
      i++;
    }
  }
  return args;
}

const str = (v: string | boolean | undefined): string | undefined =>
  typeof v === 'string' ? v : undefined;

/** Day-of-year makes the seed roll over daily, so the run varies each day. */
function dayOfYearSeed(): number {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const diff = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - start;
  return Math.floor(diff / 86400000);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const demo = args.demo === true;
  const username =
    str(args.user) ?? str(args.username) ?? process.env.GITHUB_USERNAME ?? (demo ? 'octocat' : '');
  if (!username) {
    throw new Error('Provide --user <login> or set GITHUB_USERNAME (or use --demo).');
  }

  const config: SimConfig = {
    ...DEFAULT_CONFIG,
    username,
    behavior: (str(args.behavior) as BehaviorName) ?? DEFAULT_CONFIG.behavior,
    planner: (str(args.planner) as PlannerName) ?? DEFAULT_CONFIG.planner,
    lidar: {
      beamCount: args.beams ? Number(args.beams) : DEFAULT_CONFIG.lidar.beamCount,
      range: args.range ? Number(args.range) : DEFAULT_CONFIG.lidar.range,
    },
    motion: {
      ...DEFAULT_CONFIG.motion,
      durationSeconds: args.duration ? Number(args.duration) : DEFAULT_CONFIG.motion.durationSeconds,
    },
    seed: args.seed ? Number(args.seed) : dayOfYearSeed(),
  };

  console.log(`▸ behavior=${config.behavior} planner=${config.planner} seed=${config.seed}`);

  const weeks = demo
    ? demoContributions(config.seed)
    : await fetchContributions(username, requireToken());

  const grid = gridFromCalendar(weeks);
  const sim = simulate(grid, config);
  console.log(
    `▸ grid ${grid.width}×${grid.height}, route ${sim.route.length} pts, expanded ${sim.visitedOrder.length} nodes`,
  );

  const outDir = resolve(str(args.out) ?? 'dist');
  await mkdir(outDir, { recursive: true });

  for (const theme of [THEMES.dark, THEMES.light]) {
    const svg = renderSvg(sim, config, theme);
    const file = resolve(outDir, `robot-${theme.name}.svg`);
    await writeFile(file, svg, 'utf8');
    console.log(`▸ wrote ${file} (${(svg.length / 1024).toFixed(1)} KiB)`);
  }
}

function requireToken(): string {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN is required (or use --demo for offline generation).');
  }
  return token;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
