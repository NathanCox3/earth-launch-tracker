# Earth Launch Tracker

Track upcoming and past rocket launches from Earth across agencies, companies, and launch sites in one place.

Live site: [https://nathancox3.github.io/earth-launch-tracker/](https://nathancox3.github.io/earth-launch-tracker/)

## What It Does

- Shows upcoming and past launches with launch time, local timezone formatting, UTC time, and a live countdown or time-since-launch.
- Includes filters for launch organization, launch-site country, and launch location.
- Detects structured livestream metadata and labels links as `Watch live`, `Livestream available`, or `Watch replay`.
- Publishes a zero-cost static site on GitHub Pages.
- Refreshes launch data every 30 minutes with GitHub Actions.

## Data Source

Launch data comes from [The Space Devs Launch Library](https://thespacedevs.com/llapi), using upcoming and previous launch feeds and respecting the free-tier request limit.

## Local Development

```bash
npm install
npm run sync:upcoming -- 1
npm run sync:backfill -- 1
npm run export:static
npm start
```

Then open `http://localhost:3001`.

## Project Layout

- `src/` contains the sync pipeline, API/runtime, normalization logic, and tests.
- `src/public/` contains the no-build frontend.
- `data/launch-tracker-data.json` stores the published launch cache used by the static site workflow.
- `docs/` is the GitHub Pages output.
- `.github/workflows/refresh-launch-tracker.yml` refreshes data and republishes the site every 30 minutes.
