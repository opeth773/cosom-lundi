#!/usr/bin/env python3
"""Install a pinned, unmodified French model into ignored APK assets."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
digest = "cabf6180e177eb9b3a9a9d43a437bd5e549f3a7d09525e5d69a3fed787be12ad"
archive = Path(os.environ.get("COSOM_VOICE_MODEL_ZIP", root / ".gradle/vosk-model-small-fr-0.22.zip"))
if not archive.is_file():
    archive.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["curl", "--fail", "--location", "--silent", "--show-error", "--retry", "2",
                    "https://github.com/opeth773/cosom-lundi/releases/download/speech-model-fr-0.22/vosk-model-small-fr-0.22.zip",
                    "--output", str(archive)], check=True)
assert hashlib.sha256(archive.read_bytes()).hexdigest() == digest, "French model checksum mismatch"
assets = root / "model-assets/voice-model-fr"
if not (assets / "uuid").is_file() or (assets / "uuid").read_text() != digest:
    assets.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as package:
        for member in package.infolist():
            parts = Path(member.filename).parts
            assert not Path(member.filename).is_absolute() and ".." not in parts
            assert parts[0] == "vosk-model-small-fr-0.22"
            target = assets.joinpath(*parts[1:])
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with package.open(member) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
    (assets / "uuid").write_text(digest)
assert (assets / "am/final.mdl").is_file()
print("Verified and prepared French offline model 0.22")
