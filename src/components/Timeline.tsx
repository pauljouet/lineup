import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppState, useDispatch } from '../state/store';
import { MINUTE, fmtTime, snapMs, toMs, toIso, durationMin } from '../lib/time';
import { buildStageColors, colorFor } from '../lib/stageColors';
import type { Artist } from '../state/types';

// Time scale (px per minute) along the *time* axis — vertical on desktop,
// horizontal on mobile.
const PXPM_V = 1.6;
const PXPM_H = 2.4;

// Desktop (vertical) geometry.
const COL_W = 156; // stage column width
const COL_GAP = 8;
const HEADER_H = 32; // sticky stage-header row
const TOP_PAD = 8;
const GUTTER = 56; // left time-label column

// Mobile (horizontal) geometry.
const ROW_GAP = 8;
const ROW_H_FALLBACK = 56; // lane height before the viewport is measured
const TIME_HDR = 24; // top time-label row
const STAGE_LBL_W = 80; // sticky left stage-label column

const HANDLE = 10; // px grab size for resize handles
const SNAP = 5;
const MIN_DUR = 5; // minutes
const DRAG_THRESH = 4; // px of motion before an (armed) press counts as a drag
const TAP_SLOP = 8; // px of motion under which a touch still counts as a tap
const HOLD_TO_DRAG_MS = 350; // touch hold before a set can be moved / trimmed
const POP_W = 256; // note popover width

const TOP_OPACITY = 0.42; // backdrop for top (>= threshold) artists
const LOW_OPACITY = 0.12; // backdrop for low-rated / unrated artists

/** True on phone-sized viewports, where we switch to the horizontal layout. */
function useIsMobile() {
  const query = '(max-width: 640px)';
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

/** Live clientHeight of an element, so the horizontal lanes can fill it. */
function useMeasuredHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  return [ref, h] as const;
}

type DragMode = 'move' | 'start' | 'end';

/** A press in flight. Lives in a ref so it survives the re-renders each
 *  attendance edit triggers; only `grabbing` (touch-action toggle) is state. */
type Gesture = {
  artistId: string;
  mode: DragMode;
  origFrom: number;
  origTo: number;
  setLo: number;
  setHi: number;
  startX: number;
  startY: number;
  moved: boolean;
  armed: boolean; // mouse: immediately; touch: after the hold fires
  pointerType: string;
  pointerId: number;
  svg: SVGSVGElement;
};

export default function Timeline() {
  const { artists, ratings, slots, config } = useAppState();
  const dispatch = useDispatch();
  const horizontal = useIsMobile();
  const [fullscreen, setFullscreen] = useState(false);
  const [scrollRef, viewH] = useMeasuredHeight<HTMLDivElement>();

  const gesture = useRef<Gesture | null>(null);
  const pressTimer = useRef<number | null>(null);

  // React's pointermove can be uncancelable once the browser claims a pan, so
  // we block scrolling at the source: a non-passive touchmove listener that
  // preventDefaults while a trim is armed. (touch-action alone is latched at
  // touchstart and ignores our mid-gesture flip.)
  const detach = useRef<(() => void) | null>(null);
  const bindSvg = useCallback((node: SVGSVGElement | null) => {
    detach.current?.();
    detach.current = null;
    if (!node) return;
    const onTouchMove = (e: TouchEvent) => {
      if (gesture.current?.armed && e.cancelable) e.preventDefault();
    };
    node.addEventListener('touchmove', onTouchMove, { passive: false });
    detach.current = () => node.removeEventListener('touchmove', onTouchMove);
  }, []);
  // The edge currently being trimmed — drives the handle highlight and the
  // touch-action lock. Null when no trim is in progress.
  const [held, setHeld] = useState<{ artistId: string; mode: DragMode } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null); // note popover

  const threshold = config.displayThreshold ?? 3;

  // While fullscreen: leave on Escape, and lock the page so the overlay (a
  // body-level portal) maps to the visual viewport rather than any wider
  // scrolled layout.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFullscreen(false);
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [fullscreen]);

  const ratingById = useMemo(() => {
    const m = new Map<string, { score: number | null; comment: string }>();
    for (const r of ratings) m.set(r.artistId, { score: r.score, comment: r.comment });
    return m;
  }, [ratings]);

  const slotByArtist = useMemo(() => {
    const m = new Map<string, { from: string; to: string }>();
    for (const s of slots) m.set(s.artistId, { from: s.from, to: s.to });
    return m;
  }, [slots]);

  const stages = useMemo(
    () => Array.from(new Set(artists.map((a) => a.stage))).sort(),
    [artists],
  );
  const stageColors = useMemo(() => buildStageColors(stages), [stages]);
  const colIndex = useMemo(() => new Map(stages.map((s, i) => [s, i])), [stages]);

  const { t0, t1 } = useMemo(() => {
    const times: number[] = [];
    for (const a of artists) times.push(toMs(a.start), toMs(a.end));
    if (times.length === 0) {
      const now = Date.now();
      return { t0: now, t1: now + 4 * 3_600_000 };
    }
    const HOUR = 3_600_000;
    return {
      t0: Math.floor(Math.min(...times) / HOUR) * HOUR,
      t1: Math.ceil(Math.max(...times) / HOUR) * HOUR,
    };
  }, [artists]);

  // --- geometry: one set of helpers, two orientations ---
  const PX_PER_MIN = horizontal ? PXPM_H : PXPM_V;
  const stageCount = Math.max(1, stages.length);
  // Horizontal lanes stretch to fill the measured viewport height.
  const laneFit = Math.floor((viewH - TIME_HDR - 6) / stageCount) - ROW_GAP;
  const ROW_H = viewH > 0 ? Math.max(40, laneFit) : ROW_H_FALLBACK;
  const LANE = horizontal ? ROW_H : COL_W; // cross-axis size per stage
  const LANE_GAP = horizontal ? ROW_GAP : COL_GAP;
  const mainOrigin = horizontal ? 0 : TOP_PAD; // where t0 sits on the time axis
  const crossOrigin = horizontal ? TIME_HDR : GUTTER; // where lane 0 starts

  const mainPos = (ms: number) => mainOrigin + ((ms - t0) / MINUTE) * PX_PER_MIN;
  const laneStart = (i: number) => crossOrigin + i * (LANE + LANE_GAP);
  const mainExtent = ((t1 - t0) / MINUTE) * PX_PER_MIN;
  const crossExtent = stages.length * (LANE + LANE_GAP);

  /** Pixel box for a set on a given lane, between two timestamps. */
  const boxOf = (lane: number, fromMs: number, toMs_: number) => {
    const m0 = mainPos(fromMs);
    const mLen = Math.max(2, ((toMs_ - fromMs) / MINUTE) * PX_PER_MIN);
    const c0 = laneStart(lane) + 2;
    const cLen = LANE - 4;
    return horizontal
      ? { x: m0, y: c0, w: mLen, h: cLen }
      : { x: c0, y: m0, w: cLen, h: mLen };
  };

  const svgW = horizontal ? mainExtent + 16 : GUTTER + crossExtent;
  const svgH = horizontal ? TIME_HDR + crossExtent + 6 : TOP_PAD + mainExtent + 16;

  const conflicting = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < slots.length; i++)
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i],
          b = slots[j];
        if (toMs(a.from) < toMs(b.to) && toMs(b.from) < toMs(a.to)) {
          set.add(a.artistId);
          set.add(b.artistId);
        }
      }
    return set;
  }, [slots]);

  const travelTight = useMemo(() => {
    const order = [...slots].sort((a, b) => toMs(a.from) - toMs(b.from));
    const stageOf = (id: string) => artists.find((a) => a.id === id)?.stage;
    const set = new Set<string>();
    for (let k = 1; k < order.length; k++) {
      const prev = order[k - 1];
      const cur = order[k];
      const ps = stageOf(prev.artistId);
      const cs = stageOf(cur.artistId);
      if (ps && cs && ps !== cs) {
        const gapMin = (toMs(cur.from) - toMs(prev.to)) / MINUTE;
        if (gapMin < config.travelTimeMinutes) set.add(cur.artistId);
      }
    }
    return set;
  }, [slots, artists, config.travelTimeMinutes]);

  // --- press handling (attendance editing) ---
  // The whole SVG owns the pointer handlers; the rect under the finger is found
  // via data-attributes.
  //   Tap (no movement)            → toggle the set in/out of the plan.
  //   Swipe / drag without holding  → scroll the timeline (never toggles).
  //   Hold ~350ms, then drag        → move the set, or trim it from an edge.
  // Mouse keeps the simpler desktop model: click toggles, drag edits at once.
  const dragParams = (artistId: string) => {
    const a = artists.find((x) => x.id === artistId);
    if (!a) return null;
    const setLo = toMs(a.start);
    const setHi = toMs(a.end);
    const slot = slotByArtist.get(artistId);
    // Resizing only happens on attended sets, so a slot is present then. A
    // 'move' on a not-yet-attended set scrubs in a slot the size of the set.
    const origFrom = slot ? toMs(slot.from) : setLo;
    const origTo = slot ? toMs(slot.to) : setHi;
    return { setLo, setHi, origFrom, origTo };
  };

  const clearTimer = () => {
    if (pressTimer.current != null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  // Touch hold elapsed without scrolling → the edge is now grabbable.
  const armGesture = () => {
    const g = gesture.current;
    if (!g || g.armed) return;
    g.armed = true;
    try {
      g.svg.setPointerCapture?.(g.pointerId);
    } catch {
      /* element may have unmounted */
    }
    setHeld({ artistId: g.artistId, mode: g.mode });
    navigator.vibrate?.(15);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const el = (e.target as Element).closest?.('[data-artist]');
    if (!el) return; // empty space → let the browser scroll
    const artistId = el.getAttribute('data-artist');
    const mode = (el.getAttribute('data-mode') as DragMode) || 'move';
    if (!artistId) return;
    const p = dragParams(artistId);
    if (!p) return;

    const isMouse = e.pointerType === 'mouse';
    const isEdge = mode === 'start' || mode === 'end';
    gesture.current = {
      artistId,
      mode,
      ...p,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      armed: isMouse && isEdge, // only edges drag; the body is tap-only
      pointerType: e.pointerType,
      pointerId: e.pointerId,
      svg: e.currentTarget,
    };
    // Mouse trims an edge immediately; touch trims after a brief hold. A press
    // on the body never drags — it either taps (toggle) or scrolls.
    if (!isEdge) return;
    if (isMouse) {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setHeld({ artistId, mode });
    } else {
      pressTimer.current = window.setTimeout(armGesture, HOLD_TO_DRAG_MS);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;

    if (!g.armed) {
      // Touch, still waiting on the hold: real movement means a swipe, so this
      // is a scroll, not an edit — drop the hold and let the browser scroll.
      if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > TAP_SLOP) {
        g.moved = true;
        clearTimer();
      }
      return; // no preventDefault → native scrolling stays smooth
    }

    const dPx = horizontal ? e.clientX - g.startX : e.clientY - g.startY;
    if (!g.moved && Math.abs(dPx) < DRAG_THRESH) return;
    g.moved = true;

    const deltaMs = (dPx / PX_PER_MIN) * MINUTE;
    const { setLo, setHi, origFrom, origTo } = g;
    let from = origFrom;
    let to = origTo;
    if (g.mode === 'move') {
      const dur = origTo - origFrom;
      from = snapMs(origFrom + deltaMs, SNAP);
      from = Math.max(setLo, Math.min(from, setHi - dur));
      to = from + dur;
    } else if (g.mode === 'start') {
      from = snapMs(origFrom + deltaMs, SNAP);
      from = Math.max(setLo, Math.min(from, origTo - MIN_DUR * MINUTE));
    } else {
      to = snapMs(origTo + deltaMs, SNAP);
      to = Math.min(setHi, Math.max(to, origFrom + MIN_DUR * MINUTE));
    }
    dispatch({ type: 'SET_ATTENDANCE', artistId: g.artistId, from: toIso(from), to: toIso(to) });
    if (e.cancelable) e.preventDefault(); // suppress scroll while dragging
  };

  // toggleIfTap is false on pointercancel: the browser claimed the gesture
  // (it started scrolling), so it was never a tap.
  const endPress = (toggleIfTap: boolean) => {
    clearTimer();
    const g = gesture.current;
    if (g) {
      const wasTap = !g.moved && (g.pointerType === 'mouse' || !g.armed);
      if (toggleIfTap && wasTap) dispatch({ type: 'TOGGLE_ATTENDANCE', artistId: g.artistId });
      try {
        g.svg.releasePointerCapture?.(g.pointerId);
      } catch {
        /* ignore */
      }
    }
    gesture.current = null;
    setHeld(null);
  };

  const toggleNote = (id: string) => setOpenId((p) => (p === id ? null : id));

  const hours: number[] = [];
  for (let t = t0; t <= t1; t += 3_600_000) hours.push(t);

  if (artists.length === 0)
    return <p className="text-slate-400">Add artists in the Timetable tab first.</p>;

  const activeArtist = openId ? artists.find((a) => a.id === openId) ?? null : null;

  let popStyle: React.CSSProperties | null = null;
  if (activeArtist) {
    const col = colIndex.get(activeArtist.stage) ?? 0;
    const b = boxOf(col, toMs(activeArtist.start), toMs(activeArtist.end));
    if (horizontal) {
      // Relative to the flex row: the sticky label column shifts the SVG right
      // by STAGE_LBL_W. Open below the set, or above if near the floor.
      const below = b.y + b.h + 6 + 150 <= svgH;
      const top = below ? b.y + b.h + 6 : Math.max(4, b.y - 156);
      const left = Math.min(
        Math.max(STAGE_LBL_W + b.x, STAGE_LBL_W + 4),
        STAGE_LBL_W + svgW - POP_W - 4,
      );
      popStyle = { position: 'absolute', left: Math.max(4, left), top, width: POP_W };
    } else {
      const rightFits = b.x + COL_W + 6 + POP_W <= svgW;
      const left = rightFits ? b.x + COL_W + 6 : Math.max(4, b.x - POP_W - 6);
      popStyle = { position: 'absolute', left, top: HEADER_H + b.y, width: POP_W };
    }
  }

  // One set, drawn the same way in both orientations (geometry comes from boxOf).
  const renderArtist = (a: Artist) => {
    const lane = colIndex.get(a.stage);
    if (lane == null) return null;
    const c = colorFor(stageColors, a.stage);
    const setLo = toMs(a.start);
    const setHi = toMs(a.end);
    const b = boxOf(lane, setLo, setHi);

    const rating = ratingById.get(a.id);
    const score = rating?.score ?? null;
    const isTop = score != null && score >= threshold;
    const slot = slotByArtist.get(a.id);
    const attended = !!slot;
    const backdropOpacity = isTop ? TOP_OPACITY : LOW_OPACITY;
    const labelFill = isTop ? '#f1f5f9' : '#64748b';

    const isConflict = conflicting.has(a.id);
    const isTight = travelTight.has(a.id);

    // Room for labels, measured along the time axis (block height when
    // vertical, width when horizontal).
    const along = horizontal ? b.w : b.h;
    const clipId = `clip-${a.id}`;

    return (
      <g key={a.id}>
        {horizontal && (
          <clipPath id={clipId}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={5} />
          </clipPath>
        )}

        {/* Backdrop = real set; tap to attend when not yet in the plan. */}
        <rect
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx={5}
          fill={c.fill}
          fillOpacity={backdropOpacity}
          stroke={c.border}
          strokeOpacity={isTop ? 0.5 : 0.25}
          strokeWidth={1}
          data-artist={attended ? undefined : a.id}
          data-mode={attended ? undefined : 'move'}
          style={{ cursor: attended ? 'default' : 'pointer' }}
        />

        {/* Attendance overlay = the part you'll catch (full color). */}
        {attended && slot && (() => {
          const ob = boxOf(lane, toMs(slot.from), toMs(slot.to));
          const stroke = isConflict ? '#f87171' : isTight ? '#fbbf24' : c.border;
          const sw = isConflict ? 3 : isTight ? 2 : 1.5;
          return (
            <>
              <rect
                x={ob.x}
                y={ob.y}
                width={ob.w}
                height={ob.h}
                rx={5}
                fill={c.fill}
                stroke={stroke}
                strokeWidth={sw}
                data-artist={a.id}
                data-mode="move"
                style={{ cursor: 'pointer' }}
              />
              {isConflict && (
                <rect
                  x={ob.x}
                  y={ob.y}
                  width={ob.w}
                  height={ob.h}
                  rx={5}
                  fill="#ef4444"
                  opacity={0.22}
                  style={{ pointerEvents: 'none' }}
                />
              )}
            </>
          );
        })()}

        {/* Labels. Vertical stacks rating / name / time top-down; horizontal
            does the same but clipped to the (short, wide) block. */}
        <g clipPath={horizontal ? `url(#${clipId})` : undefined} style={{ pointerEvents: 'none' }}>
          {along >= (horizontal ? 30 : 28) && (
            <text
              x={b.x + 6}
              y={b.y + 13}
              fontSize={11}
              fontWeight={600}
              fill={score != null ? '#fbbf24' : '#475569'}
            >
              {score != null ? '★'.repeat(score) : '☆'}
            </text>
          )}
          {along >= (horizontal ? 30 : 14) && (
            <text
              x={b.x + 6}
              y={b.y + (along >= 28 ? 27 : 14)}
              fill={attended ? '#f8fafc' : labelFill}
              fontSize={11}
              fontWeight={attended || isTop ? 600 : 400}
            >
              {a.name}
            </text>
          )}
          {b.h >= 42 && along >= (horizontal ? 60 : 42) && (
            <text x={b.x + 6} y={b.y + 41} fill={attended ? '#e2e8f0' : labelFill} fontSize={10}>
              {attended && slot
                ? `${fmtTime(slot.from)}–${fmtTime(slot.to)} · ${Math.round(
                    durationMin(slot.from, slot.to),
                  )}m${isTight ? ' · ⚠ travel' : ''}`
                : `${fmtTime(a.start)}–${fmtTime(a.end)}`}
            </text>
          )}
        </g>

        {/* Trim handles on the attendance overlay's time-axis edges. Each is a
            big invisible hit target plus a visible grip that brightens and
            grows while held, so it's clear what you've grabbed. */}
        {attended && slot && (() => {
          const ob = boxOf(lane, toMs(slot.from), toMs(slot.to));
          const span = horizontal ? ob.w : ob.h;
          if (span < 2 * HANDLE) return null; // too small to split into two edges
          const cursor = horizontal ? 'ew-resize' : 'ns-resize';

          const hit = (mode: 'start' | 'end') =>
            horizontal
              ? { x: mode === 'start' ? ob.x : ob.x + ob.w - HANDLE, y: ob.y, width: HANDLE, height: ob.h }
              : { x: ob.x, y: mode === 'start' ? ob.y : ob.y + ob.h - HANDLE, width: ob.w, height: HANDLE };

          const grip = (mode: 'start' | 'end') => {
            const active = held?.artistId === a.id && held.mode === mode;
            if (horizontal) {
              const h = active ? 30 : 22;
              const w = active ? 6 : 4;
              const x = mode === 'start' ? ob.x + 2 : ob.x + ob.w - 2 - w;
              return { x, y: ob.y + ob.h / 2 - h / 2, width: w, height: h, active };
            }
            const w = active ? 40 : 30;
            const h = active ? 6 : 4;
            const y = mode === 'start' ? ob.y + 2 : ob.y + ob.h - 2 - h;
            return { x: ob.x + ob.w / 2 - w / 2, y, width: w, height: h, active };
          };

          return (['start', 'end'] as const).map((mode) => {
            const g = grip(mode);
            return (
              <g key={mode}>
                <rect
                  {...hit(mode)}
                  fill="transparent"
                  data-artist={a.id}
                  data-mode={mode}
                  style={{ cursor }}
                />
                <rect
                  x={g.x}
                  y={g.y}
                  width={g.width}
                  height={g.height}
                  rx={3}
                  fill="#f8fafc"
                  stroke="#0f172a"
                  strokeWidth={0.75}
                  opacity={g.active ? 1 : 0.6}
                  style={{ pointerEvents: 'none' }}
                />
              </g>
            );
          });
        })()}

        {/* Info button (top-right) — opens notes/rating. Drawn last so it wins
            its corner. stopPropagation keeps it from starting a drag/scroll. */}
        {along >= (horizontal ? 30 : 14) && (
          <g
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleNote(a.id);
            }}
            style={{ cursor: 'pointer' }}
          >
            <circle
              cx={b.x + b.w - 12}
              cy={b.y + 11}
              r={8}
              fill={openId === a.id ? '#1e293b' : '#0f172a'}
              fillOpacity={0.65}
              stroke="#94a3b8"
              strokeWidth={1}
            />
            <text
              x={b.x + b.w - 12}
              y={b.y + 15}
              textAnchor="middle"
              fontSize={11}
              fontWeight={700}
              fill="#cbd5e1"
              style={{ pointerEvents: 'none' }}
            >
              i
            </text>
            <title>Notes &amp; rating</title>
          </g>
        )}
      </g>
    );
  };

  const svg = (
    <svg
      ref={bindSvg}
      width={svgW}
      height={svgH}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => endPress(true)}
      onPointerCancel={() => endPress(false)}
      style={{
        touchAction: held ? 'none' : 'pan-x pan-y',
        userSelect: 'none',
        display: 'block',
      }}
    >
      {hours.map((t) =>
        horizontal ? (
          <g key={t}>
            <line x1={mainPos(t)} y1={TIME_HDR} x2={mainPos(t)} y2={svgH} stroke="#1e293b" />
            <text x={mainPos(t) + 3} y={15} fill="#64748b" fontSize={11}>
              {fmtTime(toIso(t))}
            </text>
          </g>
        ) : (
          <g key={t}>
            <line x1={GUTTER} y1={mainPos(t)} x2={svgW} y2={mainPos(t)} stroke="#1e293b" />
            <text x={6} y={mainPos(t) + 4} fill="#64748b" fontSize={11}>
              {fmtTime(toIso(t))}
            </text>
          </g>
        ),
      )}
      {artists.map(renderArtist)}
    </svg>
  );

  const note = activeArtist && popStyle && (
    <NotePopover
      artist={activeArtist}
      score={ratingById.get(activeArtist.id)?.score ?? null}
      comment={ratingById.get(activeArtist.id)?.comment ?? ''}
      style={popStyle}
      onRate={(n) => dispatch({ type: 'SET_RATING', artistId: activeArtist.id, patch: { score: n } })}
      onComment={(text) =>
        dispatch({ type: 'SET_RATING', artistId: activeArtist.id, patch: { comment: text } })
      }
      onClose={() => setOpenId(null)}
    />
  );

  // Body differs by orientation; the outer chrome (fullscreen wrap + toggle) is
  // shared.
  let body: React.ReactNode;
  if (!horizontal) {
    body = (
      <div
        ref={scrollRef}
        className="overflow-auto rounded border border-slate-700 bg-slate-900/50"
        style={fullscreen ? { flex: '1 1 0', minHeight: 0 } : { maxHeight: '75vh' }}
      >
        <div className="relative" style={{ width: svgW }}>
          <div
            className="sticky top-0 z-10 flex bg-slate-900/95 backdrop-blur"
            style={{ height: HEADER_H }}
          >
            <div style={{ width: GUTTER, flex: '0 0 auto' }} />
            {stages.map((stage) => {
              const c = colorFor(stageColors, stage);
              return (
                <div
                  key={stage}
                  className="flex items-center justify-center truncate px-2 text-xs font-medium text-white"
                  style={{
                    width: COL_W,
                    marginRight: COL_GAP,
                    flex: '0 0 auto',
                    background: c.fill,
                    borderBottom: `2px solid ${c.border}`,
                  }}
                  title={stage}
                >
                  {stage}
                </div>
              );
            })}
          </div>
          {svg}
          {note}
        </div>
      </div>
    );
  } else {
    body = (
      <div
        ref={scrollRef}
        className="overflow-x-auto rounded border border-slate-700 bg-slate-900/50"
        style={fullscreen ? { flex: '1 1 0', minHeight: 0 } : { height: '72vh' }}
      >
        <div className="relative flex" style={{ width: STAGE_LBL_W + svgW, height: svgH }}>
          <div
            className="sticky left-0 z-10 shrink-0 bg-slate-900/95 backdrop-blur"
            style={{ width: STAGE_LBL_W, height: svgH }}
          >
            {stages.map((stage, i) => {
              const c = colorFor(stageColors, stage);
              return (
                <div
                  key={stage}
                  className="absolute flex items-center truncate px-2 text-xs font-medium text-white"
                  style={{
                    top: laneStart(i) + 2,
                    height: LANE - 4,
                    width: STAGE_LBL_W,
                    background: c.fill,
                    borderRight: `2px solid ${c.border}`,
                  }}
                  title={stage}
                >
                  {stage}
                </div>
              );
            })}
          </div>
          {svg}
          {note}
        </div>
      </div>
    );
  }

  const headerBar = (
    <div className="mb-2 flex items-center gap-2">
      {fullscreen && <span className="text-sm font-medium text-slate-300">Schedule</span>}
      <button
        onClick={() => setFullscreen((f) => !f)}
        className="ml-auto rounded border border-slate-600 px-3 py-1 text-sm hover:bg-slate-800"
      >
        {fullscreen ? '✕ Exit full screen' : '⤢ Full screen'}
      </button>
    </div>
  );

  // Fullscreen renders into a body-level portal so no ancestor (transform,
  // filter, or a horizontally-scrolled page) can shift or shrink the overlay.
  if (fullscreen)
    return createPortal(
      <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 p-2">
        {headerBar}
        {body}
      </div>,
      document.body,
    );

  return (
    <div>
      {headerBar}
      {body}
    </div>
  );
}

function NotePopover({
  artist,
  score,
  comment,
  style,
  onRate,
  onComment,
  onClose,
}: {
  artist: Artist;
  score: number | null;
  comment: string;
  style: React.CSSProperties;
  onRate: (n: number | null) => void;
  onComment: (text: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      style={style}
      className="z-20 rounded-lg border border-slate-600 bg-slate-800 p-3 text-sm shadow-xl"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold text-slate-100">{artist.name}</div>
          <div className="text-xs text-slate-400">
            {artist.stage} · {fmtTime(artist.start)}–{fmtTime(artist.end)}
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded px-1 text-slate-400 hover:text-slate-200"
          title="Close"
        >
          ✕
        </button>
      </div>

      <div className="mt-2 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onRate(score === n ? null : n)}
            className={`text-lg leading-none ${
              score != null && n <= score ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'
            }`}
            title={`${n} star${n > 1 ? 's' : ''}`}
          >
            ★
          </button>
        ))}
        {score == null && <span className="ml-1 text-xs text-amber-400">unrated</span>}
      </div>

      <textarea
        value={comment}
        onChange={(e) => onComment(e.target.value)}
        placeholder="Notes…"
        rows={3}
        className="mt-2 w-full resize-y rounded bg-slate-900 px-2 py-1 text-slate-200 placeholder:text-slate-500"
      />
    </div>
  );
}
