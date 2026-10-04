#!/usr/bin/env python3
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
oauth = json.load(open("/tmp/play_oauth.json"))
content = (
    "PLAY_CLIENT_ID=" + oauth["client_id"] + "\n"
    "PLAY_CLIENT_SECRET=" + oauth["client_secret"] + "\n"
    "PLAY_REFRESH_TOKEN=" + oauth["refresh_token"] + "\n"
)
for rel in ["functions/.env", "functions/.env.all-india-truck-driver-5b112"]:
    path = root / rel
    path.write_text(content)
    print("Wrote", path, "bytes", path.stat().st_size)

gitignore = root / ".gitignore"
text = gitignore.read_text() if gitignore.exists() else ""
extra = "\nfunctions/.env\nfunctions/.env.*\n"
if "functions/.env" not in text:
    gitignore.write_text(text.rstrip() + extra)
    print("Updated .gitignore")
