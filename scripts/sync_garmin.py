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

from swimcalc import derive

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


def swolf(d: dict[str, Any]) -> int | None:
    v = num(first(d, "averageSWOLF", "averageSwolf", "swolf"), 0)
    return v or None  # 0 = sin dato (descansos, técnica, patada)


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
    if pool and pool > 200:  # Garmin lo informa en centímetros (2500 = 25 m)
        pool = round(pool / 100, 1)
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
        "swolf": swolf(a),
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
                    "swolf": swolf(ln),
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
                "swolf": swolf(lap),
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
        detail = SESSIONS_DIR / f"{s['id']}.json"
        intervals = s.pop("intervals", None)
        if intervals:
            detail.write_text(json.dumps({"id": s["id"], "intervals": intervals}, ensure_ascii=False) + "\n")
        elif detail.exists():
            intervals = json.loads(detail.read_text()).get("intervals") or []
        # los campos derivados se recalculan siempre, así los cambios de cálculo aplican a todo el historial
        s.update(derive(intervals or []))
        s["has_detail"] = detail.exists()

    out = sorted(sessions.values(), key=lambda s: (s["date"], s["time"]))
    save(SWIM_FILE, {"updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "sessions": out})
    print(f"Natación: {new} nuevas, {len(out)} en total")
    return new


# ───────── golf ─────────
def _walk(obj: Any):
    """Recorre recursivamente dicts y listas devolviendo (clave, valor)."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k, v
            yield from _walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v)


def _shape(obj: Any, depth: int = 0) -> Any:
    """Solo la estructura (claves y tipos, sin valores) para diagnosticar."""
    if depth > 3:
        return "…"
    if isinstance(obj, dict):
        return {k: _shape(v, depth + 1) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_shape(obj[0], depth + 1)] if obj else []
    return type(obj).__name__


def hole_pars(raw: Any) -> dict[int, int]:
    """Par de cada hoyo, buscado en cualquier parte de la respuesta del scorecard."""
    for k, v in _walk(raw):
        if k == "holePars":
            if isinstance(v, str) and v.isdigit():
                return {i + 1: int(c) for i, c in enumerate(v)}
            if isinstance(v, list) and v and all(isinstance(x, (int, float, str)) for x in v):
                return {i + 1: int(x) for i, x in enumerate(v) if str(x).isdigit() and int(x)}
    pars: dict[int, int] = {}
    for _, v in _walk(raw):
        if isinstance(v, list) and v and isinstance(v[0], dict) and "par" in v[0]:
            for h in v:
                n = h.get("number") or h.get("holeNumber")
                if n and h.get("par"):
                    pars[int(n)] = int(h["par"])
            if pars:
                return pars
    return pars


_shape_printed = False


def parse_round(api: Garmin, summary: dict[str, Any]) -> dict[str, Any] | None:
    sid = summary["id"]
    raw = api.get_golf_scorecard(sid) or {}
    details = raw.get("scorecardDetails") or [raw]
    detail = details[0] if details else {}
    sc = detail.get("scorecard") or detail
    pars = hole_pars(raw)
    global _shape_printed
    if not pars and not _shape_printed:
        print("  aviso: no se encontró el par de los hoyos. Estructura de la respuesta:")
        print("  " + json.dumps(_shape(raw), ensure_ascii=False)[:3000])
        _shape_printed = True

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
    fw_holes = [h for h in holes if h["fairway"] in ("HIT", "LEFT", "RIGHT") and (h["par"] or 4) >= 4]
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


CLUB_TYPES = {  # nombres por si Garmin no manda el nombre del palo
    1: "Driver", 2: "Madera 3", 3: "Madera 5", 4: "Madera 7", 5: "Híbrido 2", 6: "Híbrido 3",
    7: "Híbrido 4", 8: "Híbrido 5", 9: "Híbrido 6", 10: "Hierro 2", 11: "Hierro 3", 12: "Hierro 4",
    13: "Hierro 5", 14: "Hierro 6", 15: "Hierro 7", 16: "Hierro 8", 17: "Hierro 9", 18: "PW",
    19: "GW", 20: "SW", 21: "LW", 22: "Putter",
}


def _find_num(d: dict[str, Any], must: tuple[str, ...], avoid: tuple[str, ...] = ()) -> float | None:
    """Primer valor numérico cuya clave contiene todas las palabras de `must` (en cualquier nivel)."""
    for k, v in _walk(d):
        kl = k.lower()
        if isinstance(v, (int, float)) and not isinstance(v, bool) and all(m in kl for m in must) and not any(a in kl for a in avoid):
            return float(v)
    return None


def parse_clubs(raw: Any) -> list[dict[str, Any]]:
    """Distancia promedio y máxima por palo, a partir de la respuesta de Garmin (formato no documentado)."""
    items = raw if isinstance(raw, list) else next((v for _, v in _walk(raw) if isinstance(v, list) and v and isinstance(v[0], dict)), [])
    if items:
        print("  estructura de un palo: " + json.dumps(_shape(items[0]), ensure_ascii=False)[:1500])
    clubs = []
    for c in items:
        if c.get("retired") or c.get("deleted"):
            continue
        avg = _find_num(c, ("average", "distance")) or _find_num(c, ("avg", "distance"))
        mx = _find_num(c, ("max", "distance")) or _find_num(c, ("longest",))
        shots = _find_num(c, ("shot",), ("distance",)) or _find_num(c, ("count",))
        if not avg:
            continue
        # Garmin suele informar distancias en centímetros
        scale = 0.01 if avg > 1000 else 1
        type_id = c.get("clubTypeId") or (c.get("clubType") or {}).get("id")
        name = c.get("name") or c.get("clubName") or (c.get("clubType") or {}).get("name") or CLUB_TYPES.get(type_id) or f"Palo {type_id}"
        if "putter" in str(name).lower():
            continue
        clubs.append({
            "name": str(name),
            "type": type_id,
            "avg_m": round(avg * scale),
            "max_m": round(mx * scale) if mx else None,
            "shots": int(shots) if shots else None,
        })
    clubs.sort(key=lambda x: -x["avg_m"])
    print(f"  {len(clubs)} palos con distancia")
    return clubs


def sync_golf(api: Garmin, full: bool) -> int:
    data = load(GOLF_FILE, "rounds")
    # las rondas sin par se vuelven a leer (versiones anteriores del script no lo encontraban)
    rounds = {r["id"]: r for r in data.get("rounds", []) if r.get("par")} if not full else {}

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

    # historial del hándicap: un punto cada vez que cambia
    history = list(data.get("handicap_history") or [])
    if handicap is not None and (not history or history[-1]["value"] != handicap):
        history.append({"date": dt.date.today().isoformat(), "value": handicap})

    clubs = data.get("clubs") or []
    try:
        clubs = parse_clubs(api.get_golf_club_stats()) or clubs
    except Exception as e:  # noqa: BLE001
        print(f"  distancias por palo no disponibles: {e}")

    out = sorted(rounds.values(), key=lambda r: (r["date"], r["time"]))
    save(GOLF_FILE, {
        "updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "handicap": handicap,
        "handicap_history": history,
        "clubs": clubs,
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
