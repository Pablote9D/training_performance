#!/usr/bin/env python3
"""Descarga natación y golf desde Garmin Connect y los guarda en data/*.json.

Credenciales (variables de entorno):
  GARMINTOKENS      JSON de tokens generado con scripts/garmin_login.py (recomendado,
                    necesario si la cuenta tiene verificación en dos pasos)
  GARMIN_EMAIL      alternativa: usuario y contraseña
  GARMIN_PASSWORD
Opcionales:
  START_DATE        primera fecha a descargar en la carga inicial (YYYY-MM-DD, default 2020-01-01)
  FULL_SYNC=1       vuelve a descargar todo en lugar de solo lo nuevo

Solo se guardan las métricas que muestra la página: nada de GPS, ubicación ni
datos del perfil.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from garminconnect import Garmin

from swimcalc import best_efforts

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SWIM_FILE = DATA / "natacion.json"
SESSIONS_DIR = DATA / "sesiones"  # detalle (intervalos y piletas), un archivo por sesión
GOLF_FILE = DATA / "golf.json"

SWIM_TYPES = {"lap_swimming": "pool", "open_water_swimming": "ow"}
PAUSE = 0.4  # segundos entre pedidos, para no saturar la API


# ───────── utilidades ─────────
def load(path: Path, key: str) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {key: []}
    if data.get("sample"):  # los datos de ejemplo se descartan en la primera sync real
        if path == SWIM_FILE:
            for f in SESSIONS_DIR.glob("*.json"):
                f.unlink()
        return {key: []}
    return data


def save(path: Path, data: dict[str, Any]) -> None:
    DATA.mkdir(exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")


def num(v: Any, nd: int | None = None) -> float | int | None:
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if nd == 0:
        return int(round(f))
    return round(f, nd) if nd is not None else f


def first(d: dict[str, Any], *keys: str) -> Any:
    for k in keys:
        if d.get(k) is not None:
            return d[k]
    return None


def split_local(ts: str | None) -> tuple[str, str]:
    """'2026-10-31 07:10:00' -> ('2026-10-31', '07:10')."""
    if not ts:
        return "", ""
    ts = ts.replace("T", " ")
    return ts[:10], ts[11:16]


def stroke_name(raw: Any) -> str | None:
    if not raw:
        return None
    s = str(raw).upper()
    for key, name in (
        ("FREE", "libre"), ("BACK", "espalda"), ("BREAST", "pecho"),
        ("FLY", "mariposa"), ("BUTTERFLY", "mariposa"), ("IM", "combinado"),
        ("MIXED", "combinado"), ("DRILL", "técnica"),
    ):
        if key in s:
            return name
    return s.lower()


def login() -> Garmin:
    tokens = os.getenv("GARMINTOKENS")
    api = Garmin(os.getenv("GARMIN_EMAIL"), os.getenv("GARMIN_PASSWORD"))
    if not tokens and not (os.getenv("GARMIN_EMAIL") and os.getenv("GARMIN_PASSWORD")):
        sys.exit("Faltan credenciales: definí GARMINTOKENS o GARMIN_EMAIL + GARMIN_PASSWORD.")
    api.login(tokens or None)
    return api


# ───────── natación ─────────
def parse_swim(api: Garmin, a: dict[str, Any]) -> dict[str, Any]:
    aid = a["activityId"]
    env = SWIM_TYPES[a["activityType"]["typeKey"]]
    date, hour = split_local(a.get("startTimeLocal"))
    pool = num(a.get("poolLength"), 1)
    if pool and (a.get("unitOfPoolLength") or {}).get("unitKey") == "yard":
        pool = round(pool * 0.9144, 1)

    s: dict[str, Any] = {
        "id": aid,
        "date": date,
        "time": hour,
        "env": env,
        "name": a.get("activityName") or "",
        "distance_m": num(a.get("distance"), 0) or 0,
        "duration_s": num(a.get("duration"), 0) or 0,
        "moving_s": num(first(a, "movingDuration", "elapsedDuration"), 0),
        "avg_hr": num(a.get("averageHR"), 0),
        "max_hr": num(a.get("maxHR"), 0),
        "calories": num(a.get("calories"), 0),
        "swolf": num(first(a, "averageSwolf", "averageSWOLF"), 0),
        "strokes": num(first(a, "totalNumberOfStrokes", "strokes"), 0),
        "lengths": num(a.get("activeLengths"), 0),
        "pool_m": pool if env == "pool" else None,
        "hr_zones": None,
        "intervals": [],
    }

    try:
        zones = api.get_activity_hr_in_timezones(aid) or []
        secs = {int(z.get("zoneNumber", 0)): num(z.get("secsInZone"), 0) or 0 for z in zones}
        if any(secs.values()):
            s["hr_zones"] = [secs.get(i, 0) for i in range(1, 6)]
    except Exception as e:  # noqa: BLE001 - un dato faltante no corta la sync
        print(f"  zonas FC no disponibles para {aid}: {e}")
    time.sleep(PAUSE)

    try:
        splits = api.get_activity_splits(aid) or {}
        for lap in splits.get("lapDTOs") or []:
            dist = num(lap.get("distance"), 0) or 0
            dur = num(first(lap, "duration", "elapsedDuration"), 1) or 0
            lengths = []
            for ln in lap.get("lengthDTOs") or []:
                ld = num(ln.get("distance"), 1) or 0
                if ld <= 0:
                    continue
                lengths.append({
                    "d": ld,
                    "t": num(first(ln, "duration", "elapsedDuration"), 1),
                    "swolf": num(first(ln, "averageSWOLF", "averageSwolf", "swolf"), 0),
                    "stroke": stroke_name(first(ln, "swimStroke", "swimStrokeType")),
                })
            strokes_used = {ln["stroke"] for ln in lengths if ln["stroke"]}
            stroke = stroke_name(first(lap, "swimStroke", "swimStrokeType"))
            if not stroke and strokes_used:
                stroke = strokes_used.pop() if len(strokes_used) == 1 else "combinado"
            s["intervals"].append({
                "kind": "active" if dist > 0 else "rest",
                "distance_m": dist,
                "duration_s": dur,
                "swolf": num(first(lap, "averageSWOLF", "averageSwolf"), 0),
                "avg_hr": num(lap.get("averageHR"), 0),
                "stroke": stroke,
                "lengths": lengths,
            })
        # aguas abiertas: no guardamos laps con coordenadas, solo tiempos y distancias
    except Exception as e:  # noqa: BLE001
        print(f"  intervalos no disponibles para {aid}: {e}")
    time.sleep(PAUSE)
    return s


def sync_swims(api: Garmin, full: bool) -> int:
    data = load(SWIM_FILE, "sessions")
    sessions = {s["id"]: s for s in data.get("sessions", [])} if not full else {}
    if sessions and not full:
        last = max(s["date"] for s in sessions.values())
        start = (dt.date.fromisoformat(last) - dt.timedelta(days=3)).isoformat()
    else:
        start = os.getenv("START_DATE", "2020-01-01")
    end = dt.date.today().isoformat()

    print(f"Natación: buscando actividades desde {start}")
    acts = api.get_activities_by_date(start, end, "swimming") or []
    new = 0
    for a in acts:
        tkey = (a.get("activityType") or {}).get("typeKey")
        if tkey not in SWIM_TYPES or a["activityId"] in sessions:
            continue
        print(f"  + {a.get('startTimeLocal')} {a.get('activityName')}")
        sessions[a["activityId"]] = parse_swim(api, a)
        new += 1

    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    for s in sessions.values():
        intervals = s.pop("intervals", None)
        if intervals is not None:
            s["best"] = best_efforts(intervals)
        if intervals:
            (SESSIONS_DIR / f"{s['id']}.json").write_text(
                json.dumps({"id": s["id"], "intervals": intervals}, ensure_ascii=False) + "\n")
        s["has_detail"] = (SESSIONS_DIR / f"{s['id']}.json").exists()

    out = sorted(sessions.values(), key=lambda s: (s["date"], s["time"]))
    save(SWIM_FILE, {"updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "sessions": out})
    print(f"Natación: {new} nuevas, {len(out)} en total")
    return new


# ───────── golf ─────────
def hole_pars(detail: dict[str, Any], scorecard: dict[str, Any]) -> dict[int, int]:
    pars: dict[int, int] = {}
    for snap in detail.get("courseSnapshots") or []:
        raw = snap.get("holePars")
        if isinstance(raw, str) and raw.isdigit():
            pars = {i + 1: int(c) for i, c in enumerate(raw)}
        elif isinstance(raw, list):
            pars = {i + 1: int(p) for i, p in enumerate(raw) if p}
        for h in snap.get("holes") or []:
            if h.get("number") and h.get("par"):
                pars[int(h["number"])] = int(h["par"])
        if pars:
            break
    for h in scorecard.get("holes") or []:
        if h.get("par") and h.get("number"):
            pars.setdefault(int(h["number"]), int(h["par"]))
    return pars


def parse_round(api: Garmin, summary: dict[str, Any]) -> dict[str, Any] | None:
    sid = summary["id"]
    raw = api.get_golf_scorecard(sid) or {}
    details = raw.get("scorecardDetails") or [raw]
    detail = details[0] if details else {}
    sc = detail.get("scorecard") or detail
    pars = hole_pars(detail, sc)

    holes = []
    for h in sorted(sc.get("holes") or [], key=lambda x: x.get("number", 0)):
        n = int(h.get("number") or 0)
        strokes = num(h.get("strokes"), 0)
        if not n or not strokes:
            continue
        holes.append({
            "n": n,
            "par": pars.get(n),
            "strokes": strokes,
            "putts": num(h.get("putts"), 0),
            "fairway": (h.get("fairwayShotOutcome") or None),
            "penalties": num(h.get("penalties"), 0) or 0,
        })
    if not holes:
        return None

    played_pars = [h["par"] for h in holes if h["par"]]
    fw_holes = [h for h in holes if h["par"] and h["par"] >= 4 and h["fairway"]]
    gir = [h for h in holes if h["par"] and h["putts"] is not None]
    date, hour = split_local(first(sc, "startTime", "formattedStartTime") or summary.get("startTime"))
    return {
        "id": sid,
        "date": date,
        "time": hour,
        "course": first(summary, "courseName") or first(sc, "courseName") or "",
        "holes_played": len(holes),
        "strokes": sum(h["strokes"] for h in holes),
        "par": sum(played_pars) if len(played_pars) == len(holes) else None,
        "putts": sum(h["putts"] for h in holes if h["putts"] is not None) if any(h["putts"] is not None for h in holes) else None,
        "fairways_hit": sum(1 for h in fw_holes if h["fairway"] == "HIT"),
        "fairways_left": sum(1 for h in fw_holes if h["fairway"] == "LEFT"),
        "fairways_right": sum(1 for h in fw_holes if h["fairway"] == "RIGHT"),
        "fairways_total": len(fw_holes),
        "gir": sum(1 for h in gir if h["strokes"] - h["putts"] <= h["par"] - 2) if gir else None,
        "gir_total": len(gir),
        "penalties": sum(h["penalties"] for h in holes),
        "holes": holes,
    }


def sync_golf(api: Garmin, full: bool) -> int:
    data = load(GOLF_FILE, "rounds")
    rounds = {r["id"]: r for r in data.get("rounds", [])} if not full else {}

    summaries: list[dict[str, Any]] = []
    start = 0
    while True:
        page = api.get_golf_summary(start=start, limit=100) or {}
        items = page.get("scorecardSummaries") if isinstance(page, dict) else page
        items = items or []
        summaries.extend(items)
        if len(items) < 100:
            break
        start += 100
        time.sleep(PAUSE)

    new = 0
    for s in summaries:
        if not s.get("id") or s["id"] in rounds:
            continue
        try:
            r = parse_round(api, s)
        except Exception as e:  # noqa: BLE001
            print(f"  no se pudo leer la tarjeta {s.get('id')}: {e}")
            r = None
        time.sleep(PAUSE)
        if r:
            print(f"  + {r['date']} {r['course']} {r['strokes']}")
            rounds[r["id"]] = r
            new += 1

    handicap = data.get("handicap")
    try:
        stats = api.get_golf_user_stats() or {}
        h = first(stats, "handicapIndex", "handicap", "currentHandicap")
        if isinstance(h, dict):
            h = first(h, "value", "handicapIndex")
        if h is not None:
            handicap = num(h, 1)
    except Exception as e:  # noqa: BLE001
        print(f"  hándicap no disponible: {e}")

    out = sorted(rounds.values(), key=lambda r: (r["date"], r["time"]))
    save(GOLF_FILE, {
        "updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "handicap": handicap,
        "rounds": out,
    })
    print(f"Golf: {new} nuevas, {len(out)} en total")
    return new


def main() -> None:
    full = os.getenv("FULL_SYNC") == "1"
    api = login()
    sync_swims(api, full)
    try:
        sync_golf(api, full)
    except Exception as e:  # noqa: BLE001 - si golf falla, natación igual se guarda
        print(f"Golf: error al sincronizar ({e})")


if __name__ == "__main__":
    main()
