#!/usr/bin/env python3
"""Install the same checksum-verified SDK CLI used for the local APK build."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import urllib.request
import zipfile

base = Path(os.environ["RUNNER_TEMP"]) / "cosom-android-sdk"
base.mkdir(exist_ok=True)
archive = base / "commandlinetools.zip"
url = "https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip"
urllib.request.urlretrieve(url, archive)
assert hashlib.sha256(archive.read_bytes()).hexdigest() == "7ec965280a073311c339e571cd5de778b9975026cfcbe79f2b1cdcb1e15317ee", "SDK checksum mismatch"
with zipfile.ZipFile(archive) as package:
    package.extractall(base / "unpacked")
tools = base / "cmdline-tools/latest"
tools.parent.mkdir(exist_ok=True)
shutil.move(str(base / "unpacked/cmdline-tools"), tools)
for executable in (tools / "bin").iterdir():
    executable.chmod(0o755)
sdkmanager = str(tools / "bin/sdkmanager")
subprocess.run([sdkmanager, "--sdk_root=" + str(base), "--licenses"], input="y\n" * 100, text=True, check=True)
subprocess.run([sdkmanager, "--sdk_root=" + str(base), "platforms;android-36", "build-tools;35.0.0"], check=True)
with open(os.environ["GITHUB_ENV"], "a") as output:
    output.write(f"ANDROID_HOME={base}\nANDROID_SDK_ROOT={base}\n")
