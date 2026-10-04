"""Offline proof against the unchanged claim-letter worker; writes exclusively below audit/."""
from pathlib import Path
import json
import os
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
AREA = ROOT / "audit/web-worker-proof"
OUT = AREA / "worker-output"
TMP = AREA / "tmp"
for folder in (AREA, OUT, TMP):
    folder.mkdir(parents=True, exist_ok=True)

fixture = [{
    "settleTx": "../fixture-escaped",
    "blockNumber": 0,
    "market": "0x1111111111111111111111111111111111111111",
    "marketLabel": "Live",
    "cover": "0x2222222222222222222222222222222222222222",
    "account": "0x3333333333333333333333333333333333333333",
    "user": "0x4444444444444444444444444444444444444444",
    "value": "80000000",
    "loss": "20000000",
    "limit": "10000000",
    "payout": "10000000",
}]
fixture_path = AREA / "malformed-fixture.json"
fixture_path.write_text(json.dumps(fixture, indent=2))
escaped_path = AREA / "fixture-escaped.json"
if escaped_path.exists():
    escaped_path.unlink()  # Only this proof's own generated output, allowing repeat execution.
node = shutil.which("node")
assert node
cmd = [node, "--import", "tsx", str(ROOT / "scripts/claim-letters.ts"),
       "--dry-run", "--once", "--fixture", str(fixture_path), "--out-dir", str(OUT)]
run = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, timeout=30,
                     env={"PATH": os.defpath, "TMPDIR": str(TMP)})
result = {"worker_exit": run.returncode, "specified_output_dir": str(OUT),
          "escaped_output_exists": escaped_path.exists(), "escaped_output": str(escaped_path),
          "stdout": run.stdout, "stderr": run.stderr}
(ROOT / "audit/evidence/web-worker-confinement.json").write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
assert run.returncode == 0, "worker did not run; cannot establish confinement behavior"
assert not escaped_path.exists(), "FAIL: fixture settleTx traversed outside specified worker output folder"
