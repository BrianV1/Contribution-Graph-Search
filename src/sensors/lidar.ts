/**
 * 2D LIDAR simulation via grid ray casting.
 *
 * Each beam is traced with a DDA (digital differential analyser) grid traversal
 * — the Amanatides & Woo algorithm — which visits every cell a ray crosses in
 * order, without gaps, and stops at the exact boundary where it enters an
 * obstacle. This is faster and more accurate than fixed-step sampling.
 *
 * The sensor is configurable: {@link LidarConfig.beamCount} controls angular
 * resolution and {@link LidarConfig.range} caps how far each beam travels.
 */

import type { LidarBeam, LidarScan, Vec2 } from '../types.js';
import { Grid } from '../grid/grid.js';

export interface LidarConfig {
  beamCount: number;
  range: number;
}

/**
 * Cast a single ray from `origin` at `angle` and return where it terminates.
 *
 * @param grid    Occupancy grid providing `isObstacle(col, row)`.
 * @param origin  Ray origin in grid space (must sit in a free cell).
 * @param angle   Direction in radians (0 = +x).
 * @param maxRange Maximum travel distance in grid units.
 */
export function castRay(
  grid: Grid,
  origin: Vec2,
  angle: number,
  maxRange: number,
): LidarBeam {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  let cellX = Math.floor(origin.x);
  let cellY = Math.floor(origin.y);

  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;

  // Distance (along the ray) to the first cell boundary in each axis.
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;

  const nextX = dx > 0 ? cellX + 1 : cellX;
  const nextY = dy > 0 ? cellY + 1 : cellY;
  let tMaxX = dx !== 0 ? (nextX - origin.x) / dx : Infinity;
  let tMaxY = dy !== 0 ? (nextY - origin.y) / dy : Infinity;

  let travelled = 0;

  // Walk cell by cell until we hit an obstacle, leave the grid, or run out of range.
  for (let guard = 0; guard < 1024; guard++) {
    // Advance to the nearer of the next X / Y boundary.
    if (tMaxX < tMaxY) {
      travelled = tMaxX;
      tMaxX += tDeltaX;
      cellX += stepX;
    } else {
      travelled = tMaxY;
      tMaxY += tDeltaY;
      cellY += stepY;
    }

    if (travelled >= maxRange) {
      return miss(origin, dx, dy, angle, maxRange);
    }

    if (grid.isObstacle(cellX, cellY)) {
      // The obstacle boundary crossing is exactly `travelled` along the ray.
      return {
        angle,
        distance: travelled,
        hit: true,
        end: { x: origin.x + dx * travelled, y: origin.y + dy * travelled },
      };
    }
  }

  return miss(origin, dx, dy, angle, maxRange);
}

function miss(origin: Vec2, dx: number, dy: number, angle: number, range: number): LidarBeam {
  return {
    angle,
    distance: range,
    hit: false,
    end: { x: origin.x + dx * range, y: origin.y + dy * range },
  };
}

/**
 * Take a full 360° scan from `origin`. Beams are spread evenly around the
 * circle; `headingOffset` rotates the whole pattern (used to animate the sweep).
 */
export function scan(
  grid: Grid,
  origin: Vec2,
  config: LidarConfig,
  headingOffset = 0,
): LidarScan {
  const beams: LidarBeam[] = [];
  const step = (Math.PI * 2) / config.beamCount;
  for (let i = 0; i < config.beamCount; i++) {
    const angle = headingOffset + i * step;
    beams.push(castRay(grid, origin, angle, config.range));
  }
  return { origin, beams };
}
