#!/usr/bin/env python3
"""Copy a built release after verifying all bundled frontend files match source."""
from pathlib import Path
import hashlib
import shutil
import zipfile

root = Path(__file__).resolve().parents[1]
apk = root / "app/build/outputs/apk/release/app-release.apk"
with zipfile.ZipFile(apk) as archive:
    names = set(archive.namelist())
    assert "classes.dex" in names
    assert "AndroidManifest.xml" in names
    for source in (root / "web").rglob("*"):
        if source.is_file():
            asset = "assets/" + source.relative_to(root / "web").as_posix()
            assert archive.read(asset) == source.read_bytes(), f"Stale APK asset: {asset}"
    assert not any(name.endswith((".jks", ".p12", ".keystore")) for name in names)
release = root / "releases/Cosom-Android-1.0.0-preview.1.apk"
release.parent.mkdir(exist_ok=True)
shutil.copy2(apk, release)
digest = hashlib.sha256(release.read_bytes()).hexdigest()
(release.parent / "SHA256SUMS").write_text(f"{digest}  {release.name}\n")
print(f"Verified frontend bundle and packaged {release.name} ({release.stat().st_size} bytes)")
