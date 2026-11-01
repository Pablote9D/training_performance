/* Training Performance — natación y golf desde Garmin. Dirección visual "Boya".
 * Página estática: lee data/natacion.json, data/sesiones/<id>.json, data/golf.json y config.json. */
(() => {
  'use strict';

  const $app = document.getElementById('app');
  const $tip = document.getElementById('tip');
  /** Ambiente: la copia publicada en /dev/ es el entorno de pruebas. */
  const IS_DEV = /\/dev(\/|$)/.test(location.pathname);

  const PERIODS = [['S', 7, 'última semana'], ['M', 30, 'último mes'], ['3M', 90, 'últimos 3 meses'], ['A', 365, 'último año'], ['Todo', 0, 'todo el historial']];
  const FREE = 'libre';
  const ICON = {
    swim: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 18c2 0 2-1.5 4-1.5S8 18 10 18s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><circle cx="16" cy="7" r="2"/><path d="M4 13l5-4 3 2 4-2"/></svg>',
    golf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21V3l9 4-9 4"/><ellipse cx="12" cy="21" rx="7" ry="1.5"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></svg>',
  };
  const WAVE = '<svg class="wave" viewBox="0 0 400 26" preserveAspectRatio="none" aria-hidden="true"><path d="M0 13 Q 25 0 50 13 T 100 13 T 150 13 T 200 13 T 250 13 T 300 13 T 350 13 T 400 13 V26 H0 Z"/></svg>';

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
    stroke: store.get('tp:stroke', 'crol'),
    per: store.get('tp:per', '3M'),
    golfPer: store.get('tp:golfPer', '3M'),
    golfHoles: store.get('tp:golfHoles', null),
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
  const strokeName = (s) => (s === FREE ? 'crol' : s || 'otro');

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
  const period = (key) => PERIODS.find((p) => p[0] === key) || PERIODS[2];
  const periodDays = (key) => period(key)[1];

  // ───────── natación: cálculos ─────────
  const moving = (s) => s.moving_s || s.duration_s || 0;
  /** ¿Se está mirando solo crol? (aguas abiertas es siempre crol, no se filtra) */
  const crolMode = () => S.env === 'pool' && S.stroke === 'crol';

  /** Métricas de una sesión según el filtro: d (m), t (s), swolf y su peso. */
  function metrics(s, crol = crolMode()) {
    if (crol) {
      const b = s.by_stroke && s.by_stroke[FREE];
      if (!b || !b.d) return { d: 0, t: 0, swolf: null, w: 0 };
      return { d: b.d, t: b.t, swolf: b.n ? b.sw / b.n : null, w: b.n };
    }
    return { d: s.distance_m || 0, t: moving(s), swolf: s.swolf || null, w: s.lengths || 1 };
  }
  const sessionPace = (s, crol) => { const m = metrics(s, crol); return pace(m.t, m.d); };

  function swimAgg(rows, crol = crolMode()) {
    let dist = 0, time = 0, swSum = 0, swW = 0, n = 0, longest = 0;
    for (const s of rows) {
      const m = metrics(s, crol);
      if (!m.d) continue;
      n++; dist += m.d; time += m.t; longest = Math.max(longest, m.d);
      if (m.swolf) { swSum += m.swolf * m.w; swW += m.w; }
    }
    return { n, dist, pace: pace(time, dist), swolf: swW ? swSum / swW : null, longest };
  }

  /** Semanas seguidas con al menos una sesión (cuenta la actual si ya nadaste). */
  function streak(rows, crol = crolMode()) {
    const weeks = new Set(rows.filter((s) => metrics(s, crol).d).map((s) => isoD(monday(parseD(s.date)))));
    let w = monday(today());
    if (!weeks.has(isoD(w))) w = addDays(w, -7);
    let n = 0;
    while (weeks.has(isoD(w))) { n++; w = addDays(w, -7); }
    return n;
  }

  // ───────── golf: cálculos ─────────
  /** Rondas comparables: las de 9 o de 18 hoyos completos, según lo que se elija. */
  const roundTypes = () => [9, 18].filter((n) => S.golf.rounds.some((r) => r.holes_played === n));
  function holesType() {
    const types = roundTypes();
    if (types.includes(S.golfHoles)) return S.golfHoles;
    const count = (n) => S.golf.rounds.filter((r) => r.holes_played === n).length;
    return types.sort((a, b) => count(b) - count(a))[0] || 18;
  }
  const fullRound = (r) => r.holes_played === holesType() && r.strokes;
  function golfAgg(rows) {
    const f = rows.filter(fullRound);
    const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const fwT = rows.reduce((a, r) => a + (r.fairways_total || 0), 0);
    const girT = rows.reduce((a, r) => a + (r.gir == null ? 0 : r.gir_total || r.holes_played || 0), 0);
    const best = f.reduce((b, r) => (!b || r.strokes < b.strokes ? r : b), null);
    const putted = rows.filter((r) => r.putts != null && r.holes_played);
    return {
      n: rows.length,
      full: f.length,
      avg: avg(f.map((r) => r.strokes)),
      best,
      putts: putted.length ? (holesType() * putted.reduce((a, r) => a + r.putts, 0)) / putted.reduce((a, r) => a + r.holes_played, 0) : null,
      fw: fwT ? (100 * rows.reduce((a, r) => a + (r.fairways_hit || 0), 0)) / fwT : null,
      gir: girT ? (100 * rows.reduce((a, r) => a + (r.gir || 0), 0)) / girT : null,
    };
  }

  // ───────── piezas de UI ─────────
  /** Variación vs. período anterior. better: 'up' | 'down' | null (neutro). */
  function delta(cur, prev, fmt, better, suffix = 'vs. antes') {
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
      `<button type="button" data-act="${action}" data-val="${k}" aria-pressed="${k === current}" aria-label="${cap(name)}">${k}</button>`).join('')}</div>`;
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
  /** Línea con lectura al pasar el dedo/mouse. */
  function spark(points, { color, fmt, height = 72, label }) {
    if (points.length < 2) return `<div class="empty">Hacen falta al menos 2 registros en el período</div>`;
    const id = `sp${++sparkId}`;
    const W = 300, H = height, P = 8;
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
        out.innerHTML = `<b style="color:${color}">${esc(fmt(points[i].v))}</b> · ${esc(points[i].label)}${i === last ? ' (último)' : ''}`;
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
        <line class="rule" x1="0" x2="0" y1="0" y2="${H}" stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke"/>
        <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      </svg>
      <span class="dot" style="background:${color};border-color:${color}" aria-hidden="true"></span>
      <div class="readout"></div>
    </div>`;
  }

  function ring(swimPct, golfPct) {
    const c1 = 2 * Math.PI * 44, c2 = 2 * Math.PI * 28;
    const arc = (pct, c) => `${Math.min(1, pct) * c} ${c}`;
    const cap0 = (pct) => (pct > 0 ? 'round' : 'butt');
    return `<svg width="108" height="108" viewBox="0 0 108 108" role="img" aria-label="Objetivos de la semana: natación ${Math.round(swimPct * 100)}%, golf ${Math.round(golfPct * 100)}%">
      <circle cx="54" cy="54" r="44" fill="none" stroke="rgba(26,13,5,.16)" stroke-width="13"/>
      <circle cx="54" cy="54" r="44" fill="none" stroke="var(--buoy-ink)" stroke-width="13" stroke-linecap="${cap0(swimPct)}" stroke-dasharray="${arc(swimPct, c1)}" transform="rotate(-90 54 54)"/>
      <circle cx="54" cy="54" r="28" fill="none" stroke="rgba(26,13,5,.16)" stroke-width="13"/>
      <circle cx="54" cy="54" r="28" fill="none" stroke="#fff6ee" stroke-width="13" stroke-linecap="${cap0(golfPct)}" stroke-dasharray="${arc(golfPct, c2)}" transform="rotate(-90 54 54)"/>
    </svg>`;
  }

  function swimRow(s) {
    const crol = crolMode() && s.env === 'pool';
    const m = metrics(s, crol);
    const meta = [dayLabel(s.date), s.env === 'pool' ? `${s.pool_m || 25} m` : 'aguas abiertas', minutes(s.duration_s)].join(' · ');
    const sub = crol ? `${clock(pace(m.t, m.d))} /100m · de ${nf(s.distance_m)}` : `${clock(pace(m.t, m.d))} /100m`;
    return `<a class="row swim" href="#/natacion/${s.id}">
      <div class="ico swim">${ICON.swim}</div>
      <div class="main"><div class="t">${esc(s.name || (s.env === 'pool' ? 'Natación en pileta' : 'Aguas abiertas'))}</div><div class="m">${meta}</div></div>
      <div class="end"><div class="v">${meters(m.d)}${crol ? ' <small style="font-size:12px;font-weight:600;color:var(--text-2)">crol</small>' : ''}</div><div class="s">${sub}</div></div>
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

  function raceCard() {
    const c = S.cfg.proxima_carrera || {};
    if (!c.nombre || !c.fecha) return '';
    const days = Math.round((parseD(c.fecha) - today()) / 864e5);
    if (days < 0) return '';
    return `<section class="race wide">
      <div>
        <div class="hint" style="text-transform:uppercase;letter-spacing:.08em">Próxima carrera</div>
        <div style="font-size:17px;font-weight:600">${esc(c.nombre)}</div>
        <div class="muted">${shortDate(c.fecha)}${c.distancia_m ? ` · ${meters(c.distancia_m)}` : ''}</div>
      </div>
      <div><div class="n num">${days === 0 ? '¡Hoy!' : days}</div>${days ? `<div class="muted" style="text-align:right">${days === 1 ? 'día' : 'días'}</div>` : ''}</div>
    </section>`;
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
    const a = swimAgg(thisW, true), b = swimAgg(lastW, true);

    const recentFull = S.golf.rounds.filter(fullRound).slice(-5);
    const golfCard = S.golf.handicap != null
      ? kpi('Hándicap', nf(S.golf.handicap, 1), '', '<div class="sub">según Garmin</div>')
      : kpi('Promedio últimas 5', recentFull.length ? nf(golfAgg(recentFull).avg, 1) : '—', 'golpes', `<div class="sub">rondas de ${holesType()} hoyos</div>`);

    const latest = [
      ...S.swim.sessions.slice(-4).map((s) => ({ k: `${s.date} ${s.time}`, html: swimRow(s) })),
      ...S.golf.rounds.slice(-4).map((r) => ({ k: `${r.date} ${r.time}`, html: golfRow(r) })),
    ].sort((x, y) => y.k.localeCompare(x.k)).slice(0, 4);

    return `
      <section class="hero">
        <div class="eyebrow">${cap(new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
        <div class="rings">
          ${ring(km / swimGoal, rounds / golfGoal)}
          <div class="ring-legend">
            <h1 style="font-size:22px">Esta semana</h1>
            <div><div class="l">Natación</div><div class="v">${nf(km, 1)}<small> / ${nf(swimGoal)} km</small></div></div>
            <div><div class="l">Golf</div><div class="v">${rounds}<small> / ${golfGoal} ${golfGoal === 1 ? 'ronda' : 'rondas'}</small></div></div>
          </div>
        </div>
        ${WAVE}
      </section>
      ${sampleBanner()}
      ${raceCard()}
      <section class="cols">
        ${kpi('Ritmo crol, semana', a.pace ? clock(a.pace) : '—', '/100m', delta(a.pace, b.pace, (v) => `${Math.round(v)} s`, 'down', 'vs. sem. pasada'))}
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
    let buckets = [], weekly;
    if (days && days <= 90) {
      const n = days === 90 ? 13 : 8;
      const start = addDays(monday(today()), -7 * (n - 1));
      for (let i = 0; i < n; i++) buckets.push({ from: addDays(start, 7 * i), to: addDays(start, 7 * (i + 1)), v: 0 });
      weekly = true;
    } else {
      const first = days ? addDays(today(), -days + 1) : (rows[0] ? parseD(rows[0].date) : today());
      let m = new Date(first.getFullYear(), first.getMonth(), 1);
      while (m <= today()) { const nx = new Date(m.getFullYear(), m.getMonth() + 1, 1); buckets.push({ from: m, to: nx, v: 0 }); m = nx; }
      weekly = false;
    }
    for (const s of rows) {
      const d = parseD(s.date);
      const b = buckets.find((x) => d >= x.from && d < x.to);
      if (b) b.v += metrics(s).d;
    }
    const avg = buckets.reduce((a, b) => a + b.v, 0) / (buckets.length || 1);
    const tipLbl = (b) => (weekly ? `Semana del ${shortDate(isoD(b.from))}` : cap(b.from.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })));
    const items = buckets.map((b, i) => ({ v: b.v, cls: (i === buckets.length - 1 ? 'cur ' : '') + (b.v ? '' : 'zero'), tip: `${tipLbl(b)}\n${nf(b.v / 1000, 1)} km` }));
    const lbl = (b) => (weekly ? shortDate(isoD(b.from)) : cap(b.from.toLocaleDateString('es-AR', { month: 'short' }).replace('.', '')));
    const title = `Km por ${weekly ? 'semana' : 'mes'}`;
    return `<section class="card wide">
      <div class="card-head"><h2 class="card-title">${title}</h2><span class="muted">prom. ${nf(avg / 1000, 1)}</span></div>
      ${bars(items, { label: `${title}${crolMode() ? ' de crol' : ''}, promedio ${nf(avg / 1000, 1)} km` })}
      <div class="axis"><span>${lbl(buckets[0])}</span><span>${lbl(buckets[Math.floor(buckets.length / 2)])}</span><span>${weekly ? 'esta sem.' : 'este mes'}</span></div>
    </section>`;
  }

  function prCard(pool) {
    const crol = crolMode();
    const best = {};
    for (const s of pool) {
      for (const [d, v] of Object.entries((crol ? s.best_free : s.best) || {})) {
        const t = typeof v === 'number' ? v : v.t;
        if (!best[d] || t < best[d].t) best[d] = { t, s, st: typeof v === 'number' ? null : v.s };
      }
    }
    const longest = pool.reduce((a, s) => (!a || s.distance_m > a.distance_m ? s : a), null);
    const rows = Object.keys(best).sort((a, b) => a - b).map((d) =>
      `<a class="list-row" href="#/natacion/${best[d].s.id}"><span>${nf(+d)} m${!crol && best[d].st ? ` <span class="muted">${esc(strokeName(best[d].st))}</span>` : ''}</span><span class="muted">${shortDate(best[d].s.date)}</span><span class="big">${clock(best[d].t)}</span></a>`);
    if (longest) rows.push(`<a class="list-row" href="#/natacion/${longest.id}"><span>Sesión más larga</span><span class="muted">${shortDate(longest.date)}</span><span class="big">${meters(longest.distance_m)}</span></a>`);
    return `<section class="card">
      <div class="card-head"><h2 class="card-title">Récords${crol ? ' de crol' : ''}</h2><span class="muted">histórico</span></div>
      <div>${rows.join('') || '<div class="empty">Sin récords todavía</div>'}</div>
      <div class="hint">Mejor tiempo nadado de corrido, en un solo estilo, dentro de un intervalo.</div>
    </section>`;
  }

  function viewNatacion() {
    const pool = S.env === 'pool';
    const crol = crolMode();
    const rows = S.swim.sessions.filter((s) => s.env === S.env);
    const [, days, pname] = period(S.per);
    const cur = inPeriod(rows, days), prev = inPeriod(rows, days, 1);
    const a = swimAgg(cur), b = swimAgg(prev);
    const all = swimAgg(cur, false);
    const hasPrev = days && b.n;
    const d = (x, y, f, bt) => (hasPrev ? delta(x, y, f, bt) : '');

    const label = pool ? `${crol ? 'Crol' : 'Todos los estilos'} · ${pname}` : `Aguas abiertas · ${pname}`;
    const sub = crol && all.dist
      ? `${nf((100 * a.dist) / all.dist)}% de lo que nadaste · ${a.n} ${a.n === 1 ? 'sesión' : 'sesiones'}`
      : `${a.n} ${pool ? (a.n === 1 ? 'sesión' : 'sesiones') : (a.n === 1 ? 'nado' : 'nados')}`;
    const strk = streak(rows);

    const kpis = [
      kpi('Ritmo', a.pace ? clock(a.pace) : '—', '/100m', d(a.pace, b.pace, (v) => `${Math.round(v)} s`, 'down')),
      pool
        ? kpi('SWOLF', a.swolf ? nf(a.swolf) : '—', '', d(a.swolf, b.swolf, (v) => nf(v, 1), 'down'))
        : kpi('Más largo', a.longest ? nf(a.longest) : '—', 'm'),
      kpi('Racha', strk, strk === 1 ? 'semana' : 'semanas', '<div class="sub">seguidas</div>'),
    ].join('');

    const withPace = cur.filter((s) => sessionPace(s));
    const paceSpark = spark(withPace.map((s) => ({ v: sessionPace(s), label: shortDate(s.date) })),
      { color: 'var(--teal)', fmt: (v) => `${clock(v)} /100m`, label: `Ritmo${crol ? ' de crol' : ''} por sesión` });
    const withSw = cur.filter((s) => metrics(s).swolf);
    const swolfSpark = spark(withSw.map((s) => ({ v: metrics(s).swolf, label: shortDate(s.date) })),
      { color: 'var(--sand)', fmt: (v) => `SWOLF ${nf(v)}`, label: `SWOLF${crol ? ' de crol' : ''} por sesión` });

    const list = cur.filter((s) => metrics(s).d).reverse();
    return `
      <section class="hero">
        <div class="hero-top">
          <h1>Natación</h1>
          ${pool ? `<div class="toggle" role="group" aria-label="Estilo">
            <button type="button" data-act="stroke" data-val="crol" aria-pressed="${crol}">Crol</button>
            <button type="button" data-act="stroke" data-val="todos" aria-pressed="${!crol}">Todos</button>
          </div>` : ''}
        </div>
        <div>
          <div class="label">${label}</div>
          <div class="big">${nf(a.dist / 1000, 1)}<small> km</small></div>
          <div class="sub">${sub}</div>
        </div>
        ${WAVE}
      </section>
      ${sampleBanner()}
      <div class="controls">
        <div class="segmented" role="group" aria-label="Dónde">
          <button type="button" data-act="env" data-val="pool" aria-pressed="${pool}">Pileta</button>
          <button type="button" data-act="env" data-val="ow" aria-pressed="${!pool}">Aguas abiertas</button>
        </div>
        ${pills('swim', S.per, 'per')}
      </div>
      <section class="cols-3">${kpis}</section>
      <div class="split">
        ${raceCard()}
        ${volumeChart(rows)}
        <section class="card">
          <div class="card-head"><h2 class="card-title">Ritmo /100 m</h2><span class="hint">más abajo = más rápido</span></div>
          ${paceSpark}
        </section>
        ${pool ? `<section class="card">
          <div class="card-head"><h2 class="card-title">SWOLF</h2><span class="hint">más abajo = mejor</span></div>
          ${swolfSpark}
          <div class="hint">Segundos + brazadas en cada pileta.</div>
        </section>` : ''}
        ${pool ? prCard(rows) : ''}
        <section class="stack ${pool ? '' : 'wide'}">
          <h2 class="section-title">Sesiones</h2>
          ${list.slice(0, S.shown).map(swimRow).join('') || `<div class="empty">No hay ${pool ? (crol ? 'sesiones con crol' : 'sesiones en pileta') : 'nados en aguas abiertas'} en este período</div>`}
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
    const free = metrics(s, true);
    const isPool = s.env === 'pool';

    const stats = [
      ['Tiempo', clock(s.duration_s)],
      ['Ritmo', clock(pace(moving(s), s.distance_m))],
      ['SWOLF', s.swolf ?? '—', 'var(--sand)'],
      ['FC prom.', s.avg_hr ?? '—'],
      ['FC máx.', s.max_hr ?? '—'],
      ['Calorías', s.calories ?? '—'],
    ].map(([l, v, c]) => `<div><div class="label">${l}</div><div class="value" ${c ? `style="color:${c}"` : ''}>${v}</div></div>`).join('');

    // estilos
    let strokesHtml = '';
    const bs = Object.entries(s.by_stroke || {}).filter(([, v]) => v.d).sort((x, y) => (x[0] === FREE ? -1 : y[0] === FREE ? 1 : y[1].d - x[1].d));
    if (bs.length) {
      const tot = bs.reduce((a, [, v]) => a + v.d, 0);
      strokesHtml = `<section class="card">
        <h2 class="card-title">Estilos</h2>
        <div class="split-bar" role="img" aria-label="Reparto por estilo">${bs.map(([k, v]) => `<span style="flex:${v.d} 1 0;background:${k === FREE ? 'var(--teal)' : 'var(--other)'}" data-tip="${esc(cap(strokeName(k)))}\n${meters(v.d)}"></span>`).join('')}</div>
        <div>${bs.map(([k, v]) => `<div class="list-row"><span style="font-weight:${k === FREE ? 700 : 400}">${esc(cap(strokeName(k)))}</span><span class="muted">${nf((100 * v.d) / tot)}%${k === 'técnica' ? '' : ` · ${clock(pace(v.t, v.d))} /100m`}</span><span class="big">${meters(v.d)}</span></div>`).join('')}</div>
      </section>`;
    }

    // piletas
    let lapsHtml = '';
    const all = intervals.flatMap((it) => it.lengths || []).filter((l) => l.t && l.d);
    if (all.length) {
      // escala por percentiles: unas pocas piletas mal detectadas por el reloj no aplastan el resto
      const speeds = all.map((l) => l.d / l.t).sort((x, y) => x - y);
      const q = (f) => speeds[Math.min(speeds.length - 1, Math.floor(f * speeds.length))];
      const lo = q(0.03) * 0.85, hi = q(0.97);
      let k = 0;
      const items = [];
      for (const it of intervals) {
        if (it.kind === 'rest') { if (items.length) items.push({ v: 0, h: 0, cls: 'rest' }); continue; }
        for (const l of it.lengths || []) {
          if (!l.t || !l.d) continue;
          k++;
          const tip = [`Pileta ${k} · ${strokeName(l.stroke)}`, `${clock(l.t)} · ${clock(pace(l.t, l.d))} /100m`, l.swolf ? `SWOLF ${l.swolf}` : ''].filter(Boolean).join('\n');
          items.push({ v: 1, h: Math.max(4, Math.min(100, 8 + (92 * (l.d / l.t - lo)) / (hi - lo || 1))), cls: l.stroke === FREE ? 'free' : 'oth', tip });
        }
      }
      lapsHtml = `<section class="card wide">
        <div class="card-head"><h2 class="card-title">Ritmo por pileta</h2><span class="muted">${k} piletas</span></div>
        ${bars(items, { cls: 'laps', label: `Ritmo de cada una de las ${k} piletas` })}
        <div class="legend"><span><i style="background:var(--teal)"></i>Crol</span><span><i style="background:var(--other)"></i>Otros estilos</span><span>más alto = más rápido · huecos = descansos</span></div>
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
        return `<div class="tr ${it.stroke === FREE ? 'free' : ''}"><span class="name">${n}. ${nf(it.distance_m)} ${esc(strokeName(it.stroke))}</span><span>${clock(it.duration_s)}</span><span>${clock(pace(it.duration_s, it.distance_m))}</span><span>${it.swolf || '—'}</span></div>`;
      }).join('');
      tableHtml = `<section class="card wide">
        <h2 class="card-title">Intervalos</h2>
        <div class="table"><div class="tr th"><span>Tramo</span><span>Tiempo</span><span>/100m</span><span>SWOLF</span></div>${rowsHtml}</div>
      </section>`;
    }

    const heroSub = isPool && free.d
      ? `${meters(free.d)} de crol (${nf((100 * free.d) / s.distance_m)}%) a ${clock(pace(free.t, free.d))} /100m`
      : `${clock(pace(moving(s), s.distance_m))} /100m`;
    return `
      <section class="hero">
        <a class="back" href="#/natacion">${ICON.back}Natación</a>
        <div>
          <div class="eyebrow">${dayLabel(s.date)} · ${s.time} · ${isPool ? `Pileta ${s.pool_m || 25} m` : 'Aguas abiertas'}</div>
          <h1>${esc(s.name || 'Natación')}</h1>
        </div>
        <div>
          <div class="big" style="font-size:64px">${nf(s.distance_m)}<small> m</small></div>
          <div class="sub">${heroSub}</div>
        </div>
        ${WAVE}
      </section>
      <section class="card"><div class="stats">${stats}</div></section>
      <div class="split">
        ${loading ? '<div class="empty wide">Cargando detalle…</div>' : ''}
        ${lapsHtml}${strokesHtml}${zonesHtml}${tableHtml}
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
        <span class="lbl">Hoyo</span>${fill((h) => `<span class="dim">${h.n}</span>`)}<span class="dim">${label}</span>
        <span class="lbl">Par</span>${fill((h) => `<span class="dim">${h.par ?? ''}</span>`)}<span class="dim">${sum(p, 'par') || ''}</span>
        <span class="lbl">Score</span>${fill(cell)}<span class="tot">${sum(p, 'strokes')}</span>
        <span class="lbl">Putts</span>${fill((h) => `<span class="dim">${h.putts ?? ''}</span>`)}<span class="dim">${sum(p, 'putts') || ''}</span>
      </div>`;
    }).join('<div style="height:6px"></div>');
  }
  const scLegend = `<div class="sc-legend"><span><i class="sc under" style="height:14px;border-radius:7px"></i>Birdie</span><span><i class="sc bogey" style="height:14px"></i>Bogey</span><span><i class="sc double" style="height:14px"></i>Doble o más</span></div>`;

  function viewGolf() {
    const rows = S.golf.rounds;
    const [, days, pname] = period(S.golfPer);
    const cur = inPeriod(rows, days), prev = inPeriod(rows, days, 1);
    const a = golfAgg(cur), b = golfAgg(prev);
    const hasPrev = days && prev.length;
    const d = (x, y, f, bt) => (hasPrev ? delta(x, y, f, bt) : '');
    const ht = holesType();

    const kpis = [
      kpi('Mejor', a.best ? a.best.strokes : '—', '', a.best ? `<div class="sub">${a.best.par ? vsPar(a.best.strokes - a.best.par) + ' · ' : ''}${shortDate(a.best.date)}</div>` : ''),
      kpi('Putts', a.putts ? nf(a.putts, 1) : '—', '', d(a.putts, b.putts, (v) => nf(v, 1), 'down') || `<div class="sub">por ronda de ${ht}</div>`),
      kpi('Fairways', a.fw != null ? `${nf(a.fw)}%` : '—', '', d(a.fw, b.fw, (v) => `${nf(v)} pts`, 'up') || '<div class="sub">acertados</div>'),
      kpi('GIR', a.gir != null ? `${nf(a.gir)}%` : '—', '', d(a.gir, b.gir, (v) => `${nf(v)} pts`, 'up') || '<div class="sub">en regulación</div>'),
    ].join('');

    const f = cur.filter(fullRound);
    const scoreSpark = spark(f.map((r) => ({ v: r.strokes, label: `${shortDate(r.date)} · ${r.course}` })),
      { color: 'var(--golf)', fmt: (v) => `${v} golpes`, height: 110, label: `Golpes por ronda de ${ht} hoyos` });

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
    const heroSub = [S.golf.handicap != null ? `Hándicap ${nf(S.golf.handicap, 1)}` : '', `${a.full} ${a.full === 1 ? 'ronda' : 'rondas'} de ${ht}`, hasPrev && a.avg && b.avg ? `${a.avg <= b.avg ? '▼' : '▲'} ${nf(Math.abs(a.avg - b.avg), 1)} vs. antes` : ''].filter(Boolean).join(' · ');
    return `
      <section class="hero golf">
        <div class="hero-top">
          <h1>Golf</h1>
          ${roundTypes().length > 1 ? `<div class="toggle" role="group" aria-label="Tipo de ronda">${roundTypes().map((n) =>
            `<button type="button" data-act="golfHoles" data-val="${n}" aria-pressed="${n === ht}">${n} hoyos</button>`).join('')}</div>` : ''}
        </div>
        <div>
          <div class="label">Promedio · ${pname}</div>
          <div class="big">${a.avg ? nf(a.avg, 1) : '—'}<small> golpes</small></div>
          <div class="sub">${heroSub}</div>
        </div>
        ${WAVE}
      </section>
      ${sampleBanner()}
      <div class="controls">${pills('golf', S.golfPer, 'golfPer')}</div>
      <section class="cols kpis">${kpis}</section>
      <div class="split">
        <section class="card wide">
          <div class="card-head"><h2 class="card-title">Golpes por ronda</h2><span class="hint">${ht} hoyos · más abajo = mejor</span></div>
          ${scoreSpark}
        </section>
        <section class="card">
          <h2 class="card-title">Dónde se van los golpes</h2>
          <div class="cols-3">${parBoxes}</div>
          ${tee}
        </section>
        ${last ? `<section class="card">
          <div class="card-head"><h2 class="card-title" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Última ronda</h2><a href="#/golf/${last.id}" style="flex-shrink:0;color:var(--golf);font-size:13px">${shortDate(last.date)} ›</a></div>
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
      ['Putts', r.putts ?? '—'],
      ['Fairways', r.fairways_total ? `${r.fairways_hit}/${r.fairways_total}` : '—'],
      ['GIR', r.gir != null ? `${r.gir}/${r.gir_total || r.holes_played}` : '—'],
      ['Penalidades', r.penalties ?? 0],
      ['Par', r.par ?? '—'],
      ['Hoyos', r.holes_played],
    ].map(([l, v]) => `<div><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');
    return `
      <section class="hero golf">
        <a class="back" href="#/golf">${ICON.back}Golf</a>
        <div>
          <div class="eyebrow">${dayLabel(r.date)} · ${r.time} · ${r.holes_played} hoyos</div>
          <h1>${esc(r.course || 'Ronda')}</h1>
        </div>
        <div class="hero-row">
          <div class="big" style="font-size:72px">${r.strokes}<small> golpes</small></div>
          <div style="font-size:28px;font-weight:700">${vsPar(over)}</div>
        </div>
        ${WAVE}
      </section>
      <section class="card"><div class="stats">${stats}</div></section>
      <section class="card"><h2 class="card-title">Tarjeta</h2>${scorecard(r.holes || [])}${scLegend}</section>`;
  }

  function notFound(href, name) {
    return `<section class="hero"><a class="back" href="${href}">${ICON.back}${name}</a>${WAVE}</section><div class="empty">No encontramos esa actividad.</div>`;
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
    const nav = ['natacion', 'golf'].includes(page) ? page : 'resumen';
    document.querySelectorAll('.tabbar a').forEach((a) => {
      if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.title = `${IS_DEV ? 'DEV · ' : ''}${{ natacion: 'Natación', golf: 'Golf', resumen: 'Resumen' }[nav]} · Training Performance`;
    document.querySelector('meta[name="theme-color"]').setAttribute('content', nav === 'golf' ? '#c8e65a' : '#ff6a1a');
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
    if (act === 'stroke') { S.stroke = val; S.shown = 10; store.set('tp:stroke', val); }
    if (act === 'per') { S.per = val; S.shown = 10; store.set('tp:per', val); }
    if (act === 'golfPer') { S.golfPer = val; S.shown = 10; store.set('tp:golfPer', val); }
    if (act === 'golfHoles') { S.golfHoles = Number(val); store.set('tp:golfHoles', Number(val)); }
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
    if (IS_DEV) {
      document.documentElement.classList.add('env-dev');
      document.body.insertAdjacentHTML('beforeend', '<div class="dev-badge" role="note">DEV · <a href="../">ir a prod</a></div>');
    }
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
