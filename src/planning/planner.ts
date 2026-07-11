/**
 * Planner abstraction + registry.
 *
 * Every path-planning algorithm implements the {@link Planner} interface and
 * registers itself in the {@link plannerRegistry}. Adding Dijkstra, RRT,
 * D* Lite, Theta*, … is a matter of writing one file and calling
 * `registerPlanner(name, factory)` — nothing else in the codebase changes.
 */

import type { Cell } from '../types.js';
import { Grid } from '../grid/grid.js';

/** Options shared by all planners. */
export interface PlannerOptions {
  /** Allow diagonal (8-connected) moves. Corner-cutting is always forbidden. */
  allowDiagonal: boolean;
}

/** The result of a planning query. */
export interface PlanResult {
  /** The cells from start to goal inclusive, or an empty array if unreachable. */
  path: Cell[];
  /**
   * Cells in the order they were expanded (the "closed set"). Used purely to
   * visualise the search. Algorithms that do not expand a search frontier may
   * leave this empty.
   */
  visitedOrder: Cell[];
}

export interface Planner {
  readonly name: string;
  plan(grid: Grid, start: Cell, goal: Cell, options: PlannerOptions): PlanResult;
}

type PlannerFactory = () => Planner;

const registry = new Map<string, PlannerFactory>();

/** Register a planner implementation under a unique name. */
export function registerPlanner(name: string, factory: PlannerFactory): void {
  registry.set(name, factory);
}

/** Instantiate a planner by name. Throws if the name is unknown. */
export function getPlanner(name: string): Planner {
  const factory = registry.get(name);
  if (!factory) {
    throw new Error(
      `Unknown planner "${name}". Registered: ${[...registry.keys()].join(', ') || '(none)'}`,
    );
  }
  return factory();
}

export const plannerRegistry = registry;

// ---------------------------------------------------------------------------
// Movement model shared by grid-based planners
// ---------------------------------------------------------------------------

const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const DIAG: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * Return the traversable neighbours of a cell together with the step cost.
 * Diagonal moves are only allowed when both orthogonal cells they "cut" past
 * are also free, which keeps the robot from clipping obstacle corners.
 */
export function neighbours(
  grid: Grid,
  cell: Cell,
  allowDiagonal: boolean,
): { cell: Cell; cost: number }[] {
  const out: { cell: Cell; cost: number }[] = [];
  for (const [dc, dr] of ORTHO) {
    const col = cell.col + dc;
    const row = cell.row + dr;
    if (grid.isFree(col, row)) out.push({ cell: { col, row }, cost: 1 });
  }
  if (allowDiagonal) {
    for (const [dc, dr] of DIAG) {
      const col = cell.col + dc;
      const row = cell.row + dr;
      if (!grid.isFree(col, row)) continue;
      // Forbid corner cutting: both orthogonal neighbours must be free.
      if (!grid.isFree(cell.col + dc, cell.row) || !grid.isFree(cell.col, cell.row + dr)) {
        continue;
      }
      out.push({ cell: { col, row }, cost: Math.SQRT2 });
    }
  }
  return out;
}

export const key = (c: Cell): number => c.row * 100000 + c.col;
