/**
 * Built-in library of festival lineups and itineraries.
 *
 * Files dropped into `library/lineups/*.csv` and `library/itineraries/*.json`
 * are bundled at build time via Vite's import.meta.glob — no manifest to keep
 * in sync. Add a file, push, redeploy, and it shows up in the app. (Itineraries
 * are just the JSON produced by the Schedule view's "Export JSON" button.)
 */

export type LibraryEntry = { id: string; name: string; content: string };

const lineupFiles = import.meta.glob('/library/lineups/*.csv', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const itineraryFiles = import.meta.glob('/library/itineraries/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function toEntries(files: Record<string, string>): LibraryEntry[] {
  return Object.entries(files)
    .map(([path, content]) => {
      const file = path.split('/').pop() ?? path;
      const name = file
        .replace(/\.[^.]+$/, '') // drop extension
        .replace(/[_-]+/g, ' ') // separators -> spaces
        .trim();
      return { id: path, name, content };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const lineupLibrary = toEntries(lineupFiles);
export const itineraryLibrary = toEntries(itineraryFiles);
