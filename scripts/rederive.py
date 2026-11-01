#!/usr/bin/env python3
"""Recalcula los campos derivados de natación (récords, estilos, splits) a partir de
los archivos de detalle, sin conectarse a Garmin.

Uso: python scripts/rederive.py [carpeta_de_datos]   (por defecto: data/)

Lo usa la publicación de dev: toma los datos de prod y les aplica los cálculos de dev.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from swimcalc import derive  # noqa: E402


def main() -> None:
    data = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "data")
    path = data / "natacion.json"
    doc = json.loads(path.read_text())
    for s in doc.get("sessions", []):
        detail = data / "sesiones" / f"{s['id']}.json"
        intervals = json.loads(detail.read_text()).get("intervals", []) if detail.exists() else []
        s.update(derive(intervals))
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    print(f"Recalculadas {len(doc.get('sessions', []))} sesiones en {path}")


if __name__ == "__main__":
    main()
