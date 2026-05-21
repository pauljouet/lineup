import type { Artist, OptimizerConfig, Rating, ScheduleSlot } from '../state/types';
import { MINUTE, toMs, toIso } from './time';

/**
 * Travel-aware time-step DP.
 *
 * We discretize the festival into `STEP_MIN`-minute steps (matching the UI's
 * snap granularity, so this is exact relative to what the user can edit, not a
 * lossy approximation). A "plan" assigns to each step either a stage you are
 * watching or time spent idle/travelling.
 *
 * Objective: maximise the total `effectiveScore × minutes watched`.
 *
 * State carried through the DP:
 *   - `pos`: the stage index you are physically committed to (-1 = "free", the
 *     start state, from which the first move costs no travel).
 *   - `cd`:  travel cooldown — steps remaining before you arrive at `pos` and
 *     can begin watching there.
 *
 * Switching to a different stage costs `ceil(travelTime / STEP)` cooldown steps
 * during which nothing is watched. This is what makes overlaps + travel resolve
 * jointly and optimally rather than via fragile pairwise patching.
 *
 * Unrated artists get a tiny positive weight so they are picked when nothing
 * competes, but always lose to any rated artist.
 */

const STEP_MIN = 5;
const UNRATED_WEIGHT = 0.1; // beats idle, loses to any rated artist
// "Top" artists (score >= threshold) are weighted so heavily that no amount of
// lower-rated time can ever outweigh a single minute of a top set. This makes
// the optimization lexicographic: first maximize top-artist attendance, then
// fill whatever time is left idle with the best available lower-rated set.
const TOP_SCALE = 100_000;

export function optimize(
  artists: Artist[],
  ratings: Rating[],
  config: OptimizerConfig,
): ScheduleSlot[] {
  const valid = artists.filter((a) => {
    const s = toMs(a.start);
    const e = toMs(a.end);
    return Number.isFinite(s) && Number.isFinite(e) && e > s;
  });
  if (valid.length === 0) return [];

  const threshold = config.displayThreshold ?? 3;
  const scoreOf = new Map<string, number>();
  for (const a of valid) {
    const r = ratings.find((x) => x.artistId === a.id);
    const s = r?.score ?? null;
    let w: number;
    if (s == null || s <= 0) w = UNRATED_WEIGHT; // unrated: faint filler
    else if (s >= threshold) w = s * TOP_SCALE; // top artist: dominates
    else w = s; // rated below threshold: gap filler, by score
    scoreOf.set(a.id, w);
  }

  // Stage index map.
  const stages = Array.from(new Set(valid.map((a) => a.stage)));
  const stageIdx = new Map(stages.map((s, i) => [s, i]));
  const numStages = stages.length;

  // Time grid.
  const step = STEP_MIN * MINUTE;
  const tMin = Math.floor(Math.min(...valid.map((a) => toMs(a.start))) / step) * step;
  const tMax = Math.ceil(Math.max(...valid.map((a) => toMs(a.end))) / step) * step;
  const numSteps = Math.max(0, Math.round((tMax - tMin) / step));
  if (numSteps === 0) return [];

  // For each step, per stage: the best (highest effective score) artist playing.
  // grid[t][stageIndex] = { artistId, weight } | undefined
  type Cell = { artistId: string; weight: number };
  const grid: Array<Array<Cell | undefined>> = Array.from({ length: numSteps }, () =>
    new Array<Cell | undefined>(numStages).fill(undefined),
  );
  for (const a of valid) {
    const si = stageIdx.get(a.stage)!;
    const w = scoreOf.get(a.id)!;
    const s0 = Math.max(0, Math.round((toMs(a.start) - tMin) / step));
    const s1 = Math.min(numSteps, Math.round((toMs(a.end) - tMin) / step));
    for (let t = s0; t < s1; t++) {
      const cur = grid[t][si];
      if (!cur || w > cur.weight) grid[t][si] = { artistId: a.id, weight: w };
    }
  }

  const travelSteps = Math.max(0, Math.ceil(config.travelTimeMinutes / STEP_MIN));
  const minSteps = Math.max(0, Math.ceil(config.minSlotMinutes / STEP_MIN));

  // DP over (t, pos, cd, run). `run` = consecutive steps already watched at the
  // current stage, clamped at `minSteps`. We may only stop watching / move away
  // when run === 0 (not in a block) or run >= minSteps (block long enough). This
  // bakes the minimum-slot rule into the DP, so the optimizer never starts a
  // block it can't legally finish — instead of starting it and discarding it
  // afterward (which would waste time and mis-rank the rest of the day).
  const FREE = -1;
  const RC = minSteps + 1; // run dimension
  const CC = travelSteps + 1; // cooldown dimension
  const key = (t: number, pos: number, cd: number, run: number) =>
    ((t * (numStages + 1) + (pos + 1)) * CC + cd) * RC + run;

  const memo = new Map<number, number>();
  // action: -2 = stop/idle, -1 = watch, >=1000 = start moving to (act-1000)
  const action = new Map<number, number>();

  const solve = (t: number, pos: number, cd: number, run: number): number => {
    if (t >= numSteps) return 0;
    const k = key(t, pos, cd, run);
    const cached = memo.get(k);
    if (cached !== undefined) return cached;

    let best = -Infinity;
    let bestAct = -2;
    const canLeave = run === 0 || run >= minSteps;

    if (cd > 0) {
      // Travelling toward `pos`; nothing watched this step. run stays 0.
      best = solve(t + 1, pos, cd - 1, 0);
      bestAct = -2;
    } else {
      // Option 1: watch here (continues / starts a block).
      if (pos >= 0 && grid[t][pos]) {
        const reward = grid[t][pos]!.weight * STEP_MIN;
        const v = reward + solve(t + 1, pos, 0, Math.min(run + 1, minSteps));
        if (v > best) {
          best = v;
          bestAct = -1;
        }
      }
      // Option 2: stop / stay idle — only legal if not mid-block.
      if (canLeave) {
        const v = solve(t + 1, pos, 0, 0);
        if (v > best) {
          best = v;
          bestAct = -2;
        }
      }
      // Option 3: move to another stage — also only legal if not mid-block.
      if (canLeave) {
        for (let s = 0; s < numStages; s++) {
          if (s === pos) continue;
          const cost = pos === FREE ? 0 : travelSteps;
          const v = cost === 0 ? solve(t, s, 0, 0) : solve(t + 1, s, cost - 1, 0);
          if (v > best) {
            best = v;
            bestAct = 1000 + s;
          }
        }
      }
    }

    memo.set(k, best);
    action.set(k, bestAct);
    return best;
  };

  solve(0, FREE, 0, 0);

  // Reconstruct the watched artist per step, mirroring solve() exactly.
  const watched = new Array<string | undefined>(numSteps).fill(undefined);
  let t = 0;
  let pos = FREE;
  let cd = 0;
  let run = 0;
  let guard = 0;
  while (t < numSteps && guard++ < numSteps * (numStages + 4) + 10) {
    if (cd > 0) {
      cd -= 1;
      t += 1;
      run = 0;
      continue;
    }
    const act = action.get(key(t, pos, cd, run));
    if (act === -1) {
      watched[t] = grid[t][pos]?.artistId;
      run = Math.min(run + 1, minSteps);
      t += 1;
      continue;
    }
    if (act === undefined || act === -2) {
      run = 0;
      t += 1;
      continue;
    }
    // move
    const s = act - 1000;
    const cost = pos === FREE ? 0 : travelSteps;
    run = 0;
    if (cost === 0) {
      pos = s; // arrived instantly, re-evaluate the same step
    } else {
      pos = s;
      cd = cost - 1;
      t += 1;
    }
  }

  // Collapse consecutive same-artist steps into slots.
  const slots: ScheduleSlot[] = [];
  let i = 0;
  while (i < numSteps) {
    const id = watched[i];
    if (!id) {
      i++;
      continue;
    }
    let j = i;
    while (j < numSteps && watched[j] === id) j++;
    slots.push({
      artistId: id,
      from: toIso(tMin + i * step),
      to: toIso(tMin + j * step),
    });
    i = j;
  }

  // Drop slots shorter than the minimum.
  const minMs = config.minSlotMinutes * MINUTE;
  return slots
    .filter((s) => toMs(s.to) - toMs(s.from) >= minMs)
    .sort((a, b) => toMs(a.from) - toMs(b.from));
}
