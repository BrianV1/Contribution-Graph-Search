/**
 * Dijkstra grid planner — included to demonstrate how additional algorithms
 * plug into the registry. It is simply A* with a zero heuristic, so it explores
 * uniformly outward from the start and still returns an optimal path.
 *
 * To add your own planner (RRT, D* Lite, Theta*, …) copy this file, implement
 * `plan()`, and call `registerPlanner('yourname', () => new YourPlanner())`.
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

export class DijkstraPlanner implements Planner {
  readonly name = 'dijkstra';

  plan(grid: Grid, start: Cell, goal: Cell, options: PlannerOptions): PlanResult {
    const visitedOrder: Cell[] = [];
    if (!grid.isFree(start.col, start.row) || !grid.isFree(goal.col, goal.row)) {
      return { path: [], visitedOrder };
    }

    const dist = new Map<number, number>();
    const cameFrom = new Map<number, Cell>();
    const closed = new Set<number>();
    const open = new MinHeap<Cell>();

    dist.set(key(start), 0);
    open.push(start, 0);

    while (open.size > 0) {
      const current = open.pop()!;
      const curKey = key(current);
      if (closed.has(curKey)) continue;
      closed.add(curKey);
      visitedOrder.push(current);

      if (curKey === key(goal)) {
        return { path: reconstruct(cameFrom, current), visitedOrder };
      }

      const d = dist.get(curKey)!;
      for (const { cell, cost } of neighbours(grid, current, options.allowDiagonal)) {
        const nKey = key(cell);
        if (closed.has(nKey)) continue;
        const tentative = d + cost;
        if (tentative < (dist.get(nKey) ?? Infinity)) {
          dist.set(nKey, tentative);
          cameFrom.set(nKey, current);
          open.push(cell, tentative);
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

registerPlanner('dijkstra', () => new DijkstraPlanner());
