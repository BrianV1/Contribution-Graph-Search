/**
 * SVG animation renderer.
 *
 * Produces a **self-contained animated SVG** with no JavaScript — every motion
 * is expressed with SMIL (`<animateMotion>`, `<animate>`) so it renders inside
 * a GitHub README `<img>`. The whole scene is a single infinite loop of total
 * duration `T`; every animation shares that `dur` and uses `keyTimes` in [0,1],
 * so all layers stay perfectly in phase and reset together at the seam.
 *
 * Timeline (fractions of the loop):
 *   0.00–0.24  A* search expands (visited cells fade in, batched)
 *   0.25–0.36  the optimal path draws on
 *   0.40–0.92  the robot drives the path; LIDAR scans continuously
 *   0.92–1.00  dwell at the goal, then reset
 */

import type { SimConfig, Theme, Vec2 } from '../types.js';
import { Simulation, sampleRoute } from '../robot/simulator.js';
import { scan } from '../sensors/lidar.js';

// --- Layout constants (pixels) --------------------------------------------
const PITCH = 16; // cell-to-cell spacing
const CELL = 12; // drawn size of a contribution square
const MARGIN = { left: 26, top: 74, right: 26, bottom: 58 };

// --- Timeline fractions ----------------------------------------------------
const T = {
  searchStart: 0.03,
  searchEnd: 0.24,
  pathStart: 0.25,
  pathEnd: 0.37,
  driveStart: 0.4,
  driveEnd: 0.92,
};

/** Round to 2 decimals and stringify compactly. */
const f = (n: number): string =>
  (Math.round((Number.isFinite(n) ? n : 0) * 100) / 100).toString();

const escapeXml = (s: string): string =>
  s.replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;',
  );

export function renderSvg(sim: Simulation, config: SimConfig, theme: Theme): string {
  const { grid } = sim;
  const width = MARGIN.left + grid.width * PITCH + MARGIN.right;
  const height = MARGIN.top + grid.height * PITCH + MARGIN.bottom;

  // Grid coord (cell centre space, x=col+0.5) → pixel.
  const gx = (x: number): number => MARGIN.left + x * PITCH;
  const gy = (y: number): number => MARGIN.top + y * PITCH;

  const dur = config.motion.durationSeconds;
  const rangePx = config.lidar.range * PITCH;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">`,
  );
  parts.push(defs(theme));
  parts.push(background(width, height, grid, gx, gy, theme));
  parts.push(hud(width, height, sim, config, theme));
  parts.push(contributionCells(grid, gx, gy, theme));
  parts.push(searchLayer(sim, gx, gy, dur, theme));
  parts.push(pathLayer(sim, gx, gy, dur, theme));
  parts.push(markers(sim, gx, gy, dur, theme));
  parts.push(lidarFan(sim, config, gx, gy, dur, theme));
  parts.push(robot(sim, config, gx, gy, rangePx, dur, theme));
  parts.push('</svg>');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

function defs(theme: Theme): string {
  return `<defs>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <radialGradient id="scanGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${theme.sweep}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="${theme.sweep}" stop-opacity="0"/>
    </radialGradient>
  </defs>`;
}

function background(
  width: number,
  height: number,
  grid: { width: number; height: number },
  gx: (x: number) => number,
  gy: (y: number) => number,
  theme: Theme,
): string {
  const lines: string[] = [];
  // Faint alignment grid behind the cells.
  for (let c = 0; c <= grid.width; c++) {
    const x = gx(c) - PITCH / 2;
    lines.push(`<line x1="${f(x)}" y1="${f(gy(0) - PITCH / 2)}" x2="${f(x)}" y2="${f(gy(grid.height) - PITCH / 2)}"/>`);
  }
  for (let r = 0; r <= grid.height; r++) {
    const y = gy(r) - PITCH / 2;
    lines.push(`<line x1="${f(gx(0) - PITCH / 2)}" y1="${f(y)}" x2="${f(gx(grid.width) - PITCH / 2)}" y2="${f(y)}"/>`);
  }
  return `<rect width="${width}" height="${height}" fill="${theme.background}"/>
  <g stroke="${theme.gridLine}" stroke-width="0.5" opacity="0.5">${lines.join('')}</g>`;
}

function contributionCells(
  grid: Simulation['grid'],
  gx: (x: number) => number,
  gy: (y: number) => number,
  theme: Theme,
): string {
  const rects: string[] = [];
  const off = (PITCH - CELL) / 2;
  for (let col = 0; col < grid.width; col++) {
    for (let row = 0; row < grid.height; row++) {
      const cell = grid.at(col, row);
      const x = gx(col) - PITCH / 2 + off;
      const y = gy(row) - PITCH / 2 + off;
      const fill = cell.level === 0 ? theme.emptyCell : theme.levels[cell.level] ?? theme.levels[4];
      rects.push(
        `<rect x="${f(x)}" y="${f(y)}" width="${CELL}" height="${CELL}" rx="2.5" fill="${fill}"/>`,
      );
    }
  }
  return `<g>${rects.join('')}</g>`;
}

/** Batched fade-in of A* expanded cells (the closed set). */
function searchLayer(
  sim: Simulation,
  gx: (x: number) => number,
  gy: (y: number) => number,
  dur: number,
  theme: Theme,
): string {
  if (sim.visitedOrder.length === 0) return '';
  const off = (PITCH - CELL) / 2;
  const batches = Math.min(12, sim.visitedOrder.length);
  const per = Math.ceil(sim.visitedOrder.length / batches);
  const groups: string[] = [];

  for (let b = 0; b < batches; b++) {
    const slice = sim.visitedOrder.slice(b * per, (b + 1) * per);
    if (slice.length === 0) continue;
    const rects = slice
      .map((c) => {
        const x = gx(c.col) - PITCH / 2 + off;
        const y = gy(c.row) - PITCH / 2 + off;
        return `<rect x="${f(x)}" y="${f(y)}" width="${CELL}" height="${CELL}" rx="2.5"/>`;
      })
      .join('');
    const reveal = T.searchStart + (T.searchEnd - T.searchStart) * (b / batches);
    const before = Math.max(0.001, reveal - 0.02);
    groups.push(
      `<g fill="${theme.visited}" stroke="${theme.frontier}" stroke-width="0.5" opacity="0">${rects}` +
        `<animate attributeName="opacity" dur="${dur}s" repeatCount="indefinite" calcMode="linear" ` +
        `keyTimes="0;${f(before)};${f(reveal)};1" values="0;0;1;1"/></g>`,
    );
  }
  return `<g>${groups.join('')}</g>`;
}

/** The optimal path, drawn on with a stroke-dashoffset animation. */
function pathLayer(
  sim: Simulation,
  gx: (x: number) => number,
  gy: (y: number) => number,
  dur: number,
  theme: Theme,
): string {
  if (sim.route.length < 2) return '';
  const d = 'M' + sim.route.map((p) => `${f(gx(p.x))} ${f(gy(p.y))}`).join(' L ');
  return `<path d="${d}" fill="none" stroke="${theme.path}" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" opacity="0.9" filter="url(#glow)">` +
    `<animate attributeName="stroke-dashoffset" dur="${dur}s" repeatCount="indefinite" calcMode="linear" ` +
    `keyTimes="0;${T.pathStart};${T.pathEnd};1" values="1;1;0;0"/></path>`;
}

/** Spawn ring + pulsing goal targets (one per planned segment). */
function markers(
  sim: Simulation,
  gx: (x: number) => number,
  gy: (y: number) => number,
  dur: number,
  theme: Theme,
): string {
  const out: string[] = [];
  // Spawn.
  const sx = gx(sim.start.col + 0.5);
  const sy = gy(sim.start.row + 0.5);
  out.push(
    `<circle cx="${f(sx)}" cy="${f(sy)}" r="5" fill="none" stroke="${theme.start}" stroke-width="1.5"/>` +
      `<circle cx="${f(sx)}" cy="${f(sy)}" r="1.6" fill="${theme.start}"/>`,
  );

  // Goal(s) — pulsing crosshair.
  const goals = sim.segments.map((s) => s.goal);
  goals.forEach((g, i) => {
    const cx = gx(g.col + 0.5);
    const cy = gy(g.row + 0.5);
    const begin = f(((i * 0.3) % dur));
    out.push(
      `<g stroke="${theme.goal}" stroke-width="1.3" fill="none">` +
        `<circle cx="${f(cx)}" cy="${f(cy)}" r="4">` +
        `<animate attributeName="r" dur="1.8s" begin="${begin}s" repeatCount="indefinite" values="3;7;3"/>` +
        `<animate attributeName="opacity" dur="1.8s" begin="${begin}s" repeatCount="indefinite" values="0.9;0;0.9"/></circle>` +
        `<line x1="${f(cx - 6)}" y1="${f(cy)}" x2="${f(cx + 6)}" y2="${f(cy)}"/>` +
        `<line x1="${f(cx)}" y1="${f(cy - 6)}" x2="${f(cx)}" y2="${f(cy + 6)}"/></g>`,
    );
  });
  return `<g>${out.join('')}</g>`;
}

/**
 * The accurate LIDAR return polygon, morphing through precomputed scans.
 * Each frame is a real ray-cast of the free region from the robot's current
 * position; SMIL interpolates the polygon `points` between frames.
 */
function lidarFan(
  sim: Simulation,
  config: SimConfig,
  gx: (x: number) => number,
  gy: (y: number) => number,
  dur: number,
  theme: Theme,
): string {
  const N = Math.max(6, config.motion.lidarSamples);

  const poseAt = (frac: number): Vec2 => {
    if (frac <= T.driveStart || sim.route.length < 2) return sim.route[0]!;
    if (frac >= T.driveEnd) return sim.route[sim.route.length - 1]!;
    const s = (frac - T.driveStart) / (T.driveEnd - T.driveStart);
    return sampleRoute(sim.route, s);
  };

  const values: string[] = [];
  const keyTimes: string[] = [];
  for (let i = 0; i < N; i++) {
    const frac = i / (N - 1);
    const origin = poseAt(frac);
    // Rotate the beam pattern slightly each frame so the fan edge shimmers.
    const s = scan(sim.grid, origin, config.lidar, frac * Math.PI * 2);
    const pts = s.beams
      .map((b) => `${f(gx(b.end.x))},${f(gy(b.end.y))}`)
      .join(' ');
    values.push(pts);
    keyTimes.push(f(frac));
  }

  return `<polygon points="${values[0]}" fill="${theme.lidarFill}" stroke="${theme.lidarStroke}" ` +
    `stroke-width="1" stroke-linejoin="round">` +
    `<animate attributeName="points" dur="${dur}s" repeatCount="indefinite" calcMode="linear" ` +
    `keyTimes="${keyTimes.join(';')}" values="${values.join(';')}"/></polygon>`;
}

/** The robot chassis + onboard sensing, driven along the route by animateMotion. */
function robot(
  sim: Simulation,
  config: SimConfig,
  gx: (x: number) => number,
  gy: (y: number) => number,
  rangePx: number,
  dur: number,
  theme: Theme,
): string {
  // Chassis art, drawn centred at (0,0) facing +x.
  const art = `
    <circle r="${f(rangePx)}" fill="none" stroke="${theme.lidarStroke}" stroke-width="0.8"
            stroke-dasharray="2 4" opacity="0.35"/>
    <g>
      <polygon points="0,0 ${f(rangePx)},-9 ${f(rangePx)},9" fill="url(#scanGrad)">
        <animateTransform attributeName="transform" type="rotate" from="0" to="360"
                          dur="2.4s" repeatCount="indefinite"/>
      </polygon>
    </g>
    <line x1="-6" y1="-7" x2="-10" y2="-12" stroke="${theme.robotBody}" stroke-width="1"/>
    <circle cx="-10" cy="-12" r="1.6" fill="${theme.robotAccent}"/>
    <rect x="-9" y="-9" width="18" height="4" rx="1.5" fill="${theme.robotDark}"/>
    <rect x="-9" y="5" width="18" height="4" rx="1.5" fill="${theme.robotDark}"/>
    <rect x="-10" y="-7" width="20" height="14" rx="4" fill="${theme.robotBody}" stroke="${theme.robotDark}" stroke-width="1"/>
    <rect x="-6" y="-4" width="9" height="8" rx="2" fill="${theme.robotDark}" opacity="0.6"/>
    <circle cx="6" cy="0" r="2.4" fill="${theme.robotAccent}" filter="url(#glow)"/>
    <circle cx="0" cy="0" r="1.2" fill="${theme.background}"/>`;

  if (sim.route.length < 2) {
    const p = sim.route[0]!;
    return `<g transform="translate(${f(gx(p.x))},${f(gy(p.y))})">${art}</g>`;
  }

  const d = 'M' + sim.route.map((p) => `${f(gx(p.x))} ${f(gy(p.y))}`).join(' L ');
  return `<g>
    ${art}
    <animateMotion dur="${dur}s" repeatCount="indefinite" rotate="auto" calcMode="linear"
                   path="${d}" keyPoints="0;0;1;1" keyTimes="0;${T.driveStart};${T.driveEnd};1"/>
  </g>`;
}

/** Robotics-styled HUD: title, telemetry, corner brackets, status bar. */
function hud(
  width: number,
  height: number,
  sim: Simulation,
  config: SimConfig,
  theme: Theme,
): string {
  let obstacles = 0;
  let free = 0;
  for (let col = 0; col < sim.grid.width; col++) {
    for (let row = 0; row < sim.grid.height; row++) {
      if (sim.grid.isObstacle(col, row)) obstacles++;
      else free++;
    }
  }
  const routeLen = sim.route.length;

  const titleY = 30;
  const barY = height - 26;

  return `<g>
    <text x="26" y="${titleY}" fill="${theme.robotAccent}" font-size="15" font-weight="700"
          letter-spacing="2">CONTRIBUTION-GRAPH SLAM</text>

    <line x1="26" y1="${barY - 12}" x2="${width - 26}" y2="${barY - 12}" stroke="${theme.hudDim}" stroke-width="1"/>
    <text x="26" y="${barY}" fill="${theme.hud}" font-size="10" letter-spacing="0.5">${escapeXml(
      `GRID ${sim.grid.width}×${sim.grid.height}   OBSTACLES ${obstacles}   FREE ${free}   NODES ${sim.visitedOrder.length}   ROUTE ${routeLen}`,
    )}</text>

    <rect x="26" y="${barY + 4}" width="${width - 52}" height="2" rx="1" fill="${theme.hudDim}"/>
    <rect x="26" y="${barY + 4}" width="${width - 52}" height="2" rx="1" fill="${theme.robotAccent}">
      <animate attributeName="width" dur="${config.motion.durationSeconds}s" repeatCount="indefinite"
               calcMode="linear" keyTimes="0;${T.driveStart};${T.driveEnd};1"
               values="0;0;${width - 52};${width - 52}"/>
    </rect>
  </g>`;
}
