"""Cálculos de natación compartidos por sync_garmin.py y sample_data.py."""
from __future__ import annotations

from typing import Any

PR_DISTANCES = (100, 200, 400, 800, 1500)
FREESTYLE = "libre"
# Más rápido que ~0,45 s/m (11 s cada 25 m) es imposible para un amateur:
# son piletas mal detectadas por el reloj y se descartan de los cálculos.
MIN_SECONDS_PER_METER = 0.45


# Una pileta real tiene varias brazadas: con menos de 3 (del brazo con reloj) es una pileta
# "fantasma", el reloj partió una pileta en dos.
MIN_WATCH_STROKES = 3


def valid_length(ln: dict[str, Any]) -> bool:
    d, t = ln.get("d") or 0, ln.get("t") or 0
    if ln.get("swolf") and ln["swolf"] - t < MIN_WATCH_STROKES:
        return False
    return d > 0 and t >= d * MIN_SECONDS_PER_METER


NOT_A_STROKE = {"técnica", "otro", None}


def best_efforts(intervals: list[dict[str, Any]], stroke: str | None = None) -> dict[str, dict[str, Any]]:
    """Mejor tiempo para cada distancia, nadada de corrido dentro de un intervalo y en un solo estilo.

    Ventana deslizante sobre piletas consecutivas válidas del mismo estilo (los tramos de
    técnica no cuentan: el reloj reparte su tiempo en partes iguales). Si se indica
    `stroke`, solo se consideran piletas de ese estilo.
    Devuelve {"100": {"t": segundos, "s": estilo}, ...}.
    """
    best: dict[str, dict[str, Any]] = {}

    def scan(run: list[dict[str, Any]]) -> None:
        if not run:
            return
        for target in PR_DISTANCES:
            lo, dist, secs = 0, 0.0, 0.0
            for hi, ln in enumerate(run):
                dist += ln["d"]
                secs += ln["t"]
                while dist > target + 0.5 and lo <= hi:
                    dist -= run[lo]["d"]
                    secs -= run[lo]["t"]
                    lo += 1
                if abs(dist - target) < 0.5:
                    key = str(target)
                    if key not in best or secs < best[key]["t"]:
                        best[key] = {"t": round(secs, 1), "s": run[0]["stroke"]}

    for it in intervals:
        if it.get("kind") != "active":
            continue
        run: list[dict[str, Any]] = []
        for ln in it.get("lengths") or []:
            st = ln.get("stroke")
            ok = valid_length(ln) and st not in NOT_A_STROKE and (stroke is None or st == stroke)
            if ok and (not run or run[-1]["stroke"] == st):
                run.append(ln)
            else:
                scan(run)
                run = [ln] if ok else []
        scan(run)
    return best


def by_stroke(intervals: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    """Por estilo (solo piletas válidas): distancia `d`, tiempo `t`, suma de SWOLF `sw`,
    piletas con SWOLF `n` y el tiempo de esas piletas `tsw` (brazadas = sw - tsw)."""
    out: dict[str, dict[str, float]] = {}
    for it in intervals:
        for ln in it.get("lengths") or []:
            if not valid_length(ln):
                continue
            s = out.setdefault(ln.get("stroke") or "otro", {"d": 0.0, "t": 0.0, "sw": 0.0, "n": 0, "tsw": 0.0})
            s["d"] += ln["d"]
            s["t"] += ln["t"]
            if ln.get("swolf"):
                s["sw"] += ln["swolf"]
                s["n"] += 1
                s["tsw"] += ln["t"]
    return {k: {"d": round(v["d"]), "t": round(v["t"], 1), "sw": round(v["sw"]), "n": int(v["n"]), "tsw": round(v["tsw"], 1)}
            for k, v in out.items()}


def long_set_splits(intervals: list[dict[str, Any]], stroke: str = FREESTYLE, min_distance: float = 400) -> list[dict[str, Any]]:
    """Series largas de un solo estilo: ritmo /100 m de la primera y la segunda mitad.

    Sirve para ver cómo administrás el esfuerzo (split negativo = segunda mitad más rápida).
    `i` es la posición del intervalo dentro de la sesión.
    """
    out = []
    for i, it in enumerate(intervals):
        raw = it.get("lengths") or []
        lengths = [ln for ln in raw if valid_length(ln)]  # sin piletas fantasma ni tiempos imposibles
        if it.get("kind") != "active" or len(lengths) < 8 or len(lengths) < 0.85 * len(raw):
            continue
        if not all(ln.get("stroke") == stroke for ln in lengths):
            continue
        dist = sum(ln["d"] for ln in lengths)
        if dist < min_distance:
            continue
        half = len(lengths) // 2
        a, b = lengths[:half], lengths[len(lengths) - half:]
        p1 = 100 * sum(ln["t"] for ln in a) / sum(ln["d"] for ln in a)
        p2 = 100 * sum(ln["t"] for ln in b) / sum(ln["d"] for ln in b)
        out.append({"i": i, "d": round(dist), "p1": round(p1, 1), "p2": round(p2, 1)})
    return out


DOMINANT_SHARE = 0.8


def normalize_strokes(intervals: list[dict[str, Any]], share: float = DOMINANT_SHARE) -> list[dict[str, Any]]:
    """Corrige el estilo que el reloj detecta mal en algunas piletas.

    Si en un intervalo al menos el 80% de las piletas (sin contar técnica) son de un mismo
    estilo, se asume que todo el intervalo fue de ese estilo: unas pocas piletas marcadas
    como pecho en medio de una tirada de crol son errores de detección.
    Devuelve una copia; no modifica los datos originales.
    """
    out = []
    for it in intervals:
        lengths = it.get("lengths") or []
        swum = [ln.get("stroke") for ln in lengths if ln.get("stroke") not in NOT_A_STROKE]
        dominant = None
        if swum:
            top = max(set(swum), key=swum.count)
            if swum.count(top) / len(swum) >= share:
                dominant = top
        if dominant:
            lengths = [{**ln, "stroke": dominant} if ln.get("stroke") not in NOT_A_STROKE else ln for ln in lengths]
            it = {**it, "stroke": dominant, "lengths": lengths}
        out.append(it)
    return out


def derive(intervals: list[dict[str, Any]]) -> dict[str, Any]:
    """Campos de resumen que se calculan a partir del detalle de una sesión."""
    intervals = normalize_strokes(intervals)
    return {
        "best": best_efforts(intervals),
        "best_free": best_efforts(intervals, FREESTYLE),
        "by_stroke": by_stroke(intervals),
        "splits": long_set_splits(intervals),
    }
