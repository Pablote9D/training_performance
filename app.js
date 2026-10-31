/* Training Performance — dashboard de natación y golf.
 * Sin build: datos base en data/*.csv + registros locales (localStorage). */
(() => {
  'use strict';

  const SPORTS = {
    natacion: {
      file: 'data/natacion.csv',
      cols: ['fecha', 'distancia_m', 'duracion_min', 'estilo', 'tipo', 'rpe', 'notas'],
      nums: ['distancia_m', 'duracion_min', 'rpe'],
    },
    golf: {
      file: 'data/golf.csv',
      cols: ['fecha', 'tipo', 'cancha', 'hoyos', 'golpes', 'par', 'putts', 'fairways', 'fairways_total', 'gir', 'notas'],
      nums: ['hoyos', 'golpes', 'par', 'putts', 'fairways', 'fairways_total', 'gir'],
    },
  };

  const state = { base: { natacion: [], golf: [] }, local: { natacion: [], golf: [] }, tab: 'natacion' };
  const charts = {};
  const $ = (s) => document.querySelector(s);

  // ───────── utilidades ─────────
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin storage */ } },
  };

  function parseCSV(text) {
    const rows = [];
    let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.some((v) => v.trim() !== '')) rows.push(row);
        row = [];
      } else cur += c;
    }
    row.push(cur);
    if (row.some((v) => v.trim() !== '')) rows.push(row);
    if (!rows.length) return [];
    const head = rows.shift().map((h) => h.trim().toLowerCase());
    return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
  }

  function normalize(sport, r) {
    const out = {};
    for (const c of SPORTS[sport].cols) {
      const v = r[c] ?? '';
      out[c] = SPORTS[sport].nums.includes(c) ? (v === '' ? null : Number(v)) : String(v);
    }
    return out;
  }

  const csvCell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  function toCSV(sport, rows) {
    const cols = SPORTS[sport].cols;
    return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
  }

  const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fmtDay = (s) => parseDate(s).toLocaleDateString('es', { day: 'numeric', month: 'short' });
  const fmtNum = (n, d = 0) => n.toLocaleString('es', { maximumFractionDigits: d, minimumFractionDigits: d });
  const fmtPace = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  const fmtPar = (n) => (n > 0 ? `+${fmtNum(n, 1)}` : n < 0 ? `−${fmtNum(-n, 1)}` : 'E');
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ───────── datos ─────────
  const all = (sport) =>
    [...state.base[sport].map((r) => ({ ...r, _local: false })), ...state.local[sport].map((r, i) => ({ ...r, _local: true, _i: i }))]
      .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.fecha))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));

  function inRange(rows, days, offset = 0) {
    if (!days) return offset ? [] : rows;
    const end = new Date(); end.setHours(23, 59, 59, 999);
    end.setDate(end.getDate() - days * offset);
    const start = new Date(end); start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0);
    return rows.filter((r) => { const d = parseDate(r.fecha); return d >= start && d <= end; });
  }

  const period = () => Number($('#periodo').value);

  // ───────── KPIs ─────────
  function kpi(label, value, unit, delta) {
    let d = '';
    if (delta) d = `<div class="delta ${delta.cls || ''}">${esc(delta.text)}</div>`;
    return `<div class="kpi"><div class="label">${esc(label)}</div><div class="value">${value}${unit ? `<small>${esc(unit)}</small>` : ''}</div>${d}</div>`;
  }
  // betterUp: true si subir es bueno; null si es neutro
  function delta(cur, prev, fmt, betterUp) {
    if (prev == null || cur == null || !isFinite(prev) || !period()) return null;
    const diff = cur - prev;
    if (Math.abs(diff) < 1e-9) return { text: 'igual que el período anterior' };
    const good = betterUp == null ? null : (diff > 0) === betterUp;
    return { text: `${diff > 0 ? '▲' : '▼'} ${fmt(Math.abs(diff))} vs período anterior`, cls: good == null ? '' : good ? 'good' : 'bad' };
  }

  function swimStats(rows) {
    const dist = rows.reduce((s, r) => s + (r.distancia_m || 0), 0);
    const timed = rows.filter((r) => r.distancia_m && r.duracion_min);
    const tDist = timed.reduce((s, r) => s + r.distancia_m, 0);
    const tMin = timed.reduce((s, r) => s + r.duracion_min, 0);
    return { n: rows.length, dist, min: rows.reduce((s, r) => s + (r.duracion_min || 0), 0), pace: tDist ? (tMin * 60) / (tDist / 100) : null };
  }

  const eq18 = (r) => (r.hoyos === 9 ? 2 : 1);
  function golfStats(rows) {
    const rr = rows.filter((r) => r.golpes && r.par);
    const avg = (f) => { const v = rr.map(f).filter((x) => x != null && isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const fwRows = rr.filter((r) => r.fairways_total);
    const fw = fwRows.length ? (100 * fwRows.reduce((s, r) => s + r.fairways, 0)) / fwRows.reduce((s, r) => s + r.fairways_total, 0) : null;
    const girRows = rr.filter((r) => r.gir != null);
    const gir = girRows.length ? (100 * girRows.reduce((s, r) => s + r.gir, 0)) / girRows.reduce((s, r) => s + (r.hoyos || 18), 0) : null;
    const best = rr.length ? Math.min(...rr.map((r) => (r.golpes - r.par) * eq18(r))) : null;
    return {
      n: rr.length,
      over: avg((r) => (r.golpes - r.par) * eq18(r)),
      score: avg((r) => r.golpes * eq18(r)),
      putts: avg((r) => (r.putts == null ? null : r.putts * eq18(r))),
      fw, gir, best,
    };
  }

  // ───────── gráficos ─────────
  function baseOpts(extra = {}) {
    const text2 = cssVar('--text-2'), grid = cssVar('--grid');
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false, labels: { color: text2, usePointStyle: true, boxWidth: 8 } },
        tooltip: { backgroundColor: cssVar('--surface'), titleColor: cssVar('--text'), bodyColor: text2, borderColor: cssVar('--border'), borderWidth: 1, padding: 10, usePointStyle: true },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: text2, maxRotation: 0, autoSkipPadding: 12 }, border: { color: grid } },
        y: { grid: { color: grid }, ticks: { color: text2 }, border: { display: false } },
      },
      ...extra,
    };
  }

  function draw(id, config, hasData) {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    const canvas = document.getElementById(id);
    const box = canvas.parentElement;
    box.querySelector('.empty')?.remove();
    canvas.hidden = !hasData;
    if (!hasData) { box.insertAdjacentHTML('beforeend', '<div class="empty">Sin datos en este período</div>'); return; }
    charts[id] = new Chart(canvas, config);
  }

  const line = (color, data, label) => ({ label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.25, spanGaps: true });
  const bars = (color, data, label) => ({ label, data, backgroundColor: color, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28 });

  // ───────── render natación ─────────
  function renderSwim() {
    const rows = all('natacion');
    const cur = inRange(rows, period());
    const s = swimStats(cur), p = swimStats(inRange(rows, period(), 1));
    const hasPrev = period() && inRange(rows, period(), 1).length;

    $('#swim-kpis').innerHTML = [
      kpi('Distancia total', fmtNum(s.dist / 1000, 1), 'km', hasPrev && delta(s.dist / 1000, p.dist / 1000, (v) => `${fmtNum(v, 1)} km`, true)),
      kpi('Sesiones', fmtNum(s.n), '', hasPrev && delta(s.n, p.n, (v) => fmtNum(v), true)),
      kpi('Ritmo promedio', s.pace ? fmtPace(s.pace) : '–', '/100 m', hasPrev && s.pace && p.pace && delta(s.pace, p.pace, (v) => `${fmtNum(v, 0)} s`, false)),
      kpi('Tiempo en el agua', fmtNum(s.min / 60, 1), 'h', hasPrev && delta(s.min / 60, p.min / 60, (v) => `${fmtNum(v, 1)} h`, true)),
      kpi('Metros por sesión', s.n ? fmtNum(s.dist / s.n) : '–', 'm', null),
    ].join('');

    // distancia semanal (incluye semanas vacías)
    const weeks = new Map();
    if (cur.length) {
      const monday = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
      const startD = period() ? (() => { const d = new Date(); d.setDate(d.getDate() - period() + 1); return d; })() : parseDate(cur[0].fecha);
      for (let w = monday(startD); w <= new Date(); w.setDate(w.getDate() + 7)) weeks.set(iso(w), 0);
      for (const r of cur) { const k = iso(monday(parseDate(r.fecha))); weeks.set(k, (weeks.get(k) || 0) + (r.distancia_m || 0)); }
    }
    const c1 = cssVar('--series-1');
    draw('swim-weekly', {
      type: 'bar',
      data: { labels: [...weeks.keys()].map((k) => `sem ${fmtDay(k)}`), datasets: [bars(c1, [...weeks.values()], 'Distancia')] },
      options: baseOpts({
        plugins: { ...baseOpts().plugins, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: (c) => ` ${fmtNum(c.raw)} m` } } },
        scales: { ...baseOpts().scales, y: { ...baseOpts().scales.y, beginAtZero: true, ticks: { color: cssVar('--text-2'), callback: (v) => `${fmtNum(v / 1000, 1)} km` } } },
      }),
    }, weeks.size > 0);

    // ritmo por sesión
    const paced = cur.filter((r) => r.distancia_m && r.duracion_min);
    draw('swim-pace', {
      type: 'line',
      data: { labels: paced.map((r) => fmtDay(r.fecha)), datasets: [line(c1, paced.map((r) => (r.duracion_min * 60) / (r.distancia_m / 100)), 'Ritmo')] },
      options: baseOpts({
        plugins: { ...baseOpts().plugins, tooltip: { ...baseOpts().plugins.tooltip, callbacks: {
          label: (c) => ` ${fmtPace(c.raw)} /100 m`,
          afterLabel: (c) => { const r = paced[c.dataIndex]; return ` ${fmtNum(r.distancia_m)} m · ${r.estilo} · ${r.tipo}`; },
        } } },
        scales: { ...baseOpts().scales, y: { ...baseOpts().scales.y, ticks: { color: cssVar('--text-2'), callback: (v) => fmtPace(v) } } },
      }),
    }, paced.length > 0);

    // metros por estilo
    const byStroke = {};
    for (const r of cur) byStroke[r.estilo || 'otro'] = (byStroke[r.estilo || 'otro'] || 0) + (r.distancia_m || 0);
    const strokes = Object.entries(byStroke).sort((a, b) => b[1] - a[1]);
    draw('swim-stroke', {
      type: 'bar',
      data: { labels: strokes.map((x) => x[0]), datasets: [bars(c1, strokes.map((x) => x[1]), 'Metros')] },
      options: baseOpts({
        indexAxis: 'y',
        interaction: { mode: 'nearest', intersect: true, axis: 'y' },
        plugins: { ...baseOpts().plugins, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: (c) => ` ${fmtNum(c.raw)} m (${fmtNum((100 * c.raw) / (s.dist || 1))}%)` } } },
        scales: {
          x: { grid: { color: cssVar('--grid') }, beginAtZero: true, ticks: { color: cssVar('--text-2'), callback: (v) => `${fmtNum(v / 1000, 0)} km` }, border: { display: false } },
          y: { grid: { display: false }, ticks: { color: cssVar('--text-2') } },
        },
      }),
    }, strokes.length > 0);

    renderTable('natacion', '#swim-table', [
      ['Fecha', (r) => esc(r.fecha)],
      ['Distancia', (r) => `${fmtNum(r.distancia_m || 0)} m`, 'num'],
      ['Duración', (r) => (r.duracion_min ? `${r.duracion_min} min` : '–'), 'num'],
      ['Ritmo', (r) => (r.distancia_m && r.duracion_min ? fmtPace((r.duracion_min * 60) / (r.distancia_m / 100)) : '–'), 'num'],
      ['Estilo', (r) => esc(r.estilo)],
      ['Tipo', (r) => esc(r.tipo)],
      ['RPE', (r) => (r.rpe ?? '–'), 'num'],
      ['Notas', (r) => esc(r.notas)],
    ], cur);
  }

  // ───────── render golf ─────────
  function renderGolf() {
    const rows = all('golf').filter((r) => r.golpes);
    const cur = inRange(rows, period());
    const prevRows = inRange(rows, period(), 1);
    const s = golfStats(cur), p = golfStats(prevRows);
    const hasPrev = period() && prevRows.length;

    $('#golf-kpis').innerHTML = [
      kpi('Rondas', fmtNum(s.n), '', hasPrev && delta(s.n, p.n, (v) => fmtNum(v), null)),
      kpi('Promedio (18 h)', s.score != null ? fmtNum(s.score, 1) : '–', 'golpes', hasPrev && delta(s.score, p.score, (v) => fmtNum(v, 1), false)),
      kpi('Mejor ronda', s.best != null ? fmtPar(s.best) : '–', 'vs par', null),
      kpi('Putts (18 h)', s.putts != null ? fmtNum(s.putts, 1) : '–', '', hasPrev && delta(s.putts, p.putts, (v) => fmtNum(v, 1), false)),
      kpi('Fairways', s.fw != null ? fmtNum(s.fw) : '–', '%', hasPrev && delta(s.fw, p.fw, (v) => `${fmtNum(v)} pts`, true)),
      kpi('GIR', s.gir != null ? fmtNum(s.gir) : '–', '%', hasPrev && delta(s.gir, p.gir, (v) => `${fmtNum(v)} pts`, true)),
    ].join('');

    const labels = cur.map((r) => fmtDay(r.fecha));
    const c1 = cssVar('--series-1'), c2 = cssVar('--series-2');
    const detail = (c) => { const r = cur[c.dataIndex]; return ` ${r.cancha} · ${r.hoyos} hoyos · ${r.golpes} golpes`; };

    draw('golf-score', {
      type: 'line',
      data: { labels, datasets: [line(c2, cur.map((r) => (r.golpes - r.par) * eq18(r)), 'Sobre el par')] },
      options: baseOpts({
        plugins: { ...baseOpts().plugins, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: (c) => ` ${fmtPar(c.raw)} (18 h)`, afterLabel: detail } } },
        scales: { ...baseOpts().scales, y: { ...baseOpts().scales.y, ticks: { color: cssVar('--text-2'), callback: (v) => fmtPar(v) } } },
      }),
    }, cur.length > 0);

    const putted = cur.map((r) => (r.putts == null ? null : r.putts * eq18(r)));
    draw('golf-putts', {
      type: 'bar',
      data: { labels, datasets: [bars(c2, putted, 'Putts')] },
      options: baseOpts({
        plugins: { ...baseOpts().plugins, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: (c) => ` ${fmtNum(c.raw)} putts`, afterLabel: detail } } },
        scales: { ...baseOpts().scales, y: { ...baseOpts().scales.y, suggestedMin: 20 } },
      }),
    }, putted.some((v) => v != null));

    const pct = (a, b) => (a == null || !b ? null : (100 * a) / b);
    draw('golf-acc', {
      type: 'line',
      data: { labels, datasets: [
        line(c1, cur.map((r) => pct(r.fairways, r.fairways_total)), 'Fairways'),
        { ...line(c2, cur.map((r) => pct(r.gir, r.hoyos)), 'GIR'), pointStyle: 'rectRot', pointRadius: 4 },
      ] },
      options: baseOpts({
        plugins: { ...baseOpts().plugins, legend: { ...baseOpts().plugins.legend, display: true, position: 'top', align: 'end' },
          tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: (c) => ` ${c.dataset.label}: ${c.raw == null ? '–' : fmtNum(c.raw) + '%'}` } } },
        scales: { ...baseOpts().scales, y: { ...baseOpts().scales.y, min: 0, max: 100, ticks: { color: cssVar('--text-2'), callback: (v) => `${v}%` } } },
      }),
    }, cur.length > 0);

    renderTable('golf', '#golf-table', [
      ['Fecha', (r) => esc(r.fecha)],
      ['Cancha', (r) => esc(r.cancha)],
      ['Hoyos', (r) => r.hoyos, 'num'],
      ['Golpes', (r) => r.golpes, 'num'],
      ['vs Par', (r) => fmtPar(r.golpes - r.par), 'num'],
      ['Putts', (r) => r.putts ?? '–', 'num'],
      ['Fairways', (r) => (r.fairways_total ? `${r.fairways}/${r.fairways_total}` : '–'), 'num'],
      ['GIR', (r) => (r.gir != null ? `${r.gir}/${r.hoyos}` : '–'), 'num'],
      ['Notas', (r) => esc(r.notas)],
    ], cur);
  }

  function renderTable(sport, sel, cols, rows) {
    const head = `<tr>${cols.map(([h, , c]) => `<th class="${c || ''}">${h}</th>`).join('')}<th></th></tr>`;
    const body = [...rows].reverse().map((r) =>
      `<tr class="${r._local ? 'local' : ''}">${cols.map(([, f, c]) => `<td class="${c || ''}">${f(r)}</td>`).join('')}` +
      `<td>${r._local ? `<button class="del" title="Borrar" data-sport="${sport}" data-i="${r._i}">✕</button>` : ''}</td></tr>`).join('');
    $(sel).innerHTML = `<thead>${head}</thead><tbody>${body || `<tr><td colspan="${cols.length + 1}" class="sub">Sin registros en este período</td></tr>`}</tbody>`;
  }

  function render() { state.tab === 'natacion' ? renderSwim() : renderGolf(); }

  // ───────── eventos ─────────
  function saveLocal(sport) { store.set(`tp:${sport}`, state.local[sport]); }

  function bind() {
    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      document.querySelectorAll('.tab').forEach((t) => { t.hidden = t.id !== `tab-${state.tab}`; });
      store.set('tp:tab', state.tab);
      render();
    }));

    $('#periodo').addEventListener('change', () => { store.set('tp:periodo', $('#periodo').value); render(); });

    $('#theme-toggle').addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme
        ? document.documentElement.dataset.theme === 'dark'
        : matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.dataset.theme = dark ? 'light' : 'dark';
      store.set('tp:theme', document.documentElement.dataset.theme);
      render();
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);

    for (const [sport, formSel] of [['natacion', '#swim-form'], ['golf', '#golf-form']]) {
      const form = $(formSel);
      form.fecha.value = iso(new Date());
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        state.local[sport].push(normalize(sport, Object.fromEntries(new FormData(form))));
        saveLocal(sport);
        const keep = { cancha: form.cancha?.value, par: form.par?.value, fairways_total: form.fairways_total?.value };
        form.reset();
        form.fecha.value = iso(new Date());
        if (sport === 'golf') Object.entries(keep).forEach(([k, v]) => { if (v) form[k].value = v; });
        render();
      });
    }

    document.addEventListener('click', (e) => {
      const del = e.target.closest('.del');
      if (del) {
        if (!confirm('¿Borrar este registro?')) return;
        state.local[del.dataset.sport].splice(Number(del.dataset.i), 1);
        saveLocal(del.dataset.sport);
        render();
      }
      const exp = e.target.closest('[data-export]');
      if (exp) {
        const sport = exp.dataset.export;
        const rows = all(sport).map(({ _local, _i, ...r }) => r);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([toCSV(sport, rows)], { type: 'text/csv' }));
        a.download = `${sport}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
    });

    document.querySelectorAll('[data-import]').forEach((inp) => inp.addEventListener('change', async () => {
      const sport = inp.dataset.import;
      const file = inp.files[0];
      if (!file) return;
      const rows = parseCSV(await file.text()).map((r) => normalize(sport, r));
      const seen = new Set(all(sport).map(({ _local, _i, ...r }) => JSON.stringify(r)));
      const fresh = rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.fecha) && !seen.has(JSON.stringify(r)));
      state.local[sport].push(...fresh);
      saveLocal(sport);
      inp.value = '';
      alert(`Importados ${fresh.length} registros nuevos (${rows.length - fresh.length} ya existían o eran inválidos).`);
      render();
    }));
  }

  // ───────── init ─────────
  async function init() {
    const theme = store.get('tp:theme', null);
    if (theme) document.documentElement.dataset.theme = theme;
    const per = store.get('tp:periodo', null);
    if (per != null) $('#periodo').value = per;
    for (const sport of Object.keys(SPORTS)) state.local[sport] = store.get(`tp:${sport}`, []);

    const failed = [];
    await Promise.all(Object.entries(SPORTS).map(async ([sport, cfg]) => {
      try {
        const res = await fetch(cfg.file, { cache: 'no-store' });
        if (!res.ok) throw new Error(res.status);
        state.base[sport] = parseCSV(await res.text()).map((r) => normalize(sport, r));
      } catch { failed.push(cfg.file); }
    }));
    if (failed.length) {
      const aviso = $('#aviso');
      aviso.hidden = false;
      aviso.textContent = `No se pudo leer ${failed.join(' y ')}. Si abriste el archivo directo (file://), serví la carpeta con "python3 -m http.server" o usá "Importar CSV".`;
    }

    bind();
    const tab = store.get('tp:tab', 'natacion');
    document.querySelector(`.tabs button[data-tab="${tab}"]`)?.click() ?? render();
  }

  if (window.Chart) Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  init();
})();
