import { useAppState, useDispatch } from '../state/store';
import { fmtDayTime, fmtTime, toMs } from '../lib/time';

export default function RatingView() {
  const { artists, ratings } = useAppState();
  const dispatch = useDispatch();

  const ratingFor = (id: string) =>
    ratings.find((r) => r.artistId === id) ?? { artistId: id, score: null, comment: '' };

  const sorted = [...artists].sort((a, b) => toMs(a.start) - toMs(b.start));
  const unrated = sorted.filter((a) => ratingFor(a.id).score == null).length;

  if (artists.length === 0)
    return <p className="text-slate-400">Add artists in the Timetable tab first.</p>;

  return (
    <div className="space-y-3">
      <div className="text-sm text-slate-400">
        {artists.length} artists · {unrated} unrated
      </div>
      <div className="space-y-2">
        {sorted.map((a) => {
          const r = ratingFor(a.id);
          return (
            <div
              key={a.id}
              className={`flex flex-wrap items-center gap-3 rounded border p-3 ${
                r.score == null ? 'border-amber-700/60 bg-amber-950/20' : 'border-slate-700'
              }`}
            >
              <div className="min-w-[12rem] flex-1">
                <div className="font-medium">{a.name}</div>
                <div className="text-xs text-slate-400">
                  {a.stage} · {fmtDayTime(a.start)}–{fmtTime(a.end)}
                </div>
              </div>

              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() =>
                      dispatch({
                        type: 'SET_RATING',
                        artistId: a.id,
                        patch: { score: r.score === n ? null : n },
                      })
                    }
                    className={`h-7 w-7 rounded text-lg leading-none ${
                      r.score != null && n <= r.score
                        ? 'text-amber-400'
                        : 'text-slate-600 hover:text-slate-400'
                    }`}
                    title={`${n} star${n > 1 ? 's' : ''}`}
                  >
                    ★
                  </button>
                ))}
                {r.score == null && (
                  <span className="ml-1 text-xs text-amber-400">unrated</span>
                )}
              </div>

              <input
                className="min-w-[14rem] flex-1 rounded bg-slate-900 px-2 py-1 text-sm"
                placeholder="Comment…"
                value={r.comment}
                onChange={(e) =>
                  dispatch({
                    type: 'SET_RATING',
                    artistId: a.id,
                    patch: { comment: e.target.value },
                  })
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
