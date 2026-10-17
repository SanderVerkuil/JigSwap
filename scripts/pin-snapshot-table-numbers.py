#!/usr/bin/env python3
"""Pin a table number for every preview table a Convex snapshot ZIP doesn't contain.

usage: pin-snapshot-table-numbers.py <snapshot.zip> <tables.txt> <out.zip>

<tables.txt> lists the preview deployment's tables, one per line (`npx convex data`).
Every table there that is missing from the snapshot's root `_tables/documents.jsonl` gets
an entry with a number above every number the snapshot uses; everything else in the ZIP
is copied unchanged, so the imported documents (and their IDs) are exactly the snapshot's.

Why: `convex import --replace-all` gives a schema table that is absent from the import an
empty replacement table. Unless `_tables` names it, the backend picks that table's number
while it creates the import's tables one by one, so the number can collide with one the
snapshot assigns to a table it creates later ("conflict between `memberOnboarding` and
`whatsNewReadStates` with table number 10051"). Every PR that adds a table hits this.
See docs/deployment/convex-preview-deployments.md.
"""

import json
import shutil
import sys
import zipfile

TABLES_ENTRY = "_tables/documents.jsonl"  # the root (app) namespace's table numbers


def main(snapshot_path: str, tables_path: str, out_path: str) -> None:
    with open(tables_path, encoding="utf-8") as f:
        preview_tables = {line.strip() for line in f if line.strip()}

    with zipfile.ZipFile(snapshot_path) as src:
        entries = [
            json.loads(line)
            for line in src.read(TABLES_ENTRY).decode("utf-8").splitlines()
            if line.strip()
        ]
        in_snapshot = {entry["name"] for entry in entries}
        next_number = max(int(entry["id"]) for entry in entries) + 1
        for name in sorted(preview_tables - in_snapshot):
            if name.startswith("_"):
                continue
            entries.append({"name": name, "id": next_number})
            print(f"pinned {name} to table number {next_number} (not in the snapshot)")
            next_number += 1

        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as dst:
            for info in src.infolist():
                if info.filename == TABLES_ENTRY:
                    body = "".join(json.dumps(entry) + "\n" for entry in entries)
                    dst.writestr(info, body)
                else:
                    with src.open(info) as fin, dst.open(info, "w") as fout:
                        shutil.copyfileobj(fin, fout)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
