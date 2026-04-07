Kronik Web App

This directory contains the frontend-only port of Kronik.

Usage:
- Serve the `web/` directory as static files.
- In the app, set the WebDAV base URL to the directory that should contain `projects.tsv` and `times.tsv`.
- The browser talks directly to WebDAV with `GET` and `PUT`. There is no backend.

Server requirements:
- CORS must allow the browser origin to send `GET` and `PUT`.
- If you use Basic auth, the server must allow the `Authorization` header.
- Returning `ETag` headers is recommended; the app uses them to detect conflicting writes.

First run:
- If `projects.tsv` or `times.tsv` do not exist yet, the app treats them as empty and creates them on the first save.
