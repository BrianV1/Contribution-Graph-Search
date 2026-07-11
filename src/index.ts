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
 * Configuration is layered — later sources override earlier ones:
 *   built-in defaults  <  robot.config.json  <  CLI flags / env
 *
 * Options:
 *   --config <path>              config file (default: robot.config.json if present)
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

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

/** Shape of the optional `robot.config.json`. Every field is optional. */
interface FileConfig {
  username?: string;
  behavior?: BehaviorName;
  planner?: PlannerName;
  lidar?: { beamCount?: number; range?: number };
  motion?: { durationSeconds?: number; lidarSamples?: number; allowDiagonal?: boolean };
  seed?: number;
}

/**
 * Load a config file. Defaults to `robot.config.json` at the repo root; a
 * missing default file is fine (returns `{}`), but an explicitly-passed
 * `--config` path that doesn't exist (or is invalid JSON) is an error.
 */
async function loadConfigFile(path: string | undefined): Promise<FileConfig> {
  const resolved = resolve(path ?? 'robot.config.json');
  if (!existsSync(resolved)) {
    if (path) throw new Error(`Config file not found: ${resolved}`);
    return {};
  }
  try {
    const parsed = JSON.parse(await readFile(resolved, 'utf8')) as FileConfig;
    console.log(`▸ loaded config ${resolved}`);
    return parsed;
  } catch (e) {
    throw new Error(`Invalid config file ${resolved}: ${e instanceof Error ? e.message : e}`);
  }
}

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

  // Configuration is layered, later sources win:
  //   DEFAULT_CONFIG  <  robot.config.json  <  CLI flags / env
  const file = await loadConfigFile(str(args.config));

  const username =
    str(args.user) ??
    str(args.username) ??
    process.env.GITHUB_USERNAME ??
    file.username ??
    (demo ? 'octocat' : '');
  if (!username) {
    throw new Error('Provide --user <login>, set GITHUB_USERNAME, add "username" to robot.config.json, or use --demo.');
  }

  const config: SimConfig = {
    username,
    behavior: (str(args.behavior) as BehaviorName) ?? file.behavior ?? DEFAULT_CONFIG.behavior,
    planner: (str(args.planner) as PlannerName) ?? file.planner ?? DEFAULT_CONFIG.planner,
    lidar: {
      beamCount: args.beams ? Number(args.beams) : file.lidar?.beamCount ?? DEFAULT_CONFIG.lidar.beamCount,
      range: args.range ? Number(args.range) : file.lidar?.range ?? DEFAULT_CONFIG.lidar.range,
    },
    motion: {
      durationSeconds:
        args.duration ? Number(args.duration) : file.motion?.durationSeconds ?? DEFAULT_CONFIG.motion.durationSeconds,
      lidarSamples: file.motion?.lidarSamples ?? DEFAULT_CONFIG.motion.lidarSamples,
      allowDiagonal: file.motion?.allowDiagonal ?? DEFAULT_CONFIG.motion.allowDiagonal,
    },
    seed: args.seed ? Number(args.seed) : file.seed ?? dayOfYearSeed(),
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
