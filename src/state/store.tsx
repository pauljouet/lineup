import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import {
  emptyState,
  STORAGE_KEY,
  type AppState,
  type Artist,
  type OptimizerConfig,
  type Rating,
  type ScheduleSlot,
} from './types';
import { optimize } from '../lib/optimizer';

export type Action =
  | { type: 'SET_ARTISTS'; artists: Artist[] } // replaces artists; resets ratings to match
  | { type: 'ADD_ARTIST'; artist: Artist }
  | { type: 'UPDATE_ARTIST'; id: string; patch: Partial<Artist> }
  | { type: 'DELETE_ARTIST'; id: string }
  | { type: 'SET_RATING'; artistId: string; patch: Partial<Rating> }
  | { type: 'SET_CONFIG'; patch: Partial<OptimizerConfig> }
  | { type: 'OPTIMIZE' }
  | { type: 'SET_SLOTS'; slots: ScheduleSlot[] }
  | { type: 'UPDATE_SLOT'; index: number; from: string; to: string }
  | { type: 'REMOVE_SLOT'; index: number }
  // Attendance is keyed by artist and clamped to the set's real bounds.
  | { type: 'TOGGLE_ATTENDANCE'; artistId: string } // add full-set / remove
  | { type: 'SET_ATTENDANCE'; artistId: string; from: string; to: string }
  | { type: 'CLEAR_ATTENDANCE'; artistId: string }
  | { type: 'REPLACE_STATE'; state: AppState };

/** Clamp [from,to] inside the artist's real set window, keeping from < to. */
function clampToSet(
  artist: Artist,
  fromMs: number,
  toMs: number,
): { from: string; to: string } {
  const lo = new Date(artist.start).getTime();
  const hi = new Date(artist.end).getTime();
  let from = Math.max(lo, Math.min(fromMs, hi));
  let to = Math.max(lo, Math.min(toMs, hi));
  if (to <= from) {
    // keep a minimal sliver rather than collapsing
    if (from > lo) from = Math.max(lo, to - 60_000);
    else to = Math.min(hi, from + 60_000);
  }
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

function ensureRating(ratings: Rating[], artistId: string): Rating[] {
  if (ratings.some((r) => r.artistId === artistId)) return ratings;
  return [...ratings, { artistId, score: null, comment: '' }];
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_ARTISTS': {
      const ids = new Set(action.artists.map((a) => a.id));
      const kept = state.ratings.filter((r) => ids.has(r.artistId));
      const ratings = action.artists.reduce(
        (acc, a) => ensureRating(acc, a.id),
        kept,
      );
      return { ...state, artists: action.artists, ratings, slots: [] };
    }
    case 'ADD_ARTIST':
      return {
        ...state,
        artists: [...state.artists, action.artist],
        ratings: ensureRating(state.ratings, action.artist.id),
      };
    case 'UPDATE_ARTIST':
      return {
        ...state,
        artists: state.artists.map((a) =>
          a.id === action.id ? { ...a, ...action.patch } : a,
        ),
      };
    case 'DELETE_ARTIST':
      return {
        ...state,
        artists: state.artists.filter((a) => a.id !== action.id),
        ratings: state.ratings.filter((r) => r.artistId !== action.id),
        slots: state.slots.filter((s) => s.artistId !== action.id),
      };
    case 'SET_RATING': {
      const ratings = ensureRating(state.ratings, action.artistId).map((r) =>
        r.artistId === action.artistId ? { ...r, ...action.patch } : r,
      );
      return { ...state, ratings };
    }
    case 'SET_CONFIG':
      return { ...state, config: { ...state.config, ...action.patch } };
    case 'OPTIMIZE':
      return {
        ...state,
        slots: optimize(state.artists, state.ratings, state.config),
      };
    case 'SET_SLOTS':
      return { ...state, slots: action.slots };
    case 'UPDATE_SLOT':
      return {
        ...state,
        slots: state.slots.map((s, i) =>
          i === action.index ? { ...s, from: action.from, to: action.to } : s,
        ),
      };
    case 'REMOVE_SLOT':
      return { ...state, slots: state.slots.filter((_, i) => i !== action.index) };
    case 'TOGGLE_ATTENDANCE': {
      const existing = state.slots.some((s) => s.artistId === action.artistId);
      if (existing)
        return {
          ...state,
          slots: state.slots.filter((s) => s.artistId !== action.artistId),
        };
      const artist = state.artists.find((a) => a.id === action.artistId);
      if (!artist) return state;
      return {
        ...state,
        slots: [
          ...state.slots,
          { artistId: artist.id, from: artist.start, to: artist.end },
        ],
      };
    }
    case 'SET_ATTENDANCE': {
      const artist = state.artists.find((a) => a.id === action.artistId);
      if (!artist) return state;
      const { from, to } = clampToSet(
        artist,
        new Date(action.from).getTime(),
        new Date(action.to).getTime(),
      );
      const others = state.slots.filter((s) => s.artistId !== action.artistId);
      return { ...state, slots: [...others, { artistId: artist.id, from, to }] };
    }
    case 'CLEAR_ATTENDANCE':
      return {
        ...state,
        slots: state.slots.filter((s) => s.artistId !== action.artistId),
      };
    case 'REPLACE_STATE':
      return action.state;
    default:
      return state;
  }
}

/** Validate the shape of an imported / stored object before trusting it. */
export function validateState(raw: unknown): AppState | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.artists) || !Array.isArray(o.ratings) || !Array.isArray(o.slots))
    return null;
  const artists = o.artists.filter(
    (a): a is Artist =>
      !!a &&
      typeof a === 'object' &&
      typeof (a as Artist).id === 'string' &&
      typeof (a as Artist).name === 'string' &&
      typeof (a as Artist).stage === 'string' &&
      typeof (a as Artist).start === 'string' &&
      typeof (a as Artist).end === 'string',
  );
  const ratings = o.ratings.filter(
    (r): r is Rating =>
      !!r && typeof r === 'object' && typeof (r as Rating).artistId === 'string',
  );
  const slots = o.slots.filter(
    (s): s is ScheduleSlot =>
      !!s &&
      typeof s === 'object' &&
      typeof (s as ScheduleSlot).artistId === 'string' &&
      typeof (s as ScheduleSlot).from === 'string' &&
      typeof (s as ScheduleSlot).to === 'string',
  );
  const cfg = (o.config ?? {}) as Partial<OptimizerConfig>;
  return {
    artists,
    ratings,
    slots,
    config: {
      travelTimeMinutes:
        typeof cfg.travelTimeMinutes === 'number' ? cfg.travelTimeMinutes : 10,
      minSlotMinutes: typeof cfg.minSlotMinutes === 'number' ? cfg.minSlotMinutes : 20,
      displayThreshold:
        typeof cfg.displayThreshold === 'number' ? cfg.displayThreshold : 3,
    },
  };
}

function loadInitial(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState;
    const parsed = validateState(JSON.parse(raw));
    return parsed ?? emptyState;
  } catch {
    return emptyState;
  }
}

const StateCtx = createContext<AppState>(emptyState);
const DispatchCtx = createContext<Dispatch<Action>>(() => {});

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial);

  // Debounced persistence — drag interactions fire many updates per second.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        /* quota or serialization failure — non-fatal for a prototype */
      }
    }, 300);
    return () => clearTimeout(id);
  }, [state]);

  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAppState = () => useContext(StateCtx);
// eslint-disable-next-line react-refresh/only-export-components
export const useDispatch = () => useContext(DispatchCtx);
