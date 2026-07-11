/**
 * Occupancy grid built from a GitHub contribution calendar.
 *
 * The contribution graph is a natural 2D grid: 7 rows (days of the week) by
 * ~53 columns (weeks of the year). We treat any day with contributions as an
 * **obstacle** and empty days as **free space**. The robot navigates the free
 * space from the left edge toward the right.
 */

import type { Cell } from '../types.js';

/** A single day in the calendar. */
export interface DayCell {
  /** Contribution intensity, 0 (empty) .. 4 (busiest). */
  level: number;
  /** ISO date string, or null for padding cells outside the real calendar. */
  date: string | null;
  count: number;
}

export class Grid {
  readonly width: number;
  readonly height: number;
  /** Row-major cells, indexed by `row * width + col`. */
  private readonly cells: DayCell[];

  constructor(width: number, height: number, cells: DayCell[]) {
    this.width = width;
    this.height = height;
    this.cells = cells;
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.width && row >= 0 && row < this.height;
  }

  at(col: number, row: number): DayCell {
    return this.cells[row * this.width + col]!;
  }

  /** A cell is an obstacle when it has any contributions. */
  isObstacle(col: number, row: number): boolean {
    if (!this.inBounds(col, row)) return true; // out of bounds acts as a wall
    return this.at(col, row).level > 0;
  }

  isFree(col: number, row: number): boolean {
    return this.inBounds(col, row) && this.at(col, row).level === 0;
  }

  /** Every free cell, left-to-right, top-to-bottom. */
  freeCells(): Cell[] {
    const out: Cell[] = [];
    for (let col = 0; col < this.width; col++) {
      for (let row = 0; row < this.height; row++) {
        if (this.isFree(col, row)) out.push({ col, row });
      }
    }
    return out;
  }
}

/**
 * Build a {@link Grid} from the weeks/days structure returned by the GitHub
 * GraphQL API. Missing days (padding at the start/end of the year) are treated
 * as free space so the robot can still traverse those columns.
 */
export function gridFromCalendar(
  weeks: { contributionDays: { contributionLevel: string; date: string; contributionCount: number }[] }[],
): Grid {
  const width = weeks.length;
  const height = 7;
  const cells: DayCell[] = new Array(width * height);

  const levelMap: Record<string, number> = {
    NONE: 0,
    FIRST_QUARTILE: 1,
    SECOND_QUARTILE: 2,
    THIRD_QUARTILE: 3,
    FOURTH_QUARTILE: 4,
  };

  // Initialise as free padding.
  for (let i = 0; i < cells.length; i++) {
    cells[i] = { level: 0, date: null, count: 0 };
  }

  weeks.forEach((week, col) => {
    for (const day of week.contributionDays) {
      const row = new Date(day.date + 'T00:00:00Z').getUTCDay(); // 0=Sun..6=Sat
      cells[row * width + col] = {
        level: levelMap[day.contributionLevel] ?? 0,
        date: day.date,
        count: day.contributionCount,
      };
    }
  });

  return new Grid(width, height, cells);
}
