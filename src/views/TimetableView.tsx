import { useRef, useState } from 'react';
import { useAppState, useDispatch } from '../state/store';
import { parseTimetableCsv } from '../lib/csv';
import { toMs, toLocalInput, fromLocalInput } from '../lib/time';
import { uuid } from '../lib/id';
import type { Artist } from '../state/types';

const SAMPLE = `stage,start,end,artist
Main,2026-05-21 18:00,2026-05-21 19:00,Opener
Main,2026-05-21 19:15,2026-05-21 20:30,Headliner A
River,2026-05-21 18:30,2026-05-21 19:30,Indie Band
River,2026-05-21 19:45,2026-05-21 21:00,Headliner B
Tent,2026-05-21 18:45,2026-05-21 20:00,DJ Set`;

export default function TimetableView() {
  const { artists } = useAppState();
  const dispatch = useDispatch();
  const fileRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  // Retained CSV so re-picking a day / changing rollover re-parses the source.
  const [csvText, setCsvText] = useState<string | null>(null);
  const [days, setDays] = useState<string[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | undefined>(undefined);
  const [rolloverHour, setRolloverHour] = useState(6);

  const loadCsv = (
    text: string,
    opts: { day?: string; rolloverHour?: number } = {},
  ) => {
    const res = parseTimetableCsv(text, {
      day: opts.day,
      rolloverHour: opts.rolloverHour ?? rolloverHour,
    });
    setErrors(res.errors);
    setDays(res.days);
    setSelectedDay(res.selectedDay);
    if (res.artists.length) dispatch({ type: 'SET_ARTISTS', artists: res.artists });
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      setCsvText(text);
      loadCsv(text);
    });
    e.target.value = '';
  };

  const pickDay = (day: string) => {
    setSelectedDay(day);
    if (csvText) loadCsv(csvText, { day });
  };

  const changeRollover = (hour: number) => {
    setRolloverHour(hour);
    if (csvText) loadCsv(csvText, { day: selectedDay, rolloverHour: hour });
  };

  const update = (id: string, patch: Partial<Artist>) =>
    dispatch({ type: 'UPDATE_ARTIST', id, patch });

  const sorted = [...artists].sort(
    (a, b) =>
      a.stage.localeCompare(b.stage) || toMs(a.start) - toMs(b.start),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500"
          onClick={() => fileRef.current?.click()}
        >
          Upload CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={onFile}
        />
        <button
          className="rounded border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800"
          onClick={() => {
            setCsvText(SAMPLE);
            loadCsv(SAMPLE);
          }}
        >
          Load sample
        </button>
        <button
          className="rounded border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800"
          onClick={() => {
            const now = new Date();
            const start = new Date(now.getTime() + 3_600_000).toISOString();
            const end = new Date(now.getTime() + 7_200_000).toISOString();
            dispatch({
              type: 'ADD_ARTIST',
              artist: { id: uuid(), name: 'New artist', stage: 'Stage', start, end },
            });
          }}
        >
          + Add row
        </button>
        <span className="text-sm text-slate-400">
          Columns: <code>day, stage, artist, start_time, end_time</code> (clock
          times) or <code>stage, start, end, artist</code> (full datetimes)
        </span>
      </div>

      {days.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-slate-700 bg-slate-800/40 p-3 text-sm">
          <span className="text-slate-400">Festival day:</span>
          {days.map((d) => (
            <button
              key={d}
              onClick={() => pickDay(d)}
              className={`rounded px-2.5 py-1 ${
                d === selectedDay
                  ? 'bg-sky-600 font-medium'
                  : 'border border-slate-600 hover:bg-slate-700'
              }`}
            >
              {d}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-slate-400">
            New day starts at
            <input
              type="number"
              min={0}
              max={23}
              value={rolloverHour}
              onChange={(e) =>
                changeRollover(Math.min(23, Math.max(0, Number(e.target.value) || 0)))
              }
              className="w-16 rounded bg-slate-900 px-2 py-1 text-slate-200"
            />
            <span>:00 — earlier times roll to the next date</span>
          </label>
        </div>
      )}

      {errors.length > 0 && (
        <div className="rounded border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-300">
          <div className="mb-1 font-medium">{errors.length} row(s) skipped:</div>
          <ul className="list-disc space-y-0.5 pl-5">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {artists.length === 0 ? (
        <p className="text-slate-400">No artists yet. Upload a CSV or load the sample.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-left text-slate-300">
              <tr>
                <th className="p-2">Artist</th>
                <th className="p-2">Stage</th>
                <th className="p-2">Start</th>
                <th className="p-2">End</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => (
                <tr key={a.id} className="border-t border-slate-700">
                  <td className="p-1">
                    <input
                      className="w-full rounded bg-slate-900 px-2 py-1"
                      value={a.name}
                      onChange={(e) => update(a.id, { name: e.target.value })}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      className="w-full rounded bg-slate-900 px-2 py-1"
                      value={a.stage}
                      onChange={(e) => update(a.id, { stage: e.target.value })}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="datetime-local"
                      className="rounded bg-slate-900 px-2 py-1"
                      value={toLocalInput(a.start)}
                      onChange={(e) =>
                        update(a.id, { start: fromLocalInput(e.target.value) || a.start })
                      }
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="datetime-local"
                      className="rounded bg-slate-900 px-2 py-1"
                      value={toLocalInput(a.end)}
                      onChange={(e) =>
                        update(a.id, { end: fromLocalInput(e.target.value) || a.end })
                      }
                    />
                  </td>
                  <td className="p-1 text-right">
                    <button
                      className="rounded px-2 py-1 text-rose-400 hover:bg-rose-950"
                      onClick={() => dispatch({ type: 'DELETE_ARTIST', id: a.id })}
                      title="Delete"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
