#!/usr/bin/env python3
"""Genera datos de EJEMPLO (inventados) con el mismo formato que sync_garmin.py.

Se marcan con "sample": true; la página muestra un aviso y la primera
sincronización real con Garmin los reemplaza.
"""
import datetime as dt
import json
import random
from pathlib import Path

from swimcalc import best_efforts

DATA = Path(__file__).resolve().parent.parent / "data"
rng = random.Random(42)
TODAY = dt.date.today()


def swim_session(i: int, day: dt.date, base_pace: float) -> dict:
    kind = rng.choice(["series", "series", "aerobico", "tecnica"])
    plan = {
        "series": [("libre", 400, 1.08), ("técnica", 200, 1.12), ("libre", 1000, 0.94), ("pecho", 200, 1.2), ("libre", 200, 1.1)],
        "aerobico": [("libre", 400, 1.06), ("libre", 1500, 0.99), ("espalda", 200, 1.15), ("libre", 200, 1.1)],
        "tecnica": [("libre", 300, 1.1), ("técnica", 600, 1.18), ("combinado", 400, 1.12), ("libre", 300, 1.08)],
    }[kind]
    intervals, total_d, total_t, swolfs, strokes = [], 0, 0, [], 0
    for stroke, dist, factor in plan:
        pace = base_pace * factor * rng.uniform(0.97, 1.03)
        lengths = []
        for _ in range(dist // 25):
            t = round(pace / 4 * rng.uniform(0.94, 1.06), 1)
            spl = rng.randint(14, 19) if stroke != "técnica" else 0
            lengths.append({"d": 25, "t": t, "swolf": round(t + spl) if spl else None, "stroke": stroke})
            strokes += spl
        dur = round(sum(x["t"] for x in lengths), 1)
        sw = [x["swolf"] for x in lengths if x["swolf"]]
        intervals.append({"kind": "active", "distance_m": dist, "duration_s": dur, "swolf": round(sum(sw) / len(sw)) if sw else None,
                          "avg_hr": rng.randint(125, 155), "stroke": stroke, "lengths": lengths})
        intervals.append({"kind": "rest", "distance_m": 0, "duration_s": rng.choice([20, 30, 45, 60]), "swolf": None,
                          "avg_hr": None, "stroke": None, "lengths": []})
        total_d += dist
        total_t += dur
        swolfs += sw
    intervals.pop()
    rest = sum(x["duration_s"] for x in intervals if x["kind"] == "rest")
    dur_s = round(total_t + rest)
    z = [rng.uniform(0.05, 0.12), rng.uniform(0.2, 0.35), rng.uniform(0.25, 0.4), rng.uniform(0.1, 0.25), rng.uniform(0, 0.06)]
    zs = sum(z)
    names = {"series": "Series", "aerobico": "Aeróbico", "tecnica": "Técnica"}
    return {
        "id": 10_000 + i, "date": day.isoformat(), "time": "07:%02d" % rng.randint(0, 40), "env": "pool",
        "name": names[kind], "distance_m": total_d, "duration_s": dur_s, "moving_s": round(total_t),
        "avg_hr": rng.randint(130, 148), "max_hr": rng.randint(160, 175), "calories": round(total_d * 0.24),
        "swolf": round(sum(swolfs) / len(swolfs)), "strokes": strokes, "lengths": total_d // 25, "pool_m": 25,
        "hr_zones": [round(dur_s * x / zs) for x in z], "intervals": intervals,
    }


def make_swims() -> dict:
    sessions, day, i = [], TODAY - dt.timedelta(days=200), 0
    base = 122.0
    while day <= TODAY:
        if day.weekday() in (0, 2, 4) or (day.weekday() == 5 and rng.random() < 0.5):
            sessions.append(swim_session(i, day, base))
            base -= 0.05
            i += 1
        day += dt.timedelta(days=1)
    return {"sample": True, "updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "sessions": sessions}


def make_golf() -> dict:
    courses = ["Club de ejemplo A", "Club de ejemplo B"]
    pars = [4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4]
    rounds, day, i, skill = [], TODAY - dt.timedelta(days=200), 0, 0.95
    while day <= TODAY:
        if day.weekday() == 5 and rng.random() < 0.7:
            n = 18 if rng.random() < 0.85 else 9
            holes = []
            for h in range(n):
                par = pars[h]
                putts = rng.choices([1, 2, 3], [15, 65, 20])[0]
                strokes = max(par - 1, round(par + rng.gauss(skill, 0.9)))
                putts = min(putts, strokes - 1)
                fw = rng.choices(["HIT", "LEFT", "RIGHT"], [44, 24, 32])[0] if par >= 4 else None
                holes.append({"n": h + 1, "par": par, "strokes": strokes, "putts": putts, "fairway": fw,
                              "penalties": 1 if rng.random() < 0.06 else 0})
            fw_h = [h for h in holes if h["fairway"]]
            rounds.append({
                "id": 50_000 + i, "date": day.isoformat(), "time": "09:%02d" % rng.randint(0, 50),
                "course": rng.choice(courses), "holes_played": n,
                "strokes": sum(h["strokes"] for h in holes), "par": sum(h["par"] for h in holes),
                "putts": sum(h["putts"] for h in holes),
                "fairways_hit": sum(h["fairway"] == "HIT" for h in fw_h),
                "fairways_left": sum(h["fairway"] == "LEFT" for h in fw_h),
                "fairways_right": sum(h["fairway"] == "RIGHT" for h in fw_h),
                "fairways_total": len(fw_h),
                "gir": sum(h["strokes"] - h["putts"] <= h["par"] - 2 for h in holes), "gir_total": n,
                "penalties": sum(h["penalties"] for h in holes), "holes": holes,
            })
            skill -= 0.008
            i += 1
        day += dt.timedelta(days=1)
    return {"sample": True, "updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "handicap": 18.4, "rounds": rounds}


if __name__ == "__main__":
    DATA.mkdir(exist_ok=True)
    swims = make_swims()
    det = DATA / "sesiones"
    det.mkdir(exist_ok=True)
    for f in det.glob("*.json"):
        f.unlink()
    for s in swims["sessions"]:
        s["best"] = best_efforts(s["intervals"])
        (det / f"{s['id']}.json").write_text(json.dumps({"id": s["id"], "intervals": s.pop("intervals")}, ensure_ascii=False) + "\n")
        s["has_detail"] = True
    (DATA / "natacion.json").write_text(json.dumps(swims, ensure_ascii=False, indent=1) + "\n")
    (DATA / "golf.json").write_text(json.dumps(make_golf(), ensure_ascii=False) + "\n")
    print("Datos de ejemplo generados en data/")
