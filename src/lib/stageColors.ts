/** Per-stage colors. Assignment is stable for a given ordered stage list, so
 *  the timeline columns, headers, and any legend agree. */

export type StageColor = { fill: string; border: string };

const PALETTE: StageColor[] = [
  { fill: '#1e3a8a', border: '#60a5fa' }, // blue
  { fill: '#3730a3', border: '#818cf8' }, // indigo
  { fill: '#6b21a8', border: '#c084fc' }, // purple
  { fill: '#0f766e', border: '#2dd4bf' }, // teal
  { fill: '#9a3412', border: '#fb923c' }, // orange
  { fill: '#155e75', border: '#22d3ee' }, // cyan
  { fill: '#a16207', border: '#facc15' }, // gold
  { fill: '#831843', border: '#f472b6' }, // pink
  { fill: '#3f6212', border: '#a3e635' }, // lime
  { fill: '#7c2d12', border: '#f87171' }, // rust
];

/** Build a stable stage→color map from an ordered list of stage names. */
export function buildStageColors(stages: string[]): Map<string, StageColor> {
  const m = new Map<string, StageColor>();
  stages.forEach((s, i) => m.set(s, PALETTE[i % PALETTE.length]));
  return m;
}

const FALLBACK: StageColor = { fill: '#334155', border: '#94a3b8' };

export const colorFor = (
  map: Map<string, StageColor>,
  stage: string | undefined,
): StageColor => (stage && map.get(stage)) || FALLBACK;
