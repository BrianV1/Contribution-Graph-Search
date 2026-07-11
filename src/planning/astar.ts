/**
 * A* grid planner.
 *
 * Uses the octile distance heuristic, which is admissible for 8-connected grids
 * (and still admissible, just less tight, for 4-connected ones). The heuristic
 * never overestimates the true cost, so the returned path is optimal.
 */

import type { Cell } from '../types.js';
import { Grid } from '../grid/grid.js';
import {
  Planner,
  PlannerOptions,
  PlanResult,
  neighbours,
  key,
  registerPlanner,
} from './planner.js';
import { MinHeap } from './heap.js';

/** Octile distance: exact cost across an obstacle-free 8-connected grid. */
function octile(a: Cell, b: Cell): number {
  const dx = Math.abs(a.col - b.col);
  const dy = Math.abs(a.row - b.row);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

export class AStarPlanner implements Planner {
  readonly name = 'astar';

  plan(grid: Grid, start: Cell, goal: Cell, options: PlannerOptions): PlanResult {
    const visitedOrder: Cell[] = [];
    if (!grid.isFree(start.col, start.row) || !grid.isFree(goal.col, goal.row)) {
      return { path: [], visitedOrder };
    }

    const gScore = new Map<number, number>();
    const cameFrom = new Map<number, Cell>();
    const closed = new Set<number>();
    const open = new MinHeap<Cell>();

    const startKey = key(start);
    gScore.set(startKey, 0);
    open.push(start, octile(start, goal));

    while (open.size > 0) {
      const current = open.pop()!;
      const curKey = key(current);
      if (closed.has(curKey)) continue;
      closed.add(curKey);
      visitedOrder.push(current);

      if (curKey === key(goal)) {
        return { path: reconstruct(cameFrom, current), visitedOrder };
      }

      const g = gScore.get(curKey)!;
      for (const { cell, cost } of neighbours(grid, current, options.allowDiagonal)) {
        const nKey = key(cell);
        if (closed.has(nKey)) continue;
        const tentative = g + cost;
        if (tentative < (gScore.get(nKey) ?? Infinity)) {
          gScore.set(nKey, tentative);
          cameFrom.set(nKey, current);
          open.push(cell, tentative + octile(cell, goal));
        }
      }
    }

    return { path: [], visitedOrder };
  }
}

function reconstruct(cameFrom: Map<number, Cell>, end: Cell): Cell[] {
  const path: Cell[] = [end];
  let cur = end;
  for (;;) {
    const prev = cameFrom.get(key(cur));
    if (!prev) break;
    path.push(prev);
    cur = prev;
  }
  return path.reverse();
}

registerPlanner('astar', () => new AStarPlanner());
