/**
 * Robot behaviors.
 *
 * A behavior turns the static grid into a *mission*: either a list of
 * waypoints (the simulator plans an optimal path between each consecutive pair
 * and replans automatically at every waypoint) or an explicit route (for
 * reactive behaviors like wall following that do not use a global planner).
 *
 * Behaviors are pure functions of `(grid, rng)` so a fixed seed yields a fixed
 * mission — important for deterministic daily regeneration.
 */

import type { BehaviorName, Cell } from '../types.js';
import { Grid } from '../grid/grid.js';
import { key } from '../planning/planner.js';

export interface BehaviorResult {
  /** Where the robot spawns. */
  start: Cell;
  /**
   * Ordered mission waypoints (including `start`). The simulator runs the
   * planner between each consecutive pair, so a new plan is produced — and
   * visualised — at every waypoint. Ignored if `route` is set.
   */
  waypoints?: Cell[];
  /** An explicit cell-by-cell route, used by reactive behaviors (wall_follow). */
  route?: Cell[];
  /** Human-readable mission description for the HUD. */
  label: string;
}

type Rng = () => number;

// ---------------------------------------------------------------------------
// Shared spatial queries
// ---------------------------------------------------------------------------

const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0], // E
  [0, 1], // S
  [-1, 0], // W
  [0, -1], // N
];

/** BFS flood fill: every free cell reachable from `start` (8-connected). */
function reachable(grid: Grid, start: Cell): Cell[] {
  const seen = new Set<number>([key(start)]);
  const queue: Cell[] = [start];
  const out: Cell[] = [];
  const dirs: ReadonlyArray<readonly [number, number]> = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  while (queue.length) {
    const c = queue.shift()!;
    out.push(c);
    for (const [dc, dr] of dirs) {
      const col = c.col + dc;
      const row = c.row + dr;
      if (!grid.isFree(col, row)) continue;
      // Forbid diagonal corner cutting to match the planner's movement model.
      if (dc !== 0 && dr !== 0 && (!grid.isFree(c.col + dc, c.row) || !grid.isFree(c.col, c.row + dr))) {
        continue;
      }
      const k = key({ col, row });
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ col, row });
    }
  }
  return out;
}

/** The spawn point: the leftmost free column, nearest the vertical centre. */
function spawnPoint(grid: Grid): Cell {
  const mid = (grid.height - 1) / 2;
  for (let col = 0; col < grid.width; col++) {
    let best: Cell | null = null;
    let bestDist = Infinity;
    for (let row = 0; row < grid.height; row++) {
      if (grid.isFree(col, row)) {
        const d = Math.abs(row - mid);
        if (d < bestDist) {
          bestDist = d;
          best = { col, row };
        }
      }
    }
    if (best) return best;
  }
  // Degenerate: no free cell at all. Return top-left so callers stay defined.
  return { col: 0, row: 0 };
}

const cellDist = (a: Cell, b: Cell): number => Math.hypot(a.col - b.col, a.row - b.row);

// ---------------------------------------------------------------------------
// Individual behaviors
// ---------------------------------------------------------------------------

/** ESCAPE — reach the farthest reachable cell on the right edge. */
function escape(grid: Grid): BehaviorResult {
  const start = spawnPoint(grid);
  const cells = reachable(grid, start);
  // Farthest right; break ties by staying near the spawn row for a natural run.
  let goal = start;
  let bestCol = -1;
  let bestRowDelta = Infinity;
  for (const c of cells) {
    if (c.col > bestCol || (c.col === bestCol && Math.abs(c.row - start.row) < bestRowDelta)) {
      bestCol = c.col;
      bestRowDelta = Math.abs(c.row - start.row);
      goal = c;
    }
  }
  return { start, waypoints: [start, goal], label: 'ESCAPE // reach farthest east cell' };
}

/**
 * EXPLORE — visit spread-out targets covering the whole reachable region.
 * We greedily pick the reachable cell farthest from everything chosen so far
 * (farthest-point sampling), then order the tour by nearest-neighbour.
 */
function explore(grid: Grid): BehaviorResult {
  const start = spawnPoint(grid);
  const cells = reachable(grid, start);
  const targetCount = Math.min(14, cells.length);

  const chosen: Cell[] = [start];
  while (chosen.length < targetCount) {
    let far: Cell | null = null;
    let farDist = -1;
    for (const c of cells) {
      let nearest = Infinity;
      for (const s of chosen) nearest = Math.min(nearest, cellDist(c, s));
      if (nearest > farDist) {
        farDist = nearest;
        far = c;
      }
    }
    if (!far || farDist <= 0) break;
    chosen.push(far);
  }

  // Order the visit as a nearest-neighbour tour starting at spawn.
  const tour: Cell[] = [start];
  const remaining = chosen.slice(1);
  let cur = start;
  while (remaining.length) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = cellDist(cur, remaining[i]!);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    cur = remaining.splice(bi, 1)[0]!;
    tour.push(cur);
  }
  return { start, waypoints: tour, label: 'EXPLORE // coverage tour' };
}

/** WANDER — random autonomous exploration: a chain of random reachable goals. */
function wander(grid: Grid, rng: Rng): BehaviorResult {
  const start = spawnPoint(grid);
  const cells = reachable(grid, start);
  const hops = Math.min(10, cells.length);
  const waypoints: Cell[] = [start];
  let cur = start;
  for (let i = 0; i < hops; i++) {
    // Prefer somewhat-distant goals so each leg is visibly a new plan.
    let pick = cur;
    for (let tries = 0; tries < 8; tries++) {
      const cand = cells[Math.floor(rng() * cells.length)]!;
      if (cellDist(cand, cur) > 4) {
        pick = cand;
        break;
      }
      pick = cand;
    }
    waypoints.push(pick);
    cur = pick;
  }
  return { start, waypoints, label: 'WANDER // random walk' };
}

/** PATROL — continuously loop between the extreme corners of the free region. */
function patrol(grid: Grid): BehaviorResult {
  const start = spawnPoint(grid);
  const cells = reachable(grid, start);
  const corner = (wantMaxCol: boolean, wantMaxRow: boolean): Cell => {
    let best = start;
    let bestScore = -Infinity;
    for (const c of cells) {
      const score = (wantMaxCol ? c.col : -c.col) + (wantMaxRow ? c.row : -c.row);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  };
  const tl = corner(false, false);
  const tr = corner(true, false);
  const br = corner(true, true);
  const bl = corner(false, true);
  // A closed loop, returning to the first corner so the motion cycles cleanly.
  const waypoints = [start, tr, br, bl, tl, tr];
  return { start, waypoints, label: 'PATROL // perimeter loop' };
}

/**
 * WALL_FOLLOW — reactive navigation with the left-hand rule. No global planner:
 * at each step the robot prefers to turn left, then go straight, then right,
 * then reverse — hugging obstacle and boundary walls. The grid border counts
 * as a wall, so on an open map it traces the perimeter and weaves around
 * contribution blobs.
 */
function wallFollow(grid: Grid): BehaviorResult {
  const start = spawnPoint(grid);
  const route: Cell[] = [start];
  let cur = start;
  let dir = 0; // start facing east
  const maxSteps = grid.width * grid.height * 3;

  for (let step = 0; step < maxSteps; step++) {
    // Preference order: left, straight, right, back (relative to heading).
    const order = [(dir + 3) % 4, dir, (dir + 1) % 4, (dir + 2) % 4];
    let moved = false;
    for (const d of order) {
      const [dc, dr] = ORTHO[d]!;
      const col = cur.col + dc;
      const row = cur.row + dr;
      if (grid.isFree(col, row)) {
        cur = { col, row };
        dir = d;
        route.push(cur);
        moved = true;
        break;
      }
    }
    if (!moved) break; // fully boxed in
    // Stop once the loop closes (back to start heading east again).
    if (cur.col === start.col && cur.row === start.row && dir === 0 && route.length > 2) {
      break;
    }
  }
  return { start, route, label: 'WALL_FOLLOW // left-hand rule' };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export function runBehavior(name: BehaviorName, grid: Grid, rng: Rng): BehaviorResult {
  switch (name) {
    case 'escape':
      return escape(grid);
    case 'explore':
      return explore(grid);
    case 'wander':
      return wander(grid, rng);
    case 'patrol':
      return patrol(grid);
    case 'wall_follow':
      return wallFollow(grid);
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown behavior: ${_exhaustive as string}`);
    }
  }
}
