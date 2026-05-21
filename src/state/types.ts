export type Artist = {
  id: string; // uuid
  name: string;
  stage: string;
  start: string; // ISO 8601 datetime string
  end: string; // ISO 8601 datetime string
};

export type Rating = {
  artistId: string;
  score: number | null; // 1–5, null until rated
  comment: string;
};

export type ScheduleSlot = {
  artistId: string;
  from: string; // ISO 8601, may differ from artist.start after adjustment
  to: string; // ISO 8601, may differ from artist.end after adjustment
};

export type OptimizerConfig = {
  travelTimeMinutes: number; // default 10
  minSlotMinutes: number; // default 20
  displayThreshold: number; // ratings >= this are "top" artists; default 3
};

export type AppState = {
  artists: Artist[];
  ratings: Rating[];
  slots: ScheduleSlot[];
  config: OptimizerConfig;
};

export const STORAGE_KEY = 'festival-optimizer-state';

export const defaultConfig: OptimizerConfig = {
  travelTimeMinutes: 10,
  minSlotMinutes: 20,
  displayThreshold: 3,
};

export const emptyState: AppState = {
  artists: [],
  ratings: [],
  slots: [],
  config: defaultConfig,
};
