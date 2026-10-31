/* Training Performance — natación y golf desde Garmin.
 * Página estática: lee data/natacion.json, data/sesiones/<id>.json, data/golf.json y config.json. */
(() => {
  'use strict';

  const $app = document.getElementById('app');
  const $tip = document.getElementById('tip');

  const PERIODS = [['S', 7, 'Semana'], ['M', 30, 'Mes'], ['3M', 90, '3 meses'], ['A', 365, 'Año'], ['Todo', 0, 'Todo']];
  const ICON = {
    swim: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 18c2 0 2-1.5 4-1.5S8 18 10 18s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><circle cx="16" cy="7" r="2"/><path d="M4 13l5-4 3 2 4-2"/></svg>',
    golf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21V3l9 4-9 4"/><ellipse cx="12" cy="21" rx="7" ry="1.5"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></svg>',
  };

  // ───────── estado ─────────
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin storage */ } },
  };
  const S = {
    swim: { sessions: [] },
    golf: { rounds: [], handicap: null },
    cfg: {},
    detail: new Map(),
    env: store.get('tp:env', 'pool'),
    per: store.get('tp:per', '3M'),
    golfPer: store.get('tp:golfPer', '3M'),
    shown: 10,
  };
  let afterRender = [];

  // ───────── formato ─────────
  const nf = (n, d = 0) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pad = (n) => String(n).padStart(2, '0');
  function clock(sec) {
    if (sec == null || !isFinite(sec)) return '—';
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }
  const minutes = (sec) => (sec >= 3600 ? clock(sec).replace(/:\d\d$/, ' h') : `${Math.round(sec / 60)} min`);
  const pace = (sec, m) => (m > 0 && sec > 0 ? sec / (m / 100) : null);
  const vsPar = (n) => (n == null ? '—' : n === 0 ? 'E' : n > 0 ? `+${n}` : `−${-n}`);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const meters = (m) => `${nf(m)} m`;

  const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const isoD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const monday = (d) => addDays(d, -((d.getDay() + 6) % 7));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const shortDate = (s) => parseD(s).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace('.', '');
  function dayLabel(s) {
    const diff = Math.round((today() - parseD(s)) / 864e5);
    if (diff === 0) return 'Hoy';
    if (diff === 1) return 'Ayer';
    const opts = diff < 7 ? { weekday: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' };
    return cap(parseD(s).toLocaleDateString('es-AR', opts).replace(/\./g, '').replace(',', ''));
  }

  function inPeriod(rows, days, offset = 0) {
    if (!days) return offset ? [] : rows;
    const end = addDays(today(), 1 - days * offset);
    const start = addDays(end, -days);
    return rows.filter((r) => { const d = parseD(r.date); return d >= start && d < end; });
  }
  const periodDays = (key) => (PERIODS.find((p) => p[0] === key) || PERIODS[2])[1];

  // ───────── natación: cálculos ─────────
  const moving = (s) => s.moving_s || s.duration_s || 0;
  const swimPace = (s) => pace(moving(s), s.distance_m);
  function swimAgg(rows) {
    const dist = rows.reduce((a, s) => a + (s.distance_m || 0), 0);
    const mov = rows.reduce((a, s) => a + (s.distance_m ? moving(s) : 0), 0);
    const sw = rows.filter((s) => s.swolf);
    const w = sw.reduce((a, s) => a + (s.lengths || 1), 0);
    return {
      n: rows.length,
      dist,
      pace: pace(mov, dist),
      swolf: w ? sw.reduce((a, s) => a + s.swolf * (s.lengths || 1), 0) / w : null,
      longest: rows.reduce((a, s) => Math.max(a, s.distance_m || 0), 0),
    };
  }

  // ───────── golf: cálculos ─────────
  const full18 = (r) => r.holes_played === 18 && r.strokes;
  function golfAgg(rows) {
    const f = rows.filter(full18);
    const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const fwT = rows.reduce((a, r) => a + (r.fairways_total || 0), 0);
    const girT = rows.reduce((a, r) => a + (r.gir == null ? 0 : r.gir_total || r.holes_played || 0), 0);
    const best = f.reduce((b, r) => (!b || r.strokes < b.strokes ? r : b), null);
    const putted = rows.filter((r) => r.putts != null && r.holes_played);
    return {
      n: rows.length,
      avg: avg(f.map((r) => r.strokes)),
      best,
      putts: putted.length ? (18 * putted.reduce((a, r) => a + r.putts, 0)) / putted.reduce((a, r) => a + r.holes_played, 0) : null,
      fw: fwT ? (100 * rows.reduce((a, r) => a + (r.fairways_hit || 0), 0)) / fwT : null,
      gir: girT ? (100 * rows.reduce((a, r) => a + (r.gir || 0), 0)) / girT : null,
    };
  }

  // ───────── piezas de UI ─────────
  /** Variación vs. período anterior. better: 'up' | 'down' | null (neutro). */
  function delta(cur, prev, fmt, better, suffix = 'vs. período ant.') {
    if (cur == null || prev == null || !isFinite(cur) || !isFinite(prev)) return '';
    const d = cur - prev;
    if (Math.abs(d) < 1e-9 || !/[1-9]/.test(fmt(Math.abs(d)))) return `<div class="sub">= ${suffix}</div>`;
    const cls = better == null ? '' : (d > 0) === (better === 'up') ? 'good' : 'bad';
    return `<div class="sub delta ${cls}">${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d))} ${suffix}</div>`;
  }
  const kpi = (label, value, unit = '', sub = '') =>
    `<div class="kpi"><div class="label">${label}</div><div class="value">${value}${unit ? `<small> ${unit}</small>` : ''}</div>${sub}</div>`;

  function pills(kind, current, action) {
    return `<div class="pills ${kind}" role="group" aria-label="Período">${PERIODS.map(([k, , name]) =>
      `<button type="button" data-act="${action}" data-val="${k}" aria-pressed="${k === current}" aria-label="${name}">${k}</button>`).join('')}</div>`;
  }

  function sampleBanner() {
    if (!S.swim.sample && !S.golf.sample) return '';
    return `<div class="banner">${ICON.info}<div><b>Datos de ejemplo.</b> Cuando conectes tu Garmin (ver README) se reemplazan por tus actividades reales.</div></div>`;
  }

  function bars(items, opts = {}) {
    const max = Math.max(...items.map((i) => i.v), 0) || 1;
    return `<div class="bars ${opts.cls || ''}" role="img" aria-label="${esc(opts.label || '')}">${items.map((i) =>
      `<div class="b ${i.cls || ''}" ${i.tip ? `data-tip="${esc(i.tip)}"` : ''}><span style="height:${i.h != null ? i.h : (100 * i.v) / max}%"></span></div>`).join('')}</div>`;
  }

  let sparkId = 0;
  /** Línea simple con lectura al pasar el dedo/mouse. */
  function spark(points, { color, fmt, height = 64, label }) {
    if (points.length < 2) return `<div class="empty">Hacen falta al menos 2 registros en el período</div>`;
    const id = `sp${++sparkId}`;
    const W = 300, H = height, P = 6;
    const vals = points.map((p) => p.v);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const x = (i) => P + (i * (W - 2 * P)) / (points.length - 1);
    const y = (v) => P + ((hi - v) * (H - 2 * P)) / (hi - lo);
    const pts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const last = points.length - 1;
    afterRender.push(() => {
      const root = document.getElementById(id);
      if (!root) return;
      const svg = root.querySelector('svg'), dot = root.querySelector('.dot'), rule = root.querySelector('.rule'), out = root.querySelector('.readout');
      const show = (i) => {
        dot.style.left = `${(100 * x(i)) / W}%`; dot.style.top = `${y(points[i].v)}px`;
        rule.setAttribute('x1', x(i)); rule.setAttribute('x2', x(i));
        rule.style.opacity = i === last ? 0 : 1;
        out.textContent = `${fmt(points[i].v)} · ${points[i].label}`;
      };
      const at = (e) => {
        const r = svg.getBoundingClientRect();
        const i = Math.round((((e.clientX - r.left) / r.width) * W - P) / ((W - 2 * P) / last));
        show(Math.max(0, Math.min(last, i)));
      };
      svg.addEventListener('pointermove', at);
      svg.addEventListener('pointerdown', at);
      svg.addEventListener('pointerleave', () => show(last));
      show(last);
    });
    return `<div class="spark" id="${id}">
      <svg viewBox="0 0 ${W} ${H}" height="${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">
        <line class="rule" x1="0" x2="0" y1="0" y2="${H}" stroke="#48484a" stroke-width="1" vector-effect="non-scaling-stroke"/>
        <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      </svg>
      <span class="dot" style="background:${color}" aria-hidden="true"></span>
      <div class="readout"></div>
    </div>`;
  }

  function ring(swimPct, golfPct) {
    const c1 = 2 * Math.PI * 46, c2 = 2 * Math.PI * 29;
    const arc = (pct, c) => `${Math.max(0.001, Math.min(1, pct)) * c} ${c}`;
    return `<svg width="110" height="110" viewBox="0 0 110 110" role="img" aria-label="Objetivos semanales: natación ${Math.round(swimPct * 100)}%, golf ${Math.round(golfPct * 100)}%">
      <circle cx="55" cy="55" r="46" fill="none" stroke="var(--swim-track)" stroke-width="14"/>
      <circle cx="55" cy="55" r="46" fill="none" stroke="var(--swim)" stroke-width="14" stroke-linecap="round" stroke-dasharray="${arc(swimPct, c1)}" transform="rotate(-90 55 55)"/>
      <circle cx="55" cy="55" r="29" fill="none" stroke="var(--golf-track)" stroke-width="14"/>
      <circle cx="55" cy="55" r="29" fill="none" stroke="var(--golf)" stroke-width="14" stroke-linecap="round" stroke-dasharray="${arc(golfPct, c2)}" transform="rotate(-90 55 55)"/>
    </svg>`;
  }

  function swimRow(s) {
    const meta = [dayLabel(s.date), s.env === 'pool' ? `${s.pool_m || 25} m` : 'aguas abiertas', minutes(s.duration_s), s.avg_hr ? `FC ${s.avg_hr}` : ''].filter(Boolean).join(' · ');
    return `<a class="row swim" href="#/natacion/${s.id}">
      <div class="ico swim">${ICON.swim}</div>
      <div class="main"><div class="t">${esc(s.name || (s.env === 'pool' ? 'Natación en pileta' : 'Aguas abiertas'))}</div><div class="m">${meta}</div></div>
      <div class="end"><div class="v">${meters(s.distance_m)}</div><div class="s">${clock(swimPace(s))} /100m</div></div>
    </a>`;
  }

  function golfRow(r) {
    const over = r.par ? r.strokes - r.par : null;
    const sub = [over != null ? vsPar(over) : '', r.putts != null ? `${r.putts} putts` : ''].filter(Boolean).join(' · ');
    return `<a class="row golf" href="#/golf/${r.id}">
      <div class="ico golf">${ICON.golf}</div>
      <div class="main"><div class="t">${esc(r.course || 'Ronda de golf')}</div><div class="m">${dayLabel(r.date)} · ${r.holes_played} hoyos</div></div>
      <div class="end"><div class="v">${r.strokes}</div><div class="s">${sub}</div></div>
    </a>`;
  }

  function updatedLine() {
    const u = [S.swim.updated, S.golf.updated].filter(Boolean).sort().pop();
    if (!u) return '';
    const d = new Date(u);
    return `<p class="hint" style="text-align:center">Actualizado ${d.toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>`;
  }

  // ───────── vista: resumen ─────────
  function viewResumen() {
    const ws = monday(today());
    const goals = S.cfg.objetivos || {};
    const swimGoal = goals.natacion_km_semana || 10, golfGoal = goals.golf_rondas_semana || 1;
    const thisW = S.swim.sessions.filter((s) => parseD(s.date) >= ws);
    const lastW = S.swim.sessions.filter((s) => { const d = parseD(s.date); return d >= addDays(ws, -7) && d < ws; });
    const km = thisW.reduce((a, s) => a + s.distance_m, 0) / 1000;
    const rounds = S.golf.rounds.filter((r) => parseD(r.date) >= ws).length;
    const a = swimAgg(thisW), b = swimAgg(lastW);

    const recentFull = S.golf.rounds.filter(full18).slice(-5);
    const golfCard = S.golf.handicap != null
      ? kpi('Índice hándicap', nf(S.golf.handicap, 1), '', '<div class="sub">según Garmin</div>')
      : kpi('Promedio últimas 5', recentFull.length ? nf(golfAgg(recentFull).avg, 1) : '—', 'golpes', '<div class="sub">rondas de 18 hoyos</div>');

    const latest = [
      ...S.swim.sessions.slice(-4).map((s) => ({ k: `${s.date} ${s.time}`, html: swimRow(s) })),
      ...S.golf.rounds.slice(-4).map((r) => ({ k: `${r.date} ${r.time}`, html: golfRow(r) })),
    ].sort((x, y) => y.k.localeCompare(x.k)).slice(0, 4);

    return `
      <header class="head">
        <div class="eyebrow">${cap(new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
        <h1 class="title">Resumen</h1>
      </header>
      ${sampleBanner()}
      <section class="card ring-card" aria-label="Objetivos de la semana">
        ${ring(km / swimGoal, rounds / golfGoal)}
        <div class="ring-legend">
          <div><div style="font-weight:600">Natación</div><div class="v" style="color:var(--swim)">${nf(km, 1)}<small>/${nf(swimGoal)} km</small></div></div>
          <div><div style="font-weight:600">Golf</div><div class="v" style="color:var(--golf)">${rounds}<small>/${golfGoal} ${golfGoal === 1 ? 'ronda' : 'rondas'}</small></div></div>
          <div class="hint">Esta semana (desde el lunes)</div>
        </div>
      </section>
      <section class="cols">
        ${kpi('Ritmo semana', a.pace ? clock(a.pace) : '—', '/100m', delta(a.pace, b.pace, (v) => `${Math.round(v)} s`, 'down', 'vs. sem. pasada'))}
        ${golfCard}
      </section>
      <section class="stack">
        <h2 class="section-title">Últimas actividades</h2>
        ${latest.map((x) => x.html).join('') || '<div class="empty">Todavía no hay actividades</div>'}
      </section>
      ${updatedLine()}`;
  }

  // ───────── vista: natación ─────────
  function volumeChart(rows) {
    const days = periodDays(S.per);
    let buckets = [], title, unitLbl;
    if (days && days <= 90) {
      const n = days === 90 ? 13 : 8;
      const start = addDays(monday(today()), -7 * (n - 1));
      for (let i = 0; i < n; i++) buckets.push({ from: addDays(start, 7 * i), to: addDays(start, 7 * (i + 1)), v: 0 });
      title = 'Volumen semanal'; unitLbl = (b) => `Semana del ${shortDate(isoD(b.from))}`;
    } else {
      const first = days ? addDays(today(), -days + 1) : (rows[0] ? parseD(rows[0].date) : today());
      let m = new Date(first.getFullYear(), first.getMonth(), 1);
      const end = today();
      while (m <= end) { const nx = new Date(m.getFullYear(), m.getMonth() + 1, 1); buckets.push({ from: m, to: nx, v: 0 }); m = nx; }
      title = 'Volumen mensual'; unitLbl = (b) => cap(b.from.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }));
    }
    for (const s of rows) {
      const d = parseD(s.date);
      const b = buckets.find((x) => d >= x.from && d < x.to);
      if (b) b.v += s.distance_m || 0;
    }
    const avg = buckets.reduce((a, b) => a + b.v, 0) / (buckets.length || 1);
    const items = buckets.map((b, i) => ({
      v: b.v, cls: (i === buckets.length - 1 ? 'cur ' : '') + (b.v ? '' : 'zero'),
      tip: `${unitLbl(b)}\n${nf(b.v / 1000, 1)} km`,
    }));
    const lbl = (b) => (title === 'Volumen semanal' ? shortDate(isoD(b.from)) : cap(b.from.toLocaleDateString('es-AR', { month: 'short' }).replace('.', '')));
    const mid = buckets[Math.floor(buckets.length / 2)];
    return `<section class="card wide">
      <div class="card-head"><h2 class="card-title">${title}</h2><span class="muted">prom. ${nf(avg / 1000, 1)} km</span></div>
      ${bars(items, { label: `${title}, promedio ${nf(avg / 1000, 1)} km` })}
      <div class="axis"><span>${lbl(buckets[0])}</span><span>${lbl(mid)}</span><span>${title === 'Volumen semanal' ? 'esta sem.' : 'este mes'}</span></div>
    </section>`;
  }

  function prCard(pool) {
    const best = {};
    for (const s of pool) for (const [d, t] of Object.entries(s.best || {})) if (!best[d] || t < best[d].t) best[d] = { t, s };
    const longest = pool.reduce((a, s) => (!a || s.distance_m > a.distance_m ? s : a), null);
    const rows = Object.keys(best).sort((a, b) => a - b).map((d) =>
      `<a class="list-row" href="#/natacion/${best[d].s.id}" style="color:inherit"><span>${nf(+d)} m</span><span class="muted">${shortDate(best[d].s.date)}</span><span class="big">${clock(best[d].t)}</span></a>`);
    if (longest) rows.push(`<a class="list-row" href="#/natacion/${longest.id}" style="color:inherit"><span>Sesión más larga</span><span class="muted">${shortDate(longest.date)}</span><span class="big">${meters(longest.distance_m)}</span></a>`);
    return `<section class="card">
      <div class="card-head"><h2 class="card-title">Récords personales</h2><span class="muted">pileta · histórico</span></div>
      <div>${rows.join('') || '<div class="empty">Sin récords todavía</div>'}</div>
      <div class="hint">Mejor tiempo nadado de corrido dentro de un intervalo.</div>
    </section>`;
  }

  function raceCard() {
    const c = S.cfg.proxima_carrera || {};
    if (!c.nombre || !c.fecha) return '';
    const days = Math.round((parseD(c.fecha) - today()) / 864e5);
    if (days < 0) return '';
    return `<section class="card wide">
      <div class="card-head"><h2 class="card-title">Próxima carrera</h2><span class="muted">${shortDate(c.fecha)}</span></div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px">
        <div><div style="font-size:17px;font-weight:600">${esc(c.nombre)}</div>${c.distancia_m ? `<div class="muted">${meters(c.distancia_m)}</div>` : ''}</div>
        <div style="font-size:28px;font-weight:700;color:var(--swim)" class="num">${days === 0 ? '¡Hoy!' : `${days} <small style="font-size:14px;color:var(--text-2)">${days === 1 ? 'día' : 'días'}</small>`}</div>
      </div>
    </section>`;
  }

  function viewNatacion() {
    const pool = S.env === 'pool';
    const rows = S.swim.sessions.filter((s) => s.env === S.env);
    const days = periodDays(S.per);
    const cur = inPeriod(rows, days), prev = inPeriod(rows, days, 1);
    const a = swimAgg(cur), b = swimAgg(prev);
    const hasPrev = days && prev.length;
    const d = (x, y, f, bt) => (hasPrev ? delta(x, y, f, bt) : '');

    const kpis = [
      kpi('Distancia', nf(a.dist / 1000, 1), 'km', d(a.dist / 1000, b.dist / 1000, (v) => `${nf(v, 1)} km`, 'up')),
      kpi(pool ? 'Sesiones' : 'Nados', a.n, '', d(a.n, b.n, (v) => nf(v), 'up')),
      kpi('Ritmo prom.', a.pace ? clock(a.pace) : '—', '/100m', d(a.pace, b.pace, (v) => `${Math.round(v)} s`, 'down')),
      pool
        ? kpi('SWOLF prom.', a.swolf ? nf(a.swolf) : '—', '', d(a.swolf, b.swolf, (v) => nf(v, 1), 'down'))
        : kpi('Más largo', a.longest ? nf(a.longest) : '—', 'm'),
    ].join('');

    const pts = cur.filter((s) => swimPace(s));
    const paceSpark = spark(pts.map((s) => ({ v: swimPace(s), label: shortDate(s.date) })), { color: 'var(--swim)', fmt: (v) => `${clock(v)} /100m`, label: 'Ritmo por sesión' });
    const swPts = cur.filter((s) => s.swolf);
    const swolfSpark = spark(swPts.map((s) => ({ v: s.swolf, label: shortDate(s.date) })), { color: 'var(--swolf)', fmt: (v) => `SWOLF ${nf(v)}`, label: 'SWOLF por sesión' });

    const list = [...cur].reverse();
    return `
      <header class="head"><h1 class="title">Natación</h1></header>
      ${sampleBanner()}
      <div class="segmented" role="group" aria-label="Tipo de nado">
        <button type="button" data-act="env" data-val="pool" aria-pressed="${pool}">Pileta</button>
        <button type="button" data-act="env" data-val="ow" aria-pressed="${!pool}">Aguas abiertas</button>
      </div>
      ${pills('swim', S.per, 'per')}
      <section class="cols kpis swim">${kpis}</section>
      <div class="split">
        ${pool ? '' : raceCard()}
        ${volumeChart(rows)}
        <section class="card">
          <div class="card-head"><h2 class="card-title">Ritmo /100m</h2><span class="hint">menor es mejor</span></div>
          ${paceSpark}
        </section>
        ${pool ? `<section class="card">
          <div class="card-head"><h2 class="card-title">SWOLF</h2><span class="hint">menor es mejor</span></div>
          ${swolfSpark}
          <div class="hint">Tiempo + brazadas por pileta.</div>
        </section>` : ''}
        ${pool ? prCard(rows) : ''}
        <section class="stack ${pool ? '' : 'wide'}">
          <h2 class="section-title">Sesiones</h2>
          ${list.slice(0, S.shown).map(swimRow).join('') || `<div class="empty">No hay ${pool ? 'sesiones en pileta' : 'nados en aguas abiertas'} en este período</div>`}
          ${list.length > S.shown ? `<button type="button" class="more" data-act="more">Ver más (${list.length - S.shown})</button>` : ''}
        </section>
      </div>`;
  }

  // ───────── vista: sesión ─────────
  function viewSesion(id) {
    const s = S.swim.sessions.find((x) => String(x.id) === id);
    if (!s) return notFound('#/natacion', 'Natación');
    const det = S.detail.get(s.id);
    if (det === undefined && s.has_detail) {
      fetchJSON(`data/sesiones/${s.id}.json`).then((d) => { S.detail.set(s.id, d); render(); }).catch(() => { S.detail.set(s.id, null); render(); });
    }
    const intervals = det?.intervals || [];
    const loading = det === undefined && s.has_detail;

    const stats = [
      ['Distancia', meters(s.distance_m), 'var(--swim)'],
      ['Tiempo', clock(s.duration_s)],
      ['Ritmo', `${clock(swimPace(s))}`],
      ['SWOLF', s.swolf ?? '—', 'var(--swolf)'],
      ['FC prom.', s.avg_hr ?? '—', 'var(--hr)'],
      ['Calorías', s.calories ?? '—'],
    ].map(([l, v, c]) => `<div><div class="label">${l}</div><div class="value" ${c ? `style="color:${c}"` : ''}>${v}</div></div>`).join('');

    // piletas
    let lapsHtml = '';
    const all = intervals.flatMap((it) => it.lengths || []).filter((l) => l.t && l.d);
    if (all.length) {
      const speeds = all.map((l) => l.d / l.t);
      const lo = Math.min(...speeds) * 0.85, hi = Math.max(...speeds);
      let k = 0, act = 0;
      const items = [];
      for (const it of intervals) {
        if (it.kind === 'rest') { if (items.length) items.push({ v: 0, h: 0, cls: 'rest' }); continue; }
        const cls = act++ % 2 ? 'alt' : 'main';
        for (const l of it.lengths || []) {
          if (!l.t || !l.d) continue;
          k++;
          const tip = [`Pileta ${k}`, `${clock(l.t)} · ${clock(pace(l.t, l.d))} /100m`, [l.swolf ? `SWOLF ${l.swolf}` : '', l.stroke || ''].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
          items.push({ v: 1, h: 8 + (92 * (l.d / l.t - lo)) / (hi - lo || 1), cls, tip });
        }
      }
      lapsHtml = `<section class="card wide">
        <div class="card-head"><h2 class="card-title">Ritmo por pileta</h2><span class="muted">${k} piletas</span></div>
        ${bars(items, { cls: 'laps', label: `Ritmo de cada una de las ${k} piletas` })}
        <div class="legend"><span><i style="background:var(--swim)"></i><i style="background:var(--swim-dim);margin-left:-4px"></i>Intervalos (alternados)</span><span>más alto = más rápido · huecos = descansos</span></div>
      </section>`;
    }

    // zonas FC
    let zonesHtml = '';
    if (s.hr_zones && s.hr_zones.some(Boolean)) {
      const max = Math.max(...s.hr_zones);
      zonesHtml = `<section class="card">
        <h2 class="card-title">Zonas de frecuencia cardíaca</h2>
        <div class="zones">${s.hr_zones.map((sec, i) => ({ sec, i })).reverse().map(({ sec, i }) =>
          `<div class="zone"><span class="muted">Z${i + 1}</span><div class="track"><div class="fill" style="width:${(100 * sec) / max}%;background:var(--z${i + 1})"></div></div><span class="t">${clock(sec)}</span></div>`).join('')}</div>
      </section>`;
    }

    // intervalos
    let tableHtml = '';
    if (intervals.length) {
      let n = 0;
      const rowsHtml = intervals.map((it) => {
        if (it.kind === 'rest') return `<div class="rest">Descanso ${clock(it.duration_s)}</div>`;
        n++;
        return `<div class="tr"><span class="name">${n}. ${nf(it.distance_m)} ${esc(it.stroke || '')}</span><span>${clock(it.duration_s)}</span><span>${clock(pace(it.duration_s, it.distance_m))}</span><span>${it.swolf ?? '—'}</span></div>`;
      }).join('');
      tableHtml = `<section class="card ${zonesHtml ? '' : 'wide'}">
        <h2 class="card-title">Intervalos</h2>
        <div class="table"><div class="tr th"><span>Tramo</span><span>Tiempo</span><span>/100m</span><span>SWOLF</span></div>${rowsHtml}</div>
      </section>`;
    }

    return `
      <a class="back" href="#/natacion">${ICON.back}Natación</a>
      <header class="head">
        <div class="eyebrow">${dayLabel(s.date)} · ${s.time} · ${s.env === 'pool' ? `Pileta ${s.pool_m || 25} m` : 'Aguas abiertas'}</div>
        <h1 class="title title-sm">${esc(s.name || 'Natación')}</h1>
      </header>
      <section class="card"><div class="stats">${stats}</div></section>
      <div class="split">
        ${loading ? '<div class="empty wide">Cargando detalle…</div>' : ''}
        ${lapsHtml}${zonesHtml}${tableHtml}
      </div>`;
  }

  // ───────── vista: golf ─────────
  function scorecard(holes) {
    const parts = holes.length > 9 ? [holes.slice(0, 9), holes.slice(9)] : [holes];
    const cell = (h) => {
      if (!h.par) return `<span class="sc">${h.strokes}</span>`;
      const d = h.strokes - h.par;
      const cls = d <= -2 ? 'eagle' : d === -1 ? 'under' : d === 1 ? 'bogey' : d >= 2 ? 'double' : '';
      return `<span class="sc ${cls}" aria-label="${h.strokes} (${vsPar(d)})">${h.strokes}</span>`;
    };
    const sum = (xs, k) => xs.reduce((a, h) => a + (h[k] || 0), 0);
    return parts.map((p, idx) => {
      const fill = (fn) => p.map(fn).join('') + '<span></span>'.repeat(9 - p.length);
      const label = parts.length > 1 ? (idx ? 'Vuelta' : 'Ida') : 'Tot';
      return `<div class="scorecard">
        <span class="lbl">Hoyo</span>${fill((h) => `<span class="dim">${h.n}</span>`)}<span class="dim">${label === 'Tot' ? 'Tot' : label}</span>
        <span class="lbl">Par</span>${fill((h) => `<span class="dim">${h.par ?? ''}</span>`)}<span class="dim">${sum(p, 'par') || ''}</span>
        <span class="lbl">Score</span>${fill(cell)}<span class="tot">${sum(p, 'strokes')}</span>
        <span class="lbl">Putts</span>${fill((h) => `<span class="dim">${h.putts ?? ''}</span>`)}<span class="dim">${sum(p, 'putts') || ''}</span>
      </div>`;
    }).join('<div style="height:6px"></div>');
  }
  const scLegend = `<div class="sc-legend"><span><i class="sc under" style="height:14px;border-radius:7px"></i>Birdie</span><span><i class="sc bogey" style="height:14px"></i>Bogey</span><span><i class="sc double" style="height:14px"></i>Doble o más</span></div>`;

  function viewGolf() {
    const rows = S.golf.rounds;
    const days = periodDays(S.golfPer);
    const cur = inPeriod(rows, days), prev = inPeriod(rows, days, 1);
    const a = golfAgg(cur), b = golfAgg(prev);
    const hasPrev = days && prev.length;
    const d = (x, y, f, bt) => (hasPrev ? delta(x, y, f, bt, '') : '');

    const kpis = [
      kpi('Hándicap', S.golf.handicap != null ? nf(S.golf.handicap, 1) : '—', '', '<div class="sub">según Garmin</div>'),
      kpi('Promedio', a.avg ? nf(a.avg, 1) : '—', '', d(a.avg, b.avg, (v) => nf(v, 1), 'down') || '<div class="sub">18 hoyos</div>'),
      kpi('Mejor', a.best ? a.best.strokes : '—', '', a.best ? `<div class="sub">${a.best.par ? vsPar(a.best.strokes - a.best.par) + ' · ' : ''}${shortDate(a.best.date)}</div>` : ''),
      kpi('Putts', a.putts ? nf(a.putts, 1) : '—', '', d(a.putts, b.putts, (v) => nf(v, 1), 'down') || '<div class="sub">por 18 hoyos</div>'),
      kpi('Fairways', a.fw != null ? `${nf(a.fw)}%` : '—', '', d(a.fw, b.fw, (v) => `${nf(v)} pts`, 'up') || '<div class="sub">acertados</div>'),
      kpi('GIR', a.gir != null ? `${nf(a.gir)}%` : '—', '', d(a.gir, b.gir, (v) => `${nf(v)} pts`, 'up') || '<div class="sub">en regulación</div>'),
    ].join('');

    const f = cur.filter(full18);
    const scoreSpark = spark(f.map((r) => ({ v: r.strokes, label: `${shortDate(r.date)} · ${r.course}` })),
      { color: 'var(--golf)', fmt: (v) => `${v} golpes`, height: 110, label: 'Golpes por ronda de 18 hoyos' });

    // golpes por tipo de hoyo y salida
    const byPar = { 3: [], 4: [], 5: [] };
    for (const r of cur) for (const h of r.holes || []) if (byPar[h.par]) byPar[h.par].push(h.strokes);
    const parBoxes = [3, 4, 5].map((p) => {
      const xs = byPar[p];
      const avg = xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null;
      return `<div class="par-box"><div class="muted">Par ${p}</div><div class="v">${avg ? nf(avg, 1) : '—'}</div><div class="hint">${avg ? `${avg - p >= 0 ? '+' : '−'}${nf(Math.abs(avg - p), 1)} prom.` : ''}</div></div>`;
    }).join('');
    const fl = cur.reduce((x, r) => x + (r.fairways_left || 0), 0);
    const fh = cur.reduce((x, r) => x + (r.fairways_hit || 0), 0);
    const fr = cur.reduce((x, r) => x + (r.fairways_right || 0), 0);
    const ft = fl + fh + fr;
    const pct = (x) => Math.round((100 * x) / ft);
    const tee = ft ? `<div class="stack" style="gap:6px"><div class="muted">Salida desde el tee (par 4 y 5)</div>
      <div class="tee" role="img" aria-label="Izquierda ${pct(fl)}%, fairway ${pct(fh)}%, derecha ${pct(fr)}%">
        <div style="flex:${fl} 1 0" data-tip="Izquierda\n${fl} salidas">Izq ${pct(fl)}%</div>
        <div class="hit" style="flex:${fh} 1 0" data-tip="Fairway\n${fh} salidas">Fairway ${pct(fh)}%</div>
        <div style="flex:${fr} 1 0" data-tip="Derecha\n${fr} salidas">Der ${pct(fr)}%</div>
      </div></div>` : '';

    const last = rows[rows.length - 1];
    const list = [...cur].reverse();
    return `
      <header class="head"><h1 class="title">Golf</h1></header>
      ${sampleBanner()}
      ${pills('golf', S.golfPer, 'golfPer')}
      <section class="cols-3 kpis golf">${kpis}</section>
      <div class="split">
        <section class="card wide">
          <div class="card-head"><h2 class="card-title">Golpes por ronda</h2><span class="hint">18 hoyos · menor es mejor</span></div>
          ${scoreSpark}
        </section>
        <section class="card">
          <h2 class="card-title">Dónde se van los golpes</h2>
          <div class="cols-3">${parBoxes}</div>
          ${tee}
        </section>
        ${last ? `<section class="card">
          <div class="card-head"><h2 class="card-title" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Última ronda · ${esc(last.course)}</h2><a class="muted" href="#/golf/${last.id}" style="flex-shrink:0">${shortDate(last.date)} ›</a></div>
          ${scorecard(last.holes || [])}
          ${scLegend}
        </section>` : ''}
        <section class="stack wide">
          <h2 class="section-title">Rondas</h2>
          ${list.slice(0, S.shown).map(golfRow).join('') || '<div class="empty">No hay rondas en este período</div>'}
          ${list.length > S.shown ? `<button type="button" class="more" data-act="more">Ver más (${list.length - S.shown})</button>` : ''}
        </section>
      </div>`;
  }

  function viewRonda(id) {
    const r = S.golf.rounds.find((x) => String(x.id) === id);
    if (!r) return notFound('#/golf', 'Golf');
    const over = r.par ? r.strokes - r.par : null;
    const stats = [
      ['Golpes', r.strokes, 'var(--golf)'],
      ['vs. par', vsPar(over)],
      ['Putts', r.putts ?? '—'],
      ['Fairways', r.fairways_total ? `${r.fairways_hit}/${r.fairways_total}` : '—'],
      ['GIR', r.gir != null ? `${r.gir}/${r.gir_total || r.holes_played}` : '—'],
      ['Penalidades', r.penalties ?? 0],
    ].map(([l, v, c]) => `<div><div class="label">${l}</div><div class="value" ${c ? `style="color:${c}"` : ''}>${v}</div></div>`).join('');
    return `<div class="golf-page" style="display:contents">
      <a class="back" href="#/golf">${ICON.back}Golf</a>
      <header class="head">
        <div class="eyebrow">${dayLabel(r.date)} · ${r.time} · ${r.holes_played} hoyos</div>
        <h1 class="title title-sm">${esc(r.course || 'Ronda')}</h1>
      </header>
      <section class="card"><div class="stats">${stats}</div></section>
      <section class="card"><h2 class="card-title">Tarjeta</h2>${scorecard(r.holes || [])}${scLegend}</section>
    </div>`;
  }

  function notFound(href, name) {
    return `<a class="back" href="${href}">${ICON.back}${name}</a><div class="empty">No encontramos esa actividad.</div>`;
  }

  // ───────── router ─────────
  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    return { page: parts[0] || 'resumen', id: parts[1] };
  }

  function render() {
    hideTip();
    afterRender = [];
    sparkId = 0;
    const { page, id } = route();
    let html;
    if (page === 'natacion') html = id ? viewSesion(id) : viewNatacion();
    else if (page === 'golf') html = id ? viewRonda(id) : viewGolf();
    else html = viewResumen();
    $app.innerHTML = html;
    document.querySelectorAll('.tabbar a').forEach((a) => {
      if (a.dataset.nav === (['natacion', 'golf'].includes(page) ? page : 'resumen')) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    const titles = { natacion: 'Natación', golf: 'Golf', resumen: 'Resumen' };
    document.title = `${titles[page] || 'Resumen'} · Training Performance`;
    afterRender.forEach((fn) => fn());
  }

  // ───────── tooltip ─────────
  let tipEl = null;
  function showTip(el) {
    if (tipEl) tipEl.classList.remove('on');
    tipEl = el;
    el.classList.add('on');
    const [head, ...rest] = el.dataset.tip.split('\n');
    $tip.innerHTML = `<b>${esc(head)}</b>${rest.map((l) => `<br>${esc(l)}`).join('')}`;
    $tip.hidden = false;
    const r = el.getBoundingClientRect(), t = $tip.getBoundingClientRect();
    const left = Math.max(8, Math.min(innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2));
    let top = r.top - t.height - 8;
    if (top < 8) top = r.bottom + 8;
    $tip.style.left = `${left}px`;
    $tip.style.top = `${top}px`;
  }
  function hideTip() {
    if (tipEl) tipEl.classList.remove('on');
    tipEl = null;
    $tip.hidden = true;
  }
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = e.target.closest('[data-tip]');
    if (el) showTip(el); else if (tipEl) hideTip();
  });
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) { if (el === tipEl) hideTip(); else showTip(el); return; }
    if (tipEl) hideTip();

    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const { act, val } = btn.dataset;
    if (act === 'env') { S.env = val; S.shown = 10; store.set('tp:env', val); }
    if (act === 'per') { S.per = val; S.shown = 10; store.set('tp:per', val); }
    if (act === 'golfPer') { S.golfPer = val; S.shown = 10; store.set('tp:golfPer', val); }
    if (act === 'more') S.shown += 20;
    render();
  });
  addEventListener('scroll', () => tipEl && hideTip(), { passive: true });
  addEventListener('hashchange', () => { S.shown = 10; render(); scrollTo(0, 0); });

  // ───────── datos ─────────
  async function fetchJSON(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  }

  async function init() {
    const [swim, golf, cfg] = await Promise.allSettled([fetchJSON('data/natacion.json'), fetchJSON('data/golf.json'), fetchJSON('config.json')]);
    if (swim.status === 'rejected' && golf.status === 'rejected') {
      $app.innerHTML = `<p class="error">No se pudieron cargar los datos.<br><span class="hint">Si abriste el archivo directo, serví la carpeta con <code>python3 -m http.server</code>.</span></p>`;
      return;
    }
    if (swim.status === 'fulfilled') S.swim = { sessions: [], ...swim.value };
    if (golf.status === 'fulfilled') S.golf = { rounds: [], handicap: null, ...golf.value };
    if (cfg.status === 'fulfilled') S.cfg = cfg.value || {};
    const byDate = (x, y) => `${x.date} ${x.time}`.localeCompare(`${y.date} ${y.time}`);
    S.swim.sessions = (S.swim.sessions || []).filter((s) => s.date).sort(byDate);
    S.golf.rounds = (S.golf.rounds || []).filter((r) => r.date).sort(byDate);
    render();
  }

  init();
})();
