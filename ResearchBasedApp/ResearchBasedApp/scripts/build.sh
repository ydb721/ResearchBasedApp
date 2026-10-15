#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
dist_root="$project_root/dist"
python3 - "$project_root" "$dist_root" <<'PY'
from pathlib import Path
import json
import sys
root, dist = Path(sys.argv[1]), Path(sys.argv[2])
source = (root / "worker/index.js").read_text(encoding="utf-8")
html = (root / "app/index.html").read_text(encoding="utf-8")
marker = "__PAGE_HTML__"
if source.count(marker) != 1:
    raise SystemExit("worker/index.js must contain exactly one __PAGE_HTML__ marker")
dist.mkdir(parents=True, exist_ok=True)
(dist / "server").mkdir(exist_ok=True)
(dist / "server/index.js").write_text(source.replace(marker, json.dumps(html, ensure_ascii=False)), encoding="utf-8")
PY
echo "Built $dist_root"
