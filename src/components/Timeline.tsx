import { useMemo, useState } from 'react';
import { useAppState, useDispatch } from '../state/store';
import { MINUTE, fmtTime, snapMs, toMs, toIso, durationMin } from '../lib/time';
import { buildStageColors, colorFor } from '../lib/stageColors';
import type { Artist } from '../state/types';

const PX_PER_MIN = 1.6; // vertical scale
const COL_W = 156;
const COL_GAP = 8;
const HEADER_H = 32; // sticky stage-header row
const TOP_PAD = 8;
const GUTTER = 56; // left time-label column
const HANDLE = 8; // px grab height for resize handles
const SNAP = 5;
const MIN_DUR = 5; // minutes
const DRAG_THRESH = 4; // px of motion before a press counts as a drag, not a click
const POP_W = 256; // note popover width

const TOP_OPACITY = 0.42; // backdrop for top (>= threshold) artists
const LOW_OPACITY = 0.12; // backdrop for low-rated / unrated artists

type DragMode = 'move' | 'start' | 'end';
type Drag = {
  artistId: string;
  mode: DragMode;
  startY: number;
  origFrom: number;
  origTo: number;
  setLo: number;
  setHi: number;
  moved: boolean;
};

export default function Timeline() {
  const { artists, ratings, slots, config } = useAppState();
  const dispatch = useDispatch();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [openId, setOpenId] = useState<string | null>(null); // note popover

  const threshold = config.displayThreshold ?? 3;

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

  const yFor = (ms: number) => TOP_PAD + ((ms - t0) / MINUTE) * PX_PER_MIN;
  const xForCol = (i: number) => GUTTER + i * (COL_W + COL_GAP);
  const totalW = GUTTER + stages.length * (COL_W + COL_GAP);
  const bodyH = yFor(t1) + 16;

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

  // --- drag (attendance editing) ---
  const beginDrag = (
    e: React.PointerEvent,
    artistId: string,
    mode: DragMode,
    setLo: number,
    setHi: number,
    origFrom: number,
    origTo: number,
  ) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ artistId, mode, startY: e.clientY, origFrom, origTo, setLo, setHi, moved: false });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dyPx = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dyPx) < DRAG_THRESH) return;
    if (!drag.moved) setDrag({ ...drag, moved: true });

    const deltaMs = (dyPx / PX_PER_MIN) * MINUTE;
    const { setLo, setHi, origFrom, origTo } = drag;
    let from = origFrom;
    let to = origTo;
    if (drag.mode === 'move') {
      const dur = origTo - origFrom;
      from = snapMs(origFrom + deltaMs, SNAP);
      from = Math.max(setLo, Math.min(from, setHi - dur));
      to = from + dur;
    } else if (drag.mode === 'start') {
      from = snapMs(origFrom + deltaMs, SNAP);
      from = Math.max(setLo, Math.min(from, origTo - MIN_DUR * MINUTE));
    } else {
      to = snapMs(origTo + deltaMs, SNAP);
      to = Math.min(setHi, Math.max(to, origFrom + MIN_DUR * MINUTE));
    }
    dispatch({ type: 'SET_ATTENDANCE', artistId: drag.artistId, from: toIso(from), to: toIso(to) });
  };

  const endDrag = () => {
    if (drag && !drag.moved) {
      dispatch({ type: 'TOGGLE_ATTENDANCE', artistId: drag.artistId });
    }
    setDrag(null);
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
    const blockLeft = xForCol(col);
    const rightFits = blockLeft + COL_W + 6 + POP_W <= totalW;
    const left = rightFits ? blockLeft + COL_W + 6 : Math.max(4, blockLeft - POP_W - 6);
    const top = HEADER_H + yFor(toMs(activeArtist.start));
    popStyle = { position: 'absolute', left, top, width: POP_W };
  }

  return (
    <div className="max-h-[75vh] overflow-auto rounded border border-slate-700 bg-slate-900/50">
      <div className="relative" style={{ width: totalW }}>
        {/* Sticky stage headers */}
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

        <svg
          width={totalW}
          height={bodyH}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          style={{ touchAction: 'none', userSelect: 'none', display: 'block' }}
        >
          {hours.map((t) => (
            <g key={t}>
              <line x1={GUTTER} y1={yFor(t)} x2={totalW} y2={yFor(t)} stroke="#1e293b" />
              <text x={6} y={yFor(t) + 4} fill="#64748b" fontSize={11}>
                {fmtTime(toIso(t))}
              </text>
            </g>
          ))}

          {artists.map((a) => {
            const col = colIndex.get(a.stage);
            if (col == null) return null;
            const c = colorFor(stageColors, a.stage);
            const x = xForCol(col) + 2;
            const w = COL_W - 4;
            const setLo = toMs(a.start);
            const setHi = toMs(a.end);
            const by = yFor(setLo);
            const bh = Math.max(2, ((setHi - setLo) / MINUTE) * PX_PER_MIN);

            const rating = ratingById.get(a.id);
            const score = rating?.score ?? null;
            const isTop = score != null && score >= threshold;
            const slot = slotByArtist.get(a.id);
            const attended = !!slot;
            const backdropOpacity = isTop ? TOP_OPACITY : LOW_OPACITY;
            const labelFill = isTop ? '#f1f5f9' : '#64748b';

            const isConflict = conflicting.has(a.id);
            const isTight = travelTight.has(a.id);

            return (
              <g key={a.id}>
                {/* Backdrop = real set; click to attend when not yet in the plan. */}
                <rect
                  x={x}
                  y={by}
                  width={w}
                  height={bh}
                  rx={5}
                  fill={c.fill}
                  fillOpacity={backdropOpacity}
                  stroke={c.border}
                  strokeOpacity={isTop ? 0.5 : 0.25}
                  strokeWidth={1}
                  onPointerDown={
                    attended
                      ? undefined
                      : (e) => beginDrag(e, a.id, 'move', setLo, setHi, setLo, setHi)
                  }
                  style={{ cursor: attended ? 'default' : 'pointer' }}
                />

                {/* Attendance overlay = the part you'll catch (full color). */}
                {attended && slot && (() => {
                  const sf = toMs(slot.from);
                  const st = toMs(slot.to);
                  const oy = yFor(sf);
                  const oh = Math.max(2, ((st - sf) / MINUTE) * PX_PER_MIN);
                  const stroke = isConflict ? '#f87171' : isTight ? '#fbbf24' : c.border;
                  const sw = isConflict ? 3 : isTight ? 2 : 1.5;
                  return (
                    <>
                      <rect
                        x={x}
                        y={oy}
                        width={w}
                        height={oh}
                        rx={5}
                        fill={c.fill}
                        stroke={stroke}
                        strokeWidth={sw}
                        onPointerDown={(e) => beginDrag(e, a.id, 'move', setLo, setHi, sf, st)}
                        style={{ cursor: 'grab' }}
                      />
                      {isConflict && (
                        <rect
                          x={x}
                          y={oy}
                          width={w}
                          height={oh}
                          rx={5}
                          fill="#ef4444"
                          opacity={0.22}
                          style={{ pointerEvents: 'none' }}
                        />
                      )}
                    </>
                  );
                })()}

                {/* Rating (line 1), name (line 2), time (line 3). Name always
                    wins when the block is too short for the rating line. */}
                {bh >= 28 && (
                  <text
                    x={x + 6}
                    y={by + 13}
                    fontSize={11}
                    fontWeight={600}
                    fill={score != null ? '#fbbf24' : '#475569'}
                    style={{ pointerEvents: 'none' }}
                  >
                    {score != null ? '★'.repeat(score) : '☆'}
                  </text>
                )}
                {bh >= 14 && (
                  <text
                    x={x + 6}
                    y={by + (bh >= 28 ? 27 : 14)}
                    fill={attended ? '#f8fafc' : labelFill}
                    fontSize={11}
                    fontWeight={attended || isTop ? 600 : 400}
                    style={{ pointerEvents: 'none' }}
                  >
                    {a.name}
                  </text>
                )}
                {bh >= 42 && (
                  <text
                    x={x + 6}
                    y={by + 41}
                    fill={attended ? '#e2e8f0' : labelFill}
                    fontSize={10}
                    style={{ pointerEvents: 'none' }}
                  >
                    {attended && slot
                      ? `${fmtTime(slot.from)}–${fmtTime(slot.to)} · ${Math.round(
                          durationMin(slot.from, slot.to),
                        )}m${isTight ? ' · ⚠ travel' : ''}`
                      : `${fmtTime(a.start)}–${fmtTime(a.end)}`}
                  </text>
                )}

                {/* Resize handles on the attendance overlay (drawn under the info button). */}
                {attended && slot && (
                  <>
                    <rect
                      x={x}
                      y={yFor(toMs(slot.from))}
                      width={w}
                      height={HANDLE}
                      fill="transparent"
                      onPointerDown={(e) =>
                        beginDrag(e, a.id, 'start', setLo, setHi, toMs(slot.from), toMs(slot.to))
                      }
                      style={{ cursor: 'ns-resize' }}
                    />
                    <rect
                      x={x}
                      y={yFor(toMs(slot.to)) - HANDLE}
                      width={w}
                      height={HANDLE}
                      fill="transparent"
                      onPointerDown={(e) =>
                        beginDrag(e, a.id, 'end', setLo, setHi, toMs(slot.from), toMs(slot.to))
                      }
                      style={{ cursor: 'ns-resize' }}
                    />
                  </>
                )}

                {/* Info button (top-right) — opens notes/rating. Same neutral “i”
                    for every set. Drawn last so it wins its corner. */}
                {bh >= 14 && (
                  <g
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleNote(a.id);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <circle
                      cx={x + w - 12}
                      cy={by + 11}
                      r={8}
                      fill={openId === a.id ? '#1e293b' : '#0f172a'}
                      fillOpacity={0.65}
                      stroke="#94a3b8"
                      strokeWidth={1}
                    />
                    <text
                      x={x + w - 12}
                      y={by + 15}
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
          })}
        </svg>

        {activeArtist && popStyle && (
          <NotePopover
            artist={activeArtist}
            score={ratingById.get(activeArtist.id)?.score ?? null}
            comment={ratingById.get(activeArtist.id)?.comment ?? ''}
            style={popStyle}
            onRate={(n) =>
              dispatch({ type: 'SET_RATING', artistId: activeArtist.id, patch: { score: n } })
            }
            onComment={(text) =>
              dispatch({ type: 'SET_RATING', artistId: activeArtist.id, patch: { comment: text } })
            }
            onClose={() => setOpenId(null)}
          />
        )}
      </div>
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
