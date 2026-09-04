#!/usr/bin/env python3
"""Convert Kronik's legacy times.tsv into Monday-based files under times/."""

from __future__ import annotations

import argparse
import csv
import shutil
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

TIMES_FIELDS = ("timestamp", "project_id", "action")
VALID_ACTIONS = {"clock_in", "clock_out"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Copy projects.tsv and split times.tsv into sortable times/YYYY-MM-DD.tsv files, "
            "where the date is the Monday that starts the week."
        )
    )
    parser.add_argument("source", type=Path, help="directory containing projects.tsv and times.tsv")
    parser.add_argument("output", type=Path, help="directory to receive projects.tsv and weekly files")
    parser.add_argument(
        "--force",
        action="store_true",
        help="overwrite projects.tsv and weekly TSV files already present in the output directory",
    )
    return parser.parse_args()


def read_times(path: Path) -> dict[str, list[dict[str, str]]]:
    weeks: dict[str, list[dict[str, str]]] = defaultdict(list)

    with path.open("r", encoding="utf-8", newline="") as input_file:
        reader = csv.DictReader(input_file, delimiter="\t")
        if reader.fieldnames != list(TIMES_FIELDS):
            raise ValueError(
                f"{path} must have exactly this header: " + "\\t".join(TIMES_FIELDS)
            )

        for line_number, row in enumerate(reader, start=2):
            timestamp = row["timestamp"].strip()
            try:
                instant = datetime.fromisoformat(timestamp)
            except ValueError as error:
                raise ValueError(f"{path}:{line_number}: invalid ISO 8601 timestamp {timestamp!r}") from error

            if instant.utcoffset() is None:
                raise ValueError(f"{path}:{line_number}: timestamp must include a UTC offset")
            if row["action"] not in VALID_ACTIONS:
                raise ValueError(f"{path}:{line_number}: invalid action {row['action']!r}")
            if not row["project_id"] or any(character in row["project_id"] for character in "\t\r\n"):
                raise ValueError(f"{path}:{line_number}: invalid project_id")

            # The offset-bearing timestamp records the browser's wall clock. Its local calendar
            # date therefore determines the original browser's Monday-based storage week.
            monday = instant.date() - timedelta(days=instant.weekday())
            weeks[monday.isoformat()].append(
                {
                    "timestamp": timestamp,
                    "project_id": row["project_id"],
                    "action": row["action"],
                }
            )

    action_order = {"clock_out": 0, "clock_in": 1}
    for rows in weeks.values():
        rows.sort(
            key=lambda row: (
                datetime.fromisoformat(row["timestamp"]),
                action_order[row["action"]],
                row["project_id"],
            )
        )

    return weeks


def ensure_writable(targets: list[Path], force: bool) -> None:
    existing = [target for target in targets if target.exists()]
    if existing and not force:
        names = ", ".join(str(target) for target in existing[:5])
        suffix = "…" if len(existing) > 5 else ""
        raise FileExistsError(f"refusing to overwrite {names}{suffix}; pass --force to replace them")


def write_week(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as output_file:
        writer = csv.DictWriter(
            output_file,
            fieldnames=TIMES_FIELDS,
            delimiter="\t",
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    args = parse_args()
    source = args.source.resolve()
    output = args.output.resolve()
    projects_source = source / "projects.tsv"
    times_source = source / "times.tsv"

    if source == output:
        raise ValueError("source and output must be different directories")
    if not projects_source.is_file():
        raise FileNotFoundError(projects_source)
    if not times_source.is_file():
        raise FileNotFoundError(times_source)

    weeks = read_times(times_source)
    times_output = output / "times"
    output.mkdir(parents=True, exist_ok=True)
    targets = [output / "projects.tsv", *(times_output / f"{week}.tsv" for week in sorted(weeks))]
    ensure_writable(targets, args.force)
    times_output.mkdir(parents=True, exist_ok=True)

    shutil.copyfile(projects_source, output / "projects.tsv")
    for week, rows in sorted(weeks.items()):
        write_week(times_output / f"{week}.tsv", rows)

    event_count = sum(len(rows) for rows in weeks.values())
    print(f"Converted {event_count} events into {len(weeks)} weekly files in {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
