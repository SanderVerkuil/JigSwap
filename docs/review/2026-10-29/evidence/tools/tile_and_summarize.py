"""Slices full-page screenshots into viewport-height JPEG tiles and writes a compact
metrics summary per route for the UI/UX reviewers.

Usage: python3 -I tile_and_summarize.py /tmp/jigswap-review
"""

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path


root = Path(sys.argv[1])
shots = root / "shots"
tiles = root / "tiles"
TILE_H = {"desktop": 900, "tablet": 1180, "mobile": 844 * 2}

entries = []
for variant_dir in sorted(p for p in shots.iterdir() if p.is_dir()):
    variant = variant_dir.name
    device = variant.split("-")[0]
    out_dir = tiles / variant
    out_dir.mkdir(parents=True, exist_ok=True)
    for meta_path in sorted(variant_dir.glob("*.json")):
        entry = json.loads(meta_path.read_text())
        entry.setdefault("tiles", [])
        entries.append(entry)

(root / "index.json").write_text(json.dumps(entries, indent=1))

# Compact per-route summary across variants.
by_route = defaultdict(list)
for e in entries:
    by_route[(e["authed"], e["route"])].append(e)

lines = ["# Capture summary (per route, per variant)", ""]
axe_totals = Counter()
axe_impact = {}
for (authed, route), es in sorted(by_route.items()):
    lines.append(f"## {'app' if authed else 'public'} {route}")
    for e in sorted(es, key=lambda x: x["variant"]):
        m = e.get("metrics") or {}
        axe = e.get("axe") or []
        for v in axe:
            axe_totals[v["id"]] += v["count"]
            axe_impact[v["id"]] = v["impact"]
        axe_s = ", ".join(f"{v['id']}({v['impact']},{v['count']})" for v in axe) or "none"
        lines.append(
            f"- {e['variant']}: final={e.get('finalUrl')} load={e.get('loadMs')}ms "
            f"tiles={len(e['tiles'])} overflowX={m.get('overflowX')} tap<24={m.get('tapUnder24')} "
            f"tap24-44={m.get('tap24to44')} unnamed={len(m.get('unnamedControls', []))} "
            f"truncated={len(m.get('truncatedText', []))} smallText={len(m.get('smallText', []))} "
            f"zoomInputs={len(m.get('zoomingInputs', []))} h1={m.get('h1')} "
            f"dialogs={m.get('dialogsOpen')} consoleErr={len(e.get('consoleErrors', []))} "
            f"httpErr={len(e.get('httpErrors', []))} axe=[{axe_s}]"
            + (f" ERROR={e['error']}" if e.get("error") else "")
        )
    lines.append("")

lines.insert(2, "## axe totals across all variants (rule, impact, node count)")
for i, (rule, n) in enumerate(axe_totals.most_common()):
    lines.insert(3 + i, f"- {rule} ({axe_impact[rule]}): {n}")
lines.insert(3 + len(axe_totals), "")
(root / "summary.md").write_text("\n".join(lines))
print(f"{len(entries)} entries, {sum(len(e['tiles']) for e in entries)} tiles")
