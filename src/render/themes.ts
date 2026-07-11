/** Light and dark colour palettes for the renderer. */

import type { Theme } from '../types.js';

export const DARK_THEME: Theme = {
  name: 'dark',
  background: '#0d1117',
  panel: '#010409',
  gridLine: '#21262d',
  emptyCell: '#161b22',
  levels: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
  robotBody: '#c9d1d9',
  robotAccent: '#ff7b00',
  robotDark: '#30363d',
  lidarFill: 'rgba(56,214,255,0.10)',
  lidarStroke: 'rgba(56,214,255,0.55)',
  sweep: '#38d6ff',
  path: '#ffb347',
  visited: 'rgba(56,214,255,0.16)',
  frontier: 'rgba(56,214,255,0.35)',
  start: '#3fb950',
  goal: '#ff7b72',
  hud: '#8b949e',
  hudDim: '#30363d',
};

export const LIGHT_THEME: Theme = {
  name: 'light',
  background: '#ffffff',
  panel: '#f6f8fa',
  gridLine: '#d0d7de',
  emptyCell: '#ebedf0',
  levels: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
  robotBody: '#24292f',
  robotAccent: '#fb8500',
  robotDark: '#57606a',
  lidarFill: 'rgba(9,105,218,0.10)',
  lidarStroke: 'rgba(9,105,218,0.50)',
  sweep: '#0969da',
  path: '#bc4c00',
  visited: 'rgba(9,105,218,0.12)',
  frontier: 'rgba(9,105,218,0.30)',
  start: '#1a7f37',
  goal: '#cf222e',
  hud: '#57606a',
  hudDim: '#d0d7de',
};

export const THEMES: Record<'light' | 'dark', Theme> = {
  light: LIGHT_THEME,
  dark: DARK_THEME,
};
