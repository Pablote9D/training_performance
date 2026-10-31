"""Cálculos de natación compartidos por sync_garmin.py y sample_data.py."""
from __future__ import annotations

from typing import Any

PR_DISTANCES = (100, 200, 400, 800, 1500)


def best_efforts(intervals: list[dict[str, Any]]) -> dict[str, float]:
    """Mejor tiempo (s) para cada distancia, nadada de corrido dentro de un intervalo.

    Recorre las piletas de cada intervalo activo con una ventana deslizante:
    si una serie de piletas consecutivas suma exactamente la distancia, es candidata.
    """
    best: dict[str, float] = {}
    for it in intervals:
        if it.get("kind") != "active":
            continue
        lengths = [ln for ln in it.get("lengths") or [] if ln.get("d") and ln.get("t")]
        for target in PR_DISTANCES:
            lo, dist, secs = 0, 0.0, 0.0
            for hi, ln in enumerate(lengths):
                dist += ln["d"]
                secs += ln["t"]
                while dist > target + 0.5 and lo <= hi:
                    dist -= lengths[lo]["d"]
                    secs -= lengths[lo]["t"]
                    lo += 1
                if abs(dist - target) < 0.5:
                    key = str(target)
                    if key not in best or secs < best[key]:
                        best[key] = round(secs, 1)
    return best
