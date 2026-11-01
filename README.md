# Training Performance

Página personal con mis métricas de **natación** (pileta y aguas abiertas) y **golf**, tomadas automáticamente de Garmin Connect (Fenix 8).

- **Resumen:** anillos con los objetivos de la semana, ritmo semanal, hándicap y últimas actividades.
- **Natación:** distancia, ritmo, SWOLF y racha con comparación contra el período anterior, volumen semanal o mensual, tendencias, récords personales y lista de sesiones. Con el selector **Crol / Todos** todo se calcula solo con las piletas de crol.
- **Detalle de sesión:** ritmo por pileta (crol resaltado), reparto por estilo, zonas de frecuencia cardíaca e intervalos.
- **Golf:** hándicap, promedio, mejor ronda, putts, fairways y GIR; golpes por ronda, promedio en hoyos par 3/4/5, dirección de la salida y tarjeta hoyo por hoyo.

Es un sitio estático (HTML + JS, sin build). Funciona en el celular y en la PC.

## Cómo funciona

```
Garmin Connect ──(GitHub Actions, todos los días)──> data/*.json ──> GitHub Pages
```

1. `scripts/sync_garmin.py` usa la API **no oficial** de Garmin Connect (librería [`garminconnect`](https://github.com/cyberjunky/python-garminconnect)) para bajar las actividades nuevas.
2. Guarda solo las métricas que muestra la página: **sin GPS, ubicación ni datos del perfil**.
3. El workflow `.github/workflows/sync-garmin.yml` corre todos los días a las 06:17 (hora de Argentina) y commitea los datos.
4. GitHub Pages publica la página.

> La API no es oficial y Garmin puede cambiarla. Si un día la sincronización falla, suele alcanzar con actualizar la versión de `garminconnect` en `requirements.txt`.

Mientras no se conecte Garmin, la página muestra **datos de ejemplo** con un aviso arriba. La primera sincronización los reemplaza.

## Puesta en marcha

### 1. Repo público y rama principal

- **Settings → General → Danger Zone → Change visibility → Public.**
- Uní esta rama a `main` y dejá `main` como rama por defecto. Los workflows programados solo corren en la rama por defecto.

### 2. Credenciales de Garmin (secretos)

En **Settings → Secrets and variables → Actions → New repository secret**:

| Secreto | Cuándo |
|---|---|
| `GARMIN_EMAIL` y `GARMIN_PASSWORD` | Si tu cuenta **no** tiene verificación en dos pasos |
| `GARMINTOKENS` | Si **tiene** verificación en dos pasos (recomendado igual) |

Para generar `GARMINTOKENS`, en tu computadora:

```bash
pip install -r requirements.txt
```

```bash
python scripts/garmin_login.py
```

Te pide email, contraseña y el código de verificación, e imprime un texto JSON. Pegalo completo como valor del secreto `GARMINTOKENS`. Si en algún momento vence, repetí este paso.

Los secretos no se ven aunque el repo sea público.

### 3. Primera sincronización

**Actions → Sincronizar Garmin → Run workflow.** La primera vez baja todo el historial desde 2020, así que puede tardar unos minutos. Después corre solo todos los días.

Si falla al hacer `git push`, revisá **Settings → Actions → General → Workflow permissions** y elegí *Read and write permissions*.

### 4. Publicar la página

**Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)`.**

Queda en `https://<tu-usuario>.github.io/training_performance/`. En el celular, desde el navegador, usá *Agregar a pantalla de inicio* para abrirla como app.

## Configuración

Editá `config.json` (se puede hacer desde la web de GitHub):

```json
{
  "objetivos": { "natacion_km_semana": 10, "golf_rondas_semana": 1 },
  "proxima_carrera": { "nombre": "Cruce del lago", "fecha": "2027-01-15", "distancia_m": 3000 }
}
```

- `objetivos`: las metas de los anillos del resumen.
- `proxima_carrera`: aparece con una cuenta regresiva en *Natación → Aguas abiertas*.

## Desarrollo local

```bash
python3 -m http.server 8000
```

Abrí <http://localhost:8000>. Para regenerar los datos de ejemplo:

```bash
python3 scripts/sample_data.py
```

## Estructura

```
index.html, styles.css, app.js   página
config.json                      objetivos y próxima carrera
data/natacion.json               resumen de cada sesión de natación
data/sesiones/<id>.json          detalle de cada sesión (intervalos y piletas)
data/golf.json                   rondas con tarjeta hoyo por hoyo y hándicap
scripts/sync_garmin.py           descarga desde Garmin
scripts/garmin_login.py          genera los tokens para GARMINTOKENS
scripts/sample_data.py           datos de ejemplo
scripts/swimcalc.py              cálculo de récords
```
