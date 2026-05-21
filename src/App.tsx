import { useState } from 'react';
import { StoreProvider, useAppState } from './state/store';
import TimetableView from './views/TimetableView';
import RatingView from './views/RatingView';
import ScheduleView from './views/ScheduleView';

type Tab = 'timetable' | 'rating' | 'schedule';

const TABS: { id: Tab; label: string }[] = [
  { id: 'timetable', label: '1 · Timetable' },
  { id: 'rating', label: '2 · Rating' },
  { id: 'schedule', label: '3 · Schedule' },
];

function Shell() {
  const [tab, setTab] = useState<Tab>('timetable');
  const { artists } = useAppState();

  return (
    <div className="mx-auto max-w-6xl p-4">
      <header className="mb-4">
        <h1 className="text-xl font-semibold">Festival Schedule Optimizer</h1>
        <p className="text-sm text-slate-400">{artists.length} artists loaded</p>
      </header>

      <nav className="mb-5 flex gap-1 border-b border-slate-700">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${
              tab === t.id
                ? 'border-sky-500 text-sky-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'timetable' && <TimetableView />}
      {tab === 'rating' && <RatingView />}
      {tab === 'schedule' && <ScheduleView />}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
