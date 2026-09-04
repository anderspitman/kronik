# Kronik Web App

Kronik is a static, browser-based time card that stores its data directly in a WebDAV directory. There is no application backend.

## Data format

The WebDAV root contains:

- `projects.tsv` — project IDs and display names.
- A `times/` collection containing one time-event file per week, named for the Monday that begins the week: `times/YYYY-MM-DD.tsv`.

For example, `times/2026-08-31.tsv` covers Monday, August 31 through Sunday, September 6. The ISO 8601 names sort chronologically. Weekly files use this schema:

```tsv
timestamp	project_id	action
2026-09-04T08:15:00-06:00	toolbox	clock_in
```

New timestamps use the browser's local time and include its UTC offset. The browser's local calendar determines Monday-at-midnight week boundaries. The app loads all weekly files so it can correctly display instants in the viewing browser's timezone and carry sessions across file or week boundaries.

## Usage

1. Serve this directory as static files.
2. Open Kronik and set the WebDAV base URL to the root containing `projects.tsv` and the `times/` collection.
3. Select **Load data**. The current week is shown initially when it has data; otherwise the most recent week with data is shown.
4. Use **Previous week** and **Next week** to move among weeks containing tracked time.

Clock controls always record the current browser time and return the display to the current week.

## WebDAV requirements

The browser uses:

- `PROPFIND` with `Depth: 1` on `times/` to discover weekly files.
- `MKCOL` to create `times/` when initializing an empty WebDAV root.
- `GET` to load projects and weekly time data.
- `PUT` to create or update files.

CORS must allow the browser origin to send `PROPFIND`, `MKCOL`, `GET`, and `PUT`, along with the `Depth`, `Authorization`, `Content-Type`, `If-Match`, and `If-None-Match` headers as applicable. Returning `ETag` headers is recommended; Kronik uses them to detect conflicting writes.

If `projects.tsv` or `times/` is missing, Kronik treats it as empty and creates the missing structure on the first save. A weekly file is created under `times/` when its first event is recorded.

## Converting legacy data

`convert_times_to_weekly.py` converts the old `projects.tsv` plus `times.tsv` layout without modifying the source files:

```sh
python3 convert_times_to_weekly.py ./files ./files/weekly
```

The output directory must differ from the source directory. It receives a copy of `projects.tsv` and a `times/` directory containing one `YYYY-MM-DD.tsv` file per Monday-based week. Existing output files are protected by default; pass `--force` to replace them:

```sh
python3 convert_times_to_weekly.py ./files ./files/weekly --force
```

The converter requires every timestamp to be valid ISO 8601 with a UTC offset. It uses the calendar date encoded in that offset-bearing timestamp to select the Monday filename.
