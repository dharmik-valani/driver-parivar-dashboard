#!/usr/bin/env python3
"""Local verification of Play install/uninstall + payout numbers (UTF-16 aware)."""

from __future__ import annotations

import csv
import io
import json
import ssl
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

BUCKET = "pubsite_prod_6754866166232628173"
PACKAGE = "com.driver.parivar"
CTX = ssl._create_unverified_context()


def token() -> str:
    adc = json.load(open(Path.home() / ".config/gcloud/application_default_credentials.json"))
    data = urllib.parse.urlencode(
        {
            "client_id": adc["client_id"],
            "client_secret": adc["client_secret"],
            "refresh_token": adc["refresh_token"],
            "grant_type": "refresh_token",
        }
    ).encode()
    with urllib.request.urlopen(
        urllib.request.Request("https://oauth2.googleapis.com/token", data=data),
        context=CTX,
    ) as resp:
        return json.load(resp)["access_token"]


def get_bytes(tok: str, object_name: str) -> bytes:
    url = (
        f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o/"
        f"{urllib.parse.quote(object_name, safe='')}?alt=media"
    )
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}"})
    with urllib.request.urlopen(req, context=CTX) as resp:
        return resp.read()


def list_objects(tok: str, prefix: str) -> list[str]:
    names = []
    page = ""
    while True:
        q = urllib.parse.urlencode({"prefix": prefix, "maxResults": "1000", **({"pageToken": page} if page else {})})
        url = f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o?{q}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}"})
        with urllib.request.urlopen(req, context=CTX) as resp:
            payload = json.load(resp)
        names.extend([i["name"] for i in payload.get("items") or []])
        page = payload.get("nextPageToken") or ""
        if not page:
            break
    return names


def decode_csv(buf: bytes) -> str:
    if buf.startswith(b"\xff\xfe") or buf.startswith(b"\xfe\xff"):
        return buf.decode("utf-16")
    return buf.decode("utf-8-sig")


def num(v: str) -> float:
    try:
        return float(str(v or "0").replace(",", "").strip() or "0")
    except ValueError:
        return 0.0


def main() -> None:
    tok = token()
    overview = sorted(
        n
        for n in list_objects(tok, f"stats/installs/installs_{PACKAGE}_")
        if n.endswith("_overview.csv")
    )
    rows = {}
    for name in overview[-8:]:
        text = decode_csv(get_bytes(tok, name))
        for row in csv.DictReader(io.StringIO(text)):
            d = (row.get("Date") or "").strip()
            if d:
                rows[d] = row
    dates = sorted(rows)
    window = dates[-7:]
    installs = uninstalls = 0
    active = None
    for d in window:
        row = rows[d]
        installs += int(num(row.get("Daily User Installs")))
        uninstalls += int(num(row.get("Daily User Uninstalls") or row.get("Uninstall events")))
        active = int(num(row.get("Active Device Installs")))

    earnings = sorted(n for n in list_objects(tok, "earnings/") if "earnings_" in n)
    net = 0.0
    files = earnings[-6:]
    for name in files:
        raw = get_bytes(tok, name)
        zf = zipfile.ZipFile(io.BytesIO(raw))
        for n in zf.namelist():
            if not n.lower().endswith(".csv"):
                continue
            text = decode_csv(zf.read(n))
            for row in csv.DictReader(io.StringIO(text)):
                if (row.get("Package ID") or "") != PACKAGE:
                    continue
                t = (row.get("Transaction Type") or "").lower()
                if t in {"charge", "charge refund", "google fee", "google fee refund", "tax", "tax refund"}:
                    net += num(row.get("Amount (Merchant Currency)"))

    out = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "installs": {
            "fromDate": window[0] if window else None,
            "toDate": window[-1] if window else None,
            "windowDays": len(window),
            "installs": installs,
            "uninstalls": uninstalls,
            "activeDeviceInstalls": active,
        },
        "payout": {
            "available": bool(files),
            "amount": round(net, 2),
            "currency": "INR",
            "mode": "net_earnings",
            "files": files,
            "note": "Net Play earnings (charges − Google fees − tax) from latest earnings files.",
        },
    }
    print(json.dumps(out, indent=2))
    Path("play-metrics.json").write_text(json.dumps(out, indent=2) + "\n")


if __name__ == "__main__":
    main()
