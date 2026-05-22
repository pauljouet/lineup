import { useRef, useState } from "react";
import { useAppState, useDispatch } from "../state/store";
import { parseTimetableCsv } from "../lib/csv";
import { toMs, toLocalInput, fromLocalInput } from "../lib/time";
import { uuid } from "../lib/id";
import { lineupLibrary } from "../lib/library";
import type { Artist } from "../state/types";

// Prompt to hand to a vision LLM along with photo(s) of a festival timetable.
// It pins the output to the exact CSV layout parseTimetableCsv expects in
// day+clock mode: `day,stage,artist,start_time,end_time`.
const IMAGE_TO_CSV_PROMPT = `From these images of a festival line-up, generate a CSV file with exactly these columns, in this order:

day,stage,artist,start_time,end_time

Rules:
- day: the festival day as YYYY-MM-DD (e.g. 2026-05-23). Every slot of the same night carries the date of the day it starts, including slots that run past midnight.
- stage: the name of the stage.
- artist: the name of the artist.
- start_time and end_time: the start and end time in 24h HH:mm format (e.g. 13:00, 22:30, 00:00).
- One row per slot, values separated by commas, the first row holds the headers.`;

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
  const [showLibrary, setShowLibrary] = useState(false);
  const [copied, setCopied] = useState(false);

  const flagCopied = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyPrompt = async () => {
    // navigator.clipboard is only available in secure contexts (https /
    // localhost) and can reject; fall back to a hidden textarea + execCommand.
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(IMAGE_TO_CSV_PROMPT);
        flagCopied();
        return;
      }
    } catch {
      // fall through to the legacy path
    }
    const ta = document.createElement("textarea");
    ta.value = IMAGE_TO_CSV_PROMPT;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      flagCopied();
    } finally {
      document.body.removeChild(ta);
    }
  };

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
    if (res.artists.length)
      dispatch({ type: "SET_ARTISTS", artists: res.artists });
  };

  // Load a fresh CSV (file or library). Loading replaces the timetable and
  // resets ratings, so confirm when there's existing work to lose.
  const applyCsv = (text: string, label?: string) => {
    if (
      artists.length > 0 &&
      !window.confirm(
        `Replace the current timetable${
          label ? ` with “${label}”` : ""
        }? Your ratings for the current lineup will be cleared.`,
      )
    )
      return false;
    setCsvText(text);
    loadCsv(text);
    return true;
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => applyCsv(text));
    e.target.value = "";
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
    dispatch({ type: "UPDATE_ARTIST", id, patch });

  const sorted = [...artists].sort(
    (a, b) => a.stage.localeCompare(b.stage) || toMs(a.start) - toMs(b.start),
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
        <div className="relative">
          <button
            className="rounded border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-40"
            disabled={lineupLibrary.length === 0}
            onClick={() => setShowLibrary((s) => !s)}
            title={
              lineupLibrary.length === 0
                ? "No lineups in the library yet"
                : "Load a lineup from the library"
            }
          >
            Load from library ▾
          </button>
          {showLibrary && (
            <div className="absolute z-20 mt-1 max-h-72 w-64 overflow-auto rounded border border-slate-600 bg-slate-800 p-1 shadow-xl">
              {lineupLibrary.map((entry) => (
                <button
                  key={entry.id}
                  className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-slate-700"
                  onClick={() => {
                    if (applyCsv(entry.content, entry.name))
                      setShowLibrary(false);
                  }}
                >
                  {entry.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className="rounded border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800"
          onClick={() => {
            const now = new Date();
            const start = new Date(now.getTime() + 3_600_000).toISOString();
            const end = new Date(now.getTime() + 7_200_000).toISOString();
            dispatch({
              type: "ADD_ARTIST",
              artist: {
                id: uuid(),
                name: "New artist",
                stage: "Stage",
                start,
                end,
              },
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

      <div className="rounded border border-slate-700 bg-slate-800/40 p-3 text-sm">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-slate-300">
            No CSV? Give a photo of the timetable to an LLM (ChatGPT, Claude…)
            with this prompt to generate one:
          </p>
          <button
            className="shrink-0 rounded bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500"
            onClick={copyPrompt}
          >
            {copied ? "Copied ✓" : "Copy prompt"}
          </button>
        </div>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-900 p-2 text-xs text-slate-200">
          {IMAGE_TO_CSV_PROMPT}
        </pre>
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
                  ? "bg-sky-600 font-medium"
                  : "border border-slate-600 hover:bg-slate-700"
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
                changeRollover(
                  Math.min(23, Math.max(0, Number(e.target.value) || 0)),
                )
              }
              className="w-16 rounded bg-slate-900 px-2 py-1 text-slate-200"
            />
            <span>:00 — earlier times roll to the next date</span>
          </label>
        </div>
      )}

      {errors.length > 0 && (
        <div className="rounded border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-300">
          <div className="mb-1 font-medium">
            {errors.length} row(s) skipped:
          </div>
          <ul className="list-disc space-y-0.5 pl-5">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {artists.length === 0 ? (
        <p className="text-slate-400">
          No artists yet. Upload a CSV or load the sample.
        </p>
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
                        update(a.id, {
                          start: fromLocalInput(e.target.value) || a.start,
                        })
                      }
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="datetime-local"
                      className="rounded bg-slate-900 px-2 py-1"
                      value={toLocalInput(a.end)}
                      onChange={(e) =>
                        update(a.id, {
                          end: fromLocalInput(e.target.value) || a.end,
                        })
                      }
                    />
                  </td>
                  <td className="p-1 text-right">
                    <button
                      className="rounded px-2 py-1 text-rose-400 hover:bg-rose-950"
                      onClick={() =>
                        dispatch({ type: "DELETE_ARTIST", id: a.id })
                      }
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
