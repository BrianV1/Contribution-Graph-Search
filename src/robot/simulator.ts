/**
 * Robot simulator.
 *
 * Composes a {@link runBehavior | behavior} with a
 * {@link getPlanner | planner} to produce a fully resolved mission:
 *
 *   behavior → waypoints → (plan each leg with A*) → concatenated route
 *
 * The output {@link Simulation} is a pure data structure — no rendering, no
 * timing. The SVG renderer turns it into an animation, and it could equally
 * drive a canvas viewer, a test harness, or a headless benchmark.
 */

import type { Cell, SimConfig, Vec2 } from '../types.js';
import { makeRng } from '../types.js';
import { Grid } from '../grid/grid.js';
import { getPlanner } from '../planning/planner.js';
import { key } from '../planning/planner.js';
import { runBehavior } from './behaviors.js';

/** One planned leg of the mission (start waypoint → goal waypoint). */
export interface PlannedSegment {
  goal: Cell;
  path: Cell[];
  visitedOrder: Cell[];
}

export interface Simulation {
  grid: Grid;
  start: Cell;
  label: string;
  segments: PlannedSegment[];
  /** Concatenated route as cell-centre points in grid space, ready to animate. */
  route: Vec2[];
  /** De-duplicated union of every leg's expanded cells, for the search overlay. */
  visitedOrder: Cell[];
  /** Whether the mission produced any motion at all. */
  moved: boolean;
}

/** Cell centre in grid space (LIDAR & motion operate on centres). */
const centre = (c: Cell): Vec2 => ({ x: c.col + 0.5, y: c.row + 0.5 });

export function simulate(grid: Grid, config: SimConfig): Simulation {
  const rng = makeRng(config.seed);
  const mission = runBehavior(config.behavior, grid, rng);

  const segments: PlannedSegment[] = [];
  const route: Vec2[] = [];
  const visitedSeen = new Set<number>();
  const visitedOrder: Cell[] = [];

  const pushRouteCell = (c: Cell) => {
    const p = centre(c);
    const last = route[route.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) route.push(p);
  };

  if (mission.route) {
    // Reactive behavior: use the explicit route directly, no planning.
    for (const c of mission.route) pushRouteCell(c);
    segments.push({
      goal: mission.route[mission.route.length - 1] ?? mission.start,
      path: mission.route,
      visitedOrder: [],
    });
  } else {
    // Deliberative behavior: plan (and replan) between each waypoint.
    const planner = getPlanner(config.planner);
    const waypoints = mission.waypoints ?? [mission.start];
    for (let i = 0; i + 1 < waypoints.length; i++) {
      const from = waypoints[i]!;
      const to = waypoints[i + 1]!;
      const result = planner.plan(grid, from, to, {
        allowDiagonal: config.motion.allowDiagonal,
      });
      if (result.path.length === 0) continue; // unreachable leg — skip
      segments.push({ goal: to, path: result.path, visitedOrder: result.visitedOrder });
      for (const c of result.path) pushRouteCell(c);
      for (const c of result.visitedOrder) {
        const k = key(c);
        if (!visitedSeen.has(k)) {
          visitedSeen.add(k);
          visitedOrder.push(c);
        }
      }
    }
  }

  if (route.length === 0) route.push(centre(mission.start));

  return {
    grid,
    start: mission.start,
    label: mission.label,
    segments,
    route,
    visitedOrder,
    moved: route.length > 1,
  };
}

/**
 * Sample the route at arc-length fraction `s` ∈ [0, 1]. Used by the renderer to
 * place the robot and take a LIDAR scan at each animation frame, giving smooth
 * continuous translation between cell centres.
 */
export function sampleRoute(route: Vec2[], s: number): Vec2 {
  if (route.length === 1) return route[0]!;
  const clamped = s <= 0 ? 0 : s >= 1 ? 1 : s;

  // Cumulative arc lengths.
  let total = 0;
  const segLen: number[] = [];
  for (let i = 0; i + 1 < route.length; i++) {
    const l = Math.hypot(route[i + 1]!.x - route[i]!.x, route[i + 1]!.y - route[i]!.y);
    segLen.push(l);
    total += l;
  }
  if (total === 0) return route[0]!;

  let target = clamped * total;
  for (let i = 0; i < segLen.length; i++) {
    if (target <= segLen[i]!) {
      const t = segLen[i]! === 0 ? 0 : target / segLen[i]!;
      const a = route[i]!;
      const b = route[i + 1]!;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    target -= segLen[i]!;
  }
  return route[route.length - 1]!;
}
