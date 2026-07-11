/**
 * Shared types and small geometry helpers used across the whole simulator.
 *
 * The simulation works entirely in **grid space** (fractional column/row
 * coordinates). Only the SVG renderer converts grid space into pixels. Keeping
 * the physics and planning in grid units means every module — planner, LIDAR,
 * robot — speaks the same language and stays independent of presentation.
 */

/** A point in continuous grid space. `x` is the column axis, `y` is the row axis. */
export interface Vec2 {
  x: number;
  y: number;
}

/** An integer grid cell. */
export interface Cell {
  col: number;
  row: number;
}

/** A robot pose: position plus a heading in radians (0 = +x / pointing right). */
export interface Pose {
  x: number;
  y: number;
  heading: number;
}

/** A single simulated LIDAR return. */
export interface LidarBeam {
  /** World-frame angle of the beam in radians. */
  angle: number;
  /** Distance to the hit (or max range) in grid units. */
  distance: number;
  /** Whether the beam terminated on an obstacle (`true`) or reached max range. */
  hit: boolean;
  /** Endpoint of the beam in grid space. */
  end: Vec2;
}

/** A full LIDAR scan taken from a single pose. */
export interface LidarScan {
  origin: Vec2;
  beams: LidarBeam[];
}

/** Supported high-level robot behaviors. */
export type BehaviorName =
  | 'escape'
  | 'explore'
  | 'wander'
  | 'patrol'
  | 'wall_follow';

/** Supported path-planning algorithms (extensible via the planner registry). */
export type PlannerName = 'astar' | 'dijkstra';

/** Colour palette used by the renderer for a single theme. */
export interface Theme {
  name: 'light' | 'dark';
  background: string;
  panel: string;
  gridLine: string;
  emptyCell: string;
  /** Five entries: index 0 unused (empty), 1..4 are contribution levels. */
  levels: [string, string, string, string, string];
  robotBody: string;
  robotAccent: string;
  robotDark: string;
  lidarFill: string;
  lidarStroke: string;
  sweep: string;
  path: string;
  visited: string;
  frontier: string;
  start: string;
  goal: string;
  hud: string;
  hudDim: string;
}

/**
 * The master configuration object. A single config drives the entire run:
 * which behavior to simulate, which planner to use, the LIDAR parameters, and
 * the animation timing.
 */
export interface SimConfig {
  /** GitHub login whose contribution graph we visualise. */
  username: string;
  /** Robot behavior. See {@link BehaviorName}. */
  behavior: BehaviorName;
  /** Path-planning algorithm. See {@link PlannerName}. */
  planner: PlannerName;

  /** LIDAR configuration. */
  lidar: {
    /** Number of beams in a full 360° scan. Higher = smoother scan polygon. */
    beamCount: number;
    /** Maximum sensing range in grid cells. */
    range: number;
  };

  /** Movement / animation configuration. */
  motion: {
    /** Total loop duration in seconds. */
    durationSeconds: number;
    /** Number of LIDAR samples taken across the whole loop (animation frames). */
    lidarSamples: number;
    /** Allow 8-connected (diagonal) movement. */
    allowDiagonal: boolean;
  };

  /** Fixed random seed so daily regenerations are deterministic per day. */
  seed: number;
}

export const DEFAULT_CONFIG: Omit<SimConfig, 'username'> = {
  behavior: 'escape',
  planner: 'astar',
  lidar: {
    beamCount: 40,
    range: 5.5,
  },
  motion: {
    durationSeconds: 14,
    lidarSamples: 44,
    allowDiagonal: true,
  },
  seed: 1,
};

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const dist = (a: Vec2, b: Vec2): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** A tiny deterministic PRNG (mulberry32) so runs are reproducible from a seed. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
