import { useState, useRef } from 'react';
import { useAppState, useDispatch, validateState } from '../state/store';
import Timeline from '../components/Timeline';
import { itineraryLibrary } from '../lib/library';
import type { AppState } from '../state/types';

export default function ScheduleView() {
  const state = useAppState();
  const dispatch = useDispatch();
  const importRef = useRef<HTMLInputElement>(null);
  const [showItineraries, setShowItineraries] = useState(false);
  const { config, artists, slots } = state;

  // Replace the whole plan with a saved state (imported file or library item).
  const applyState = (text: string, label?: string) => {
    let parsed: AppState | null;
    try {
      parsed = validateState(JSON.parse(text)) as AppState | null;
    } catch {
      alert('Could not parse JSON.');
      return false;
    }
    if (!parsed) {
      alert('Invalid file: shape did not match an exported state.');
      return false;
    }
    if (
      artists.length > 0 &&
      !window.confirm(
        `Replace your entire current plan${
          label ? ` with “${label}”` : ''
        }? This overwrites your timetable, ratings, and schedule.`,
      )
    )
      return false;
    dispatch({ type: 'REPLACE_STATE', state: parsed });
    return true;
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'festival-optimizer.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => applyState(text));
    e.target.value = '';
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <div className="mb-1 text-slate-400">Travel time (min)</div>
          <input
            type="number"
            min={0}
            className="w-24 rounded bg-slate-900 px-2 py-1"
            value={config.travelTimeMinutes}
            onChange={(e) =>
              dispatch({
                type: 'SET_CONFIG',
                patch: { travelTimeMinutes: Math.max(0, Number(e.target.value) || 0) },
              })
            }
          />
        </label>
        <label className="text-sm">
          <div className="mb-1 text-slate-400">Min per artist (min)</div>
          <input
            type="number"
            min={0}
            className="w-24 rounded bg-slate-900 px-2 py-1"
            value={config.minSlotMinutes}
            onChange={(e) =>
              dispatch({
                type: 'SET_CONFIG',
                patch: { minSlotMinutes: Math.max(0, Number(e.target.value) || 0) },
              })
            }
          />
        </label>
        <label className="text-sm">
          <div className="mb-1 text-slate-400">Top artist rating ≥</div>
          <input
            type="number"
            min={1}
            max={5}
            className="w-24 rounded bg-slate-900 px-2 py-1"
            value={config.displayThreshold}
            onChange={(e) =>
              dispatch({
                type: 'SET_CONFIG',
                patch: {
                  displayThreshold: Math.min(5, Math.max(1, Number(e.target.value) || 1)),
                },
              })
            }
          />
        </label>

        <button
          className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
          disabled={artists.length === 0}
          onClick={() => dispatch({ type: 'OPTIMIZE' })}
        >
          Optimize
        </button>

        <div className="ml-auto flex gap-2">
          <div className="relative">
            <button
              className="rounded border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-40"
              disabled={itineraryLibrary.length === 0}
              onClick={() => setShowItineraries((s) => !s)}
              title={
                itineraryLibrary.length === 0
                  ? 'No itineraries in the library yet'
                  : 'Load a shared itinerary'
              }
            >
              Load itinerary ▾
            </button>
            {showItineraries && (
              <div className="absolute right-0 z-20 mt-1 max-h-72 w-64 overflow-auto rounded border border-slate-600 bg-slate-800 p-1 shadow-xl">
                {itineraryLibrary.map((entry) => (
                  <button
                    key={entry.id}
                    className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-slate-700"
                    onClick={() => {
                      if (applyState(entry.content, entry.name)) setShowItineraries(false);
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
            onClick={exportJson}
          >
            Export JSON
          </button>
          <button
            className="rounded border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800"
            onClick={() => importRef.current?.click()}
          >
            Import JSON
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={onImport}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
        <span>The full lineup is shown, colored by stage.</span>
        <span>Bright sets are your top picks (≥ threshold); faint ones are other options.</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm ring-2 ring-red-400" />
          time conflict
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm ring-2 ring-amber-400" />
          travel too tight
        </span>
        <span className="basis-full">
          Click a set to attend it (or drop it) · drag the bright block to shift ·
          drag its top/bottom edges to trim arrival/leave · snaps to 5 min, stays within the set
        </span>
        <span className="basis-full">
          Rating (★) shows on every set. Click the ⓘ button (top-right of a set) to
          read and edit its rating and notes.
        </span>
      </div>

      <Timeline />

      {slots.length > 0 && (
        <p className="text-xs text-slate-500">{slots.length} slots scheduled.</p>
      )}
    </div>
  );
}
