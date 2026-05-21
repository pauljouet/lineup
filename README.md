# Festival Schedule Optimizer

A single-page app to plan which artists to see at a festival. Upload a CSV
timetable, rate the artists, let the optimizer build an itinerary, then
fine-tune your attendance directly on a vertical, color-coded timeline.

Everything runs in the browser — no backend, no accounts. Your ratings, notes,
and schedule are stored in the browser's `localStorage` and can be exported /
imported as JSON.

## Tech

Vite · React + TypeScript · Tailwind CSS · papaparse (CSV).

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # production build into dist/
npm run preview  # serve the production build locally
```

## CSV formats

Two layouts are accepted:

- **Day + clock times:** `day, stage, artist, start_time, end_time` (times as
  `HH:mm`). Imported one festival day at a time; early-morning sets roll onto
  the next calendar date (configurable "new day starts at" hour).
- **Full datetimes:** `stage, start, end, artist` (`YYYY-MM-DD HH:mm`).

## Deploy to GitHub Pages

This repo includes a workflow (`.github/workflows/deploy.yml`) that builds and
publishes to GitHub Pages on every push to `main`. The Vite `base` is relative
(`./`), so it works at a project subpath without any repo-name configuration.

One-time setup:

1. Create a **public** repo on GitHub and push this project to its `main`
   branch.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub
   Actions**.
3. Push to `main` (or run the workflow manually from the **Actions** tab).

The site is then served at `https://<your-user>.github.io/<repo-name>/`.
