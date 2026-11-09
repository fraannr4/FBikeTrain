/* =====================================================================
   FBikeTrain: pestaña Plan (calendario.html y objetivos.html).
   Se carga después de movil.js (usa window.FBT). Datos sintéticos:
   hoy es viernes 6 de noviembre de 2026. Los campos son los de
   PlannedWorkout y Goal (src/domain/types.ts); no se inventa nada.
   ===================================================================== */
(function () {
'use strict';
var doc = document, FBT = window.FBT;
function $(s, c) { return (c || doc).querySelector(s); }
function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
var ic = FBT.icon, fmt = FBT.fmt;

/* ---------- Fechas (UTC para no depender del huso del navegador) ---------- */
var TODAY = '2026-11-06';
var DOW = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
var DOW_S = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
var DOW_I = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
var MON = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
var MON_S = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sept.', 'oct.', 'nov.', 'dic.'];
function d(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
function iso(dt) { return dt.toISOString().slice(0, 10); }
function add(s, n) { var x = d(s); x.setUTCDate(x.getUTCDate() + n); return iso(x); }
function dow(s) { return (d(s).getUTCDay() + 6) % 7; }           // 0 = lunes
function day(s) { return d(s).getUTCDate(); }
function mon(s) { return d(s).getUTCMonth(); }
function diff(a, b) { return Math.round((d(a) - d(b)) / 864e5); }   // a − b en días
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function monday(s) { return add(s, -dow(s)); }
function longDate(s) { return cap(DOW[dow(s)]) + ' ' + day(s) + ' de ' + MON[mon(s)]; }
function yearSfx(s) { return s.slice(0, 4) !== TODAY.slice(0, 4) ? ' de ' + s.slice(0, 4) : ''; }   // «… de 2027» si no es este año
function relName(s) {
  var n = diff(s, TODAY);
  if (n === 0) return 'Hoy, ' + DOW[dow(s)] + ' ' + day(s);
  if (n === 1) return 'Mañana, ' + DOW[dow(s)] + ' ' + day(s);
  if (n === -1) return 'Ayer, ' + DOW[dow(s)] + ' ' + day(s);
  return longDate(s);
}
function when(s) { var n = diff(s, TODAY); return n === 0 ? 'hoy' : n === 1 ? 'mañana' : 'el ' + DOW[dow(s)] + ' ' + day(s); }
function km(m) { return m >= 100 ? fmt(Math.round(m)) : fmt(m, m % 1 ? 1 : 0); }
var PR = new Intl.PluralRules('es');
function pl(n, one, other) { return PR.select(n) === 'one' ? one : other; }
/* Cifra escrita a mano: '' -> vacío; '1.050', '74,5' -> número; 'abc', '-500' -> inválido.
   El punto es separador de miles solo si cuadra ('1.050', '12.500,5'); un único punto con
   1 o 2 cifras detrás es decimal, porque muchos teclados Android lo sacan ('74.5' -> 74,5).
   Cualquier otro punto ('7.5000', '1.2.3') es ambiguo: inválido, y el formulario lo dice. */
function parseNum(v) {
  v = String(v || '').replace(/[\s  ]/g, '');
  if (!v) return { ok: true };
  if (v.indexOf('.') >= 0) {
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(v)) v = v.replace(/\./g, '');
    else if (/^\d+\.\d{1,2}$/.test(v)) v = v.replace('.', ',');
    else return { ok: false, dot: true };
  }
  if (!/^\d+(,\d+)?$/.test(v)) return { ok: false };
  var n = parseFloat(v.replace(',', '.'));
  return { ok: true, n: n > 0 ? n : undefined };
}
/* Horas: '7', '7,5' o '7.5', y también '7:30', '7h30', '7 h 30' o '7 h 30 min' */
function parseHours(v) {
  var s = String(v || '').trim().toLowerCase(), m = s.match(/^(\d{1,3})\s*(?:h|:)\s*(?:(\d{1,2})\s*(?:min|m)?)?$/);
  if (m) {
    var mm = m[2] ? +m[2] : 0;
    if (mm > 59) return { ok: false };
    var n = +m[1] + mm / 60;
    return { ok: true, n: n > 0 ? n : undefined };
  }
  return parseNum(s);
}
/* Minutos que acompañan a las horas: de 0 a 59 */
function parseMin(v) {
  v = String(v || '').trim();
  if (!v) return { ok: true };
  if (!/^\d{1,2}$/.test(v) || +v > 59) return { ok: false };
  return { ok: true, n: +v || undefined };
}
var PARSE = { num: parseNum, h: parseHours, min: parseMin };
function parseIn(i) { return (PARSE[i.dataset.parse] || parseNum)(i.value); }
/* Mensaje para una cifra que no se entiende. Si lleva un punto que no sabemos leer,
   se enseñan las dos formas buenas: con coma decimal o entera. */
function numMsg(i, dec, whole) {
  return parseIn(i).dot ? 'No sabemos si «' + esc(i.value.trim()) + '» lleva decimales. Escribe ' + dec + ' o ' + whole + '.'
    : 'Escribe solo la cifra, por ejemplo ' + dec + '.';
}
/* Marca los campos con cifras que no se entienden; devuelve false si hay alguno */
function checkNums(inputs, errEl, msg) {
  var bad = inputs.filter(function (i) { return !parseIn(i).ok; });
  inputs.forEach(function (i) {
    var on = bad.indexOf(i) >= 0;
    i.closest('.field').toggleAttribute('data-invalid', on);
    i.setAttribute('aria-invalid', on ? 'true' : 'false');
  });
  errEl.hidden = !bad.length;
  if (bad.length) { errEl.innerHTML = ic('alert') + '<span>' + msg(bad[0]) + '</span>'; bad[0].focus(); }
  return !bad.length;
}
/* Al corregir una cifra marcada, el aviso se va en cuanto vuelve a ser válida */
doc.addEventListener('input', function (e) {
  var i = e.target, f = i.closest && i.closest('.field[data-invalid]');
  if (!f || !i.matches('[inputmode]') || !parseIn(i).ok) return;
  f.removeAttribute('data-invalid'); i.setAttribute('aria-invalid', 'false');
  var form = i.closest('form');
  if (form && !form.querySelector('.field[data-invalid] [inputmode]')) $$('[data-num-err]', form).forEach(function (n) { n.hidden = true; });
});

/* =====================================================================
   CALENDARIO
   ===================================================================== */
var scroller = $('#wk-scroller');
if (scroller) calendar();

function calendar() {
  /* Entrenos planificados (PlannedWorkout). act = la salida importada que lo marcó. */
  var W = [
    /* Lo hecho (act) son las salidas de Historial (historial.js) de ese día */
    { id: 'w01', date: '2026-10-21', title: 'Vuelta corta a Tona', km: 41, m: 410, done: true, manual: false, act: { km: 41.0, m: 405, t: '1 h 34 min' } },
    { id: 'w02', date: '2026-10-24', title: 'Lluçanès por Prats', km: 86, m: 1320, done: true, manual: false, act: { km: 86.4, m: 1320, t: '3 h 26 min' } },
    { id: 'w03', date: '2026-10-27', title: 'Vuelta corta a Tona', km: 41, m: 410, done: false, manual: false },
    { id: 'w04', date: '2026-10-29', title: 'Rodaje por la Plana de Vic', km: 50, m: 380, done: true, manual: false, act: { km: 52.4, m: 380, t: '1 h 56 min' } },
    { id: 'w05', date: '2026-11-01', title: 'Vuelta corta a Tona', km: 41, m: 410, done: true, manual: true },   // marcado a mano: muestra ese estado
    { id: 'w06', date: '2026-11-03', title: 'Coll de Bracons', km: 72, m: 1180, done: true, manual: false, act: { km: 72.1, m: 1180, t: '2 h 56 min' } },
    { id: 'w07', date: '2026-11-05', title: 'Collsuspina y Moià', km: 85, m: 1500, done: true, manual: false, act: { km: 87.6, m: 1542, t: '3 h 12 min' } },
    { id: 'w08', date: '2026-11-07', title: 'Lluçanès por Prats', km: 86, m: 1320, done: false, manual: false, notes: 'Salida a las 8:30 desde la plaza de Vic. Llevar chubasquero.' },
    { id: 'w09', date: '2026-11-08', title: 'Rodaje suave a Tona', km: 50, m: 380, done: false, manual: false },
    { id: 'w10', date: '2026-11-10', title: 'Rodaje al Lluçanès', km: 60, m: 650, done: false, manual: false },
    { id: 'w11', date: '2026-11-14', title: 'Montseny por el Brull', km: 95, m: 1750, done: false, manual: false, notes: 'Con el grupo del sábado.' },
    { id: 'w12', date: '2026-11-15', title: 'Rodaje suave por la Plana', km: 55, m: 420, done: false, manual: false },
    { id: 'w13', date: '2026-11-21', title: 'Rupit y Tavertet', km: 105, m: 1900, done: false, manual: false },
    { id: 'w14', date: '2026-11-28', title: 'Collformic y Montseny', km: 118, m: 2150, done: false, manual: false },
    { id: 'w15', date: '2026-12-05', title: 'Ensayo de la marcha', km: 130, m: 2300, done: false, manual: false },
    { id: 'w16', date: '2026-12-13', title: 'Marxa del Lluçanès', km: 140, m: 2600, done: false, manual: false }
  ];
  if (doc.documentElement.dataset.view === 'empty') W = [];
  var seq = 100;

  var FIRST = '2026-10-19', WEEKS = 9;          // del lunes 19 de octubre al domingo 20 de diciembre
  var selected = TODAY, monthShown = '2026-11-01';

  function on(s) { return W.filter(function (w) { return w.date === s; }); }
  function status(w) { return w.done ? 'done' : diff(w.date, TODAY) < 0 ? 'missed' : 'pending'; }
  var ST_TXT = { done: 'hecho', pending: 'pendiente', missed: 'sin hacer' };
  function marks(s) {
    var ws = on(s);
    if (!ws.length) return '<span class="mk mk--none"></span>';
    /* Hasta dos marcas; con más, dos y «+N» */
    var shown = ws.length > 2 ? ws.slice(0, 1) : ws;
    return '<span class="mk-pair" aria-hidden="true">' + shown.map(function (w) { return '<span class="mk mk--' + status(w) + '"></span>'; }).join('') +
      (ws.length > 2 ? '<span class="mk mk--' + status(ws[1]) + '"></span><span class="mk-more">+' + (ws.length - 2) + '</span>' : '') + '</span>';
  }
  function dayLabel(s) {
    var ws = on(s), t = longDate(s) + (s === TODAY ? ', hoy' : '');
    return t + (ws.length ? ': ' + ws.map(function (w) { return w.title + ', ' + ST_TXT[status(w)]; }).join('; ') : ', sin entrenos');
  }
  function dayBtn(s, monthCtx) {
    var out = monthCtx !== undefined && mon(s) !== monthCtx;
    return '<button class="day' + (out ? ' is-out' : '') + '" type="button" data-date="' + s + '" aria-pressed="' + (s === selected) + '"' +
      (s === TODAY ? ' aria-current="date"' : '') + ' tabindex="' + (s === selected ? 0 : -1) + '" aria-label="' + esc(dayLabel(s)) + '">' +
      (monthCtx === undefined ? '<span class="day-w" aria-hidden="true">' + DOW_I[dow(s)] + '</span>' : '') +
      '<span class="day-n" aria-hidden="true">' + day(s) + '</span>' + marks(s) + '</button>';
  }

  /* ---------- Tira de semanas ---------- */
  function renderStrip() {
    var h = '';
    for (var w = 0; w < WEEKS; w++) {
      var m0 = add(FIRST, w * 7);
      h += '<div class="wk" data-week="' + m0 + '">';
      for (var i = 0; i < 7; i++) h += dayBtn(add(m0, i));
      h += '</div>';
    }
    scroller.innerHTML = h;
  }
  function weekIndex(s) { return Math.max(0, Math.min(WEEKS - 1, Math.floor(diff(monday(s), FIRST) / 7))); }
  function curIndex() { return Math.round(scroller.scrollLeft / Math.max(1, scroller.clientWidth)); }
  function goWeek(i, smooth) {
    i = Math.max(0, Math.min(WEEKS - 1, i));
    scroller.scrollTo({ left: i * scroller.clientWidth, behavior: smooth && !FBT.reduced() ? 'smooth' : 'auto' });
    syncWeek(i);
  }
  function rangeLabel(m0) {
    var s1 = add(m0, 6);
    if (mon(m0) === mon(s1)) return day(m0) + '–' + day(s1) + ' de ' + MON[mon(s1)];
    return day(m0) + ' ' + MON_S[mon(m0)] + ' – ' + day(s1) + ' ' + MON_S[mon(s1)];
  }
  function syncWeek(i) {
    var m0 = add(FIRST, i * 7), days = [];
    for (var k = 0; k < 7; k++) days.push(add(m0, k));
    $('#wk-label').textContent = rangeLabel(m0);
    $('[data-wk-step="-1"]').disabled = i === 0;
    $('[data-wk-step="1"]').disabled = i === WEEKS - 1;
    var ws = W.filter(function (w) { return days.indexOf(w.date) >= 0; });
    var sum = $('#wk-sum');
    if (!ws.length) { sum.innerHTML = 'Nada planificado esta semana.'; return; }
    var done = ws.filter(function (w) { return w.done; });
    var plannedKm = ws.reduce(function (a, w) { return a + (w.km || 0); }, 0);
    var doneKm = Math.round(done.reduce(function (a, w) { return a + (w.act ? w.act.km : w.km || 0); }, 0));
    var p = plannedKm ? Math.min(1, doneKm / plannedKm) : 0;
    /* Dice qué mide: solo lo planificado. Lo rodado de verdad en la semana está en Objetivos. */
    sum.innerHTML = '<span><b class="nw">' + done.length + ' de ' + ws.length + '</b> ' + pl(ws.length, 'entreno hecho', 'entrenos hechos') +
      ' · <b class="nw">' + km(doneKm) + ' de ' + km(plannedKm) + '&#8239;km</b> planificados</span>' +
      '<span class="meter" data-m="dist" style="--p:' + p.toFixed(3) + '" aria-hidden="true"><i></i></span>';
  }
  var ticking = false, settle = 0;
  scroller.addEventListener('scroll', function () {
    /* Al acabar de deslizar, la selección acompaña a la semana: el mismo día de la semana */
    clearTimeout(settle);
    settle = setTimeout(function () {
      var i = curIndex();
      if (i !== weekIndex(selected)) select(add(FIRST, i * 7 + dow(selected)));
    }, 120);
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () { syncWeek(curIndex()); ticking = false; });
  }, { passive: true });
  addEventListener('resize', function () { goWeek(weekIndex(selected), false); });
  $$('[data-wk-step]').forEach(function (b) { b.addEventListener('click', function () { goWeek(curIndex() + +b.dataset.wkStep, true); }); });

  /* ---------- Panel del día ---------- */
  function figs(w) {
    var h = '';
    if (w.km) h += '<span data-m="dist">' + ic('bike') + '<b>' + km(w.km) + '</b>km</span>';
    if (w.m) h += '<span data-m="elev">' + ic('mountain') + '<b>' + fmt(w.m) + '</b>m</span>';
    return h ? '<p class="figs">' + h + '</p>' : '';
  }
  function chip(st) {
    if (st === 'done') return '<span class="chip chip--done">' + ic('check') + 'Hecho</span>';
    if (st === 'missed') return '<span class="chip chip--missed"><span class="mk mk--missed" aria-hidden="true"></span>Sin hacer</span>';
    return '<span class="chip chip--pending"><span class="mk mk--pending" aria-hidden="true"></span>Pendiente</span>';
  }
  function woCard(w) {
    var st = status(w), n = diff(w.date, TODAY), h = '<article class="card wo" aria-label="' + esc(w.title) + '">';
    h += '<div class="wo-h">' + chip(st) + '<button class="icon-btn" type="button" data-wo-edit="' + w.id + '" aria-label="Editar ' + esc(w.title) + '">' + ic('pencil') + '</button></div>';
    h += '<h3 class="wo-title">' + esc(w.title) + '</h3>' + figs(w);
    if (w.notes) h += '<p class="wo-notes">' + esc(w.notes) + '</p>';
    if (st === 'done') {
      h += '<div class="wo-match">' + ic('checkc') + '<p>' + (w.act
        ? 'Coincide con tu salida: <b>' + km(w.act.km) + '&#8239;km, ' + fmt(w.act.m) + '&#8239;m y ' + w.act.t + '</b>. Marcado al importar.'
        : 'Marcado a mano. No hay ninguna salida importada ese día.') + '</p>' +
        (w.act ? '<a class="btn btn--ghost" href="salida.html">Ver salida</a>' : '') + '</div>';
    } else if (st === 'missed') {
      h += '<p class="wo-help">' + ic('info') + 'No hay ninguna salida importada ese día. Si saliste sin GPS, márcalo tú.</p>' +
        '<button class="btn btn--secondary btn--block" type="button" data-wo-done="' + w.id + '">' + ic('check') + 'Marcar como hecho</button>';
    } else {
      h += '<p class="wo-help">' + ic('info') + 'Se marcará como hecho cuando importes la salida de ese día.</p>';
      if (n === 0) h += '<button class="btn btn--secondary btn--block" type="button" data-wo-done="' + w.id + '">' + ic('check') + 'Marcar como hecho</button>';
    }
    return h + '</article>';
  }
  function nextAfter(s) { return W.filter(function (w) { return diff(w.date, s) > 0 && !w.done; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0]; }
  function renderPanel() {
    var ws = on(selected), n = diff(selected, TODAY), h = '<h2 class="day-title" id="day-title" tabindex="-1">' + relName(selected) + '</h2>';
    if (ws.length) h += ws.map(woCard).join('');
    else {
      /* Día sin entrenos: una fila compacta y, debajo, «Planificar este día». */
      var nx = n >= 0 ? nextAfter(selected) : null;
      var meta = n < 0 ? 'Ese día no tenías nada apuntado.'
        : nx ? 'Lo siguiente, ' + when(nx.date) + ': <b>' + esc(nx.title) + '</b>' + (nx.km ? ', ' + km(nx.km) + '&#8239;km' : '') + '.'
        : 'Día libre en el plan.';
      h += '<div class="list rest"><div class="row"><span class="row-lead"><svg class="ic" aria-hidden="true"><use href="#i-calendar"/></svg></span>' +
        '<span class="row-main"><span class="row-title">' + (n === 0 ? 'Nada planificado para hoy' : 'Nada planificado') + '</span><span class="row-meta rest-next">' + meta + '</span></span></div></div>';
    }
    /* Acción en línea al pie (sustituye a la flotante): apunta el día elegido; un día pasado, hoy */
    if (n >= 0) h += '<button class="btn ' + (ws.length ? 'btn--ghost' : 'btn--secondary') + ' btn--block day-add" type="button" data-plan-new data-date="' + selected + '">' + ic('plus') +
      (ws.length ? 'Añadir otro entreno este día' : 'Planificar este día') + '</button>';
    else h += '<button class="btn btn--ghost btn--block day-add" type="button" data-plan-new data-date="' + TODAY + '">' + ic('plus') + 'Planificar un entreno</button>';
    var p = $('#day-panel');
    p.innerHTML = h;
  }
  function swapPanel() {
    var p = $('#day-panel');
    if (FBT.reduced()) { renderPanel(); return; }
    p.classList.add('is-swapping');
    setTimeout(function () { renderPanel(); p.classList.remove('is-swapping'); }, 90);
  }

  /* ---------- Próximos ---------- */
  function renderProx() {
    var list = W.filter(function (w) { return diff(w.date, TODAY) > 0; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 5);
    $('#prox-list').innerHTML = list.map(function (w) {
      var n = diff(w.date, TODAY);
      return '<li><button class="row row--hito" type="button" data-goto="' + w.date + '">' +
        '<span class="hito-date" aria-hidden="true"><span class="wd">' + DOW_S[dow(w.date)] + '</span><span class="d">' + day(w.date) + '</span></span>' +
        '<span class="row-main"><span class="sr-only">' + longDate(w.date) + ': </span><span class="row-title">' + esc(w.title) + '</span>' +
        '<span class="row-meta">' + (n === 1 ? 'Mañana' : 'En ' + n + ' días') + (w.m ? ', <span class="nw">' + fmt(w.m) + '&#8239;m de desnivel</span>' : '') + '</span></span>' +
        '<span class="row-trail">' + (w.km ? '<span class="row-val">' + km(w.km) + '<span class="u">km</span></span>' : '') + ic('chev', 'chev') + '</span></button></li>';
    }).join('');
  }

  /* ---------- Hoja del mes ---------- */
  function renderMonth() {
    var y = +monthShown.slice(0, 4), m = +monthShown.slice(5, 7) - 1;
    var first = monthShown, last = iso(new Date(Date.UTC(y, m + 1, 0)));
    $('#mo-label').textContent = cap(MON[m]) + ' de ' + y;
    var h = DOW_I.map(function (x, i) { return '<span class="dow" aria-hidden="true">' + x + '</span>'; }).join('');
    for (var b = 0; b < dow(first); b++) h += '<span aria-hidden="true"></span>';
    for (var s = first; s <= last; s = add(s, 1)) h += dayBtn(s, m);
    $('#mo-grid').innerHTML = h;
    var ws = W.filter(function (w) { return w.date >= first && w.date <= last; });
    var c = { done: 0, missed: 0, pending: 0 };
    ws.forEach(function (w) { c[status(w)]++; });
    $('#mo-sum').textContent = ws.length
      ? ws.length + (ws.length === 1 ? ' entreno: ' : ' entrenos: ') + [c.done && c.done + (c.done === 1 ? ' hecho' : ' hechos'), c.missed && c.missed + ' sin hacer', c.pending && c.pending + ' por venir'].filter(Boolean).join(', ') + '.'
      : 'Nada planificado este mes.';
    $('[data-mo-step="-1"]').disabled = monthShown <= '2026-10-01';
    $('[data-mo-step="1"]').disabled = monthShown >= '2026-12-01';
  }
  $$('[data-mo-step]').forEach(function (b) {
    b.addEventListener('click', function () {
      var y = +monthShown.slice(0, 4), m = +monthShown.slice(5, 7) - 1 + +b.dataset.moStep;
      monthShown = iso(new Date(Date.UTC(y, m, 1)));
      renderMonth();
    });
  });
  $('[data-sheet-open="hoja-mes"]').addEventListener('click', function () { monthShown = selected.slice(0, 8) + '01'; renderMonth(); }, true);

  /* ---------- Elegir día ---------- */
  function select(s, o) {
    o = o || {};
    selected = s;
    $$('.day[data-date]').forEach(function (b) {
      var me = b.dataset.date === s;
      b.setAttribute('aria-pressed', me); b.tabIndex = me ? 0 : -1;
    });
    if (o.scroll) goWeek(weekIndex(s), true);
    o.instant ? renderPanel() : swapPanel();
    if (o.focus) { var b = $('#wk-scroller .day[data-date="' + s + '"]'); if (b) b.focus({ preventScroll: true }); }
  }
  function renderAll() { renderStrip(); goWeek(weekIndex(selected), false); renderPanel(); renderProx(); }

  scroller.addEventListener('click', function (e) { var b = e.target.closest('.day'); if (b) select(b.dataset.date); });
  scroller.addEventListener('keydown', function (e) {
    var b = e.target.closest('.day'); if (!b) return;
    var step = { ArrowLeft: -1, ArrowRight: 1 }[e.key]; if (!step) return;
    var s = add(b.dataset.date, step);
    if (s < FIRST || s > add(FIRST, WEEKS * 7 - 1)) return;
    e.preventDefault();
    select(s, { focus: true });
    if (weekIndex(s) !== curIndex()) goWeek(weekIndex(s), true);
  });
  $('#mo-grid').addEventListener('click', function (e) {
    var b = e.target.closest('.day'); if (!b) return;
    FBT.sheet.close('hoja-mes');
    select(b.dataset.date, { scroll: true });
  });
  doc.addEventListener('click', function (e) {
    var g = e.target.closest('[data-goto]');
    if (g) {
      select(g.dataset.goto, { scroll: true });
      var t = $('#wk-scroller').closest('.section');
      t.scrollIntoView({ behavior: FBT.reduced() ? 'auto' : 'smooth', block: 'start' });
      setTimeout(function () { $('#day-title').focus({ preventScroll: true }); }, 120);
      return;
    }
    if (e.target.closest('[data-go-today]')) {
      select(TODAY, { scroll: true });
      scrollTo({ top: 0, behavior: FBT.reduced() ? 'auto' : 'smooth' });
      return;
    }
    var nw = e.target.closest('[data-plan-new]');
    if (nw) { openForm(null, nw.dataset.date || (diff(selected, TODAY) >= 0 ? selected : TODAY), nw); return; }
    var ed = e.target.closest('[data-wo-edit]');
    if (ed) { openForm(byId(ed.dataset.woEdit), null, ed); return; }
    var dn = e.target.closest('[data-wo-done]');
    if (dn) {
      var w = byId(dn.dataset.woDone); if (!w) return;
      w.done = true; w.manual = true;
      refresh();
      FBT.toast('Marcado como hecho', { tone: 'good', action: { label: 'Deshacer', onClick: function () { w.done = false; w.manual = false; refresh(); } } });
    }
  });
  function byId(id) { return W.filter(function (w) { return w.id === id; })[0]; }
  function refresh() {
    var i = curIndex();
    renderStrip(); scroller.scrollLeft = i * scroller.clientWidth; syncWeek(i);
    renderPanel(); renderProx();
  }

  /* ---------- Hoja: planificar o editar ---------- */
  var form = $('#f-entreno'), editing = null;
  var F = { fecha: $('#fe-fecha'), titulo: $('#fe-titulo'), km: $('#fe-km'), m: $('#fe-m'), notas: $('#fe-notas'), hecho: $('#fe-hecho') };
  function setInvalid(on) {
    var f = $('#fe-titulo-f');
    f.toggleAttribute('data-invalid', on);
    F.titulo.setAttribute('aria-invalid', on ? 'true' : 'false');
    $('#fe-titulo-e').hidden = !on;
  }
  function openForm(w, date, trigger) {
    editing = w;
    $('#hoja-entreno-t').textContent = w ? 'Editar entreno' : 'Planificar entreno';
    $('#fe-guardar').textContent = w ? 'Guardar cambios' : 'Guardar entreno';
    $$('[data-edit-only]', form).forEach(function (n) { n.hidden = !w; });
    F.fecha.value = w ? w.date : date;
    F.titulo.value = w ? w.title : '';
    F.km.value = w && w.km ? fmt(w.km, w.km % 1 ? 1 : 0) : '';
    F.m.value = w && w.m ? fmt(w.m) : '';
    F.notas.value = w && w.notes ? w.notes : '';
    F.hecho.setAttribute('aria-checked', w && w.done ? 'true' : 'false');
    setInvalid(false); checkNums([], $('#fe-num-e'));
    [F.km, F.m].forEach(function (i) { i.closest('.field').removeAttribute('data-invalid'); i.setAttribute('aria-invalid', 'false'); });
    FBT.sheet.open('hoja-entreno', trigger);
  }
  function num(v) { return parseNum(v).n; }
  F.titulo.addEventListener('input', function () { if (F.titulo.value.trim()) setInvalid(false); });
  $('[data-fill]').addEventListener('click', function (e) {
    var v = e.currentTarget.dataset.fill.split('|'); F.km.value = v[0]; F.m.value = fmt(+v[1]);
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!F.titulo.value.trim()) { setInvalid(true); F.titulo.focus(); return; }
    if (!checkNums([F.km, F.m], $('#fe-num-e'), function (i) { return i === F.km ? numMsg(i, '74,5', '745') : numMsg(i, '1.050', '1050'); })) return;
    var data = { date: F.fecha.value || TODAY, title: F.titulo.value.trim(), km: num(F.km.value), m: num(F.m.value), notes: F.notas.value.trim() || undefined };
    var wasNew = !editing;
    if (editing) {
      var turnedOn = F.hecho.getAttribute('aria-checked') === 'true';
      if (turnedOn !== editing.done) { editing.done = turnedOn; editing.manual = true; }
      Object.keys(data).forEach(function (k) { editing[k] = data[k]; });
    } else {
      data.id = 'n' + (seq++); data.done = false; data.manual = false;
      W.push(data);
    }
    FBT.sheet.close('hoja-entreno');
    selected = data.date;
    refresh(); goWeek(weekIndex(selected), true);
    FBT.toast(wasNew ? 'Entreno guardado' : 'Cambios guardados', { tone: 'good' });
    setTimeout(function () { var t = $('#day-title'); if (t) t.focus({ preventScroll: true }); }, 280);
  });
  $('[data-wo-delete]').addEventListener('click', function () {
    var w = editing, i = W.indexOf(w); if (i < 0) return;
    W.splice(i, 1);
    FBT.sheet.close('hoja-entreno');
    refresh();
    FBT.toast('Entreno borrado', { tone: 'info', action: { label: 'Deshacer', onClick: function () { W.splice(i, 0, w); refresh(); } } });
    setTimeout(function () { var t = $('#day-title'); if (t) t.focus({ preventScroll: true }); }, 280);
  });

  renderAll();
  syncWeek(weekIndex(selected));
}

/* =====================================================================
   OBJETIVOS
   ===================================================================== */
/* Anillo: carril, curvas de nivel, arco del acento y muesca del ritmo esperado.
   Pasado el 100 %: la primera vuelta se atenúa y lo que sobra se dibuja encima. */
function ring(svg, p, pace) {
  var R = 50, C = 2 * Math.PI * R, cx = 60, cy = 60;
  var a = (pace * 2 - 0.5) * Math.PI, nx1 = cx + Math.cos(a) * (R - 9), ny1 = cy + Math.sin(a) * (R - 9), nx2 = cx + Math.cos(a) * (R + 9), ny2 = cy + Math.sin(a) * (R + 9);
  function arc(f, cls) { return '<circle class="arc' + (cls || '') + '" cx="60" cy="60" r="' + R + '" stroke-dasharray="' + (f * C).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 60 60)"/>'; }
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.innerHTML = [36, 28, 20].map(function (r, i) { return '<ellipse class="topo" cx="' + (60 + i * 1.5) + '" cy="' + (60 - i) + '" rx="' + r * 1.06 + '" ry="' + r * 0.94 + '"/>'; }).join('') +
    '<circle class="track" cx="60" cy="60" r="' + R + '"/>' +
    (p > 1 ? arc(1, ' arc--lap') + arc(Math.min(p - 1, 1)) : p > 0 ? arc(p) : '') +
    (pace > 0 && pace < 1 && p < 1 ? '<line class="notch" x1="' + nx1.toFixed(1) + '" y1="' + ny1.toFixed(1) + '" x2="' + nx2.toFixed(1) + '" y2="' + ny2.toFixed(1) + '"/>' : '');
}
$$('svg.ring[data-p]').forEach(function (s) { ring(s, +s.dataset.p, +(s.dataset.pace || 0)); });
FBT.ring = ring;

var gform = $('#f-objetivo');
if (gform) goals();

function goals() {
  var q = new URLSearchParams(location.search);
  /* Objetivos (Goal) y lo hecho en cada periodo. Lo hecho en tiempo va en minutos; el objetivo, en horas.
     Casos de prueba: ?caso=tiempo (mes solo de tiempo), ?caso=superado (semana al 134 %),
     ?evento=manana|hoy|pasado. */
  var GOALS = {
    event: { name: 'Marxa del Lluçanès', date: '2026-12-13', km: 140, m: 2600, best: { km: 112, m: 1840 }, planned: 8 },
    week: { period: 'week', from: '2026-11-02', to: '2026-11-08', km: 250, m: 3500, h: 7, done: { km: 159.7, m: 2722, min: 368 }, rest: { km: 136, m: 1700 } },
    month: { period: 'month', from: '2026-11-01', to: '2026-11-30', km: 800, done: { km: 201, m: 3132, min: 460 } }
  };
  var BASE = { week: GOALS.week, month: GOALS.month };
  if (q.get('caso') === 'tiempo') { delete GOALS.month.km; GOALS.month.h = 30; }
  if (q.get('caso') === 'superado') GOALS.week.done = { km: 335, m: 3880, min: 340 };
  var EV_OFF = { manana: 1, hoy: 0, pasado: -3 }[q.get('evento')];
  if (EV_OFF !== undefined) { GOALS.event.date = add(TODAY, EV_OFF); GOALS.event.planned = EV_OFF > 0 ? 1 : 0; }

  /* ---------- Métricas: el anillo es la primera definida (distancia, desnivel, tiempo); el resto, barras ---------- */
  function hm(min, short) {
    var h = Math.floor(min / 60), m = Math.round(min % 60);
    if (m === 60) { h++; m = 0; }
    if (!h) return m + '&nbsp;min';
    return h + '&nbsp;h' + (m ? '&nbsp;' + (m < 10 ? '0' : '') + m + (short ? '' : '&nbsp;min') : '');   // «6 h 08», como en Inicio
  }
  function plain(s) { return s.replace(/&[^;]+;/g, ' '); }
  var MET = {
    dist: { ic: 'bike', name: 'Distancia', target: function (g) { return g.km; }, done: function (g) { return g.done.km; },
      v: function (x) { return km(Math.round(x)); }, u: '&#8239;km', full: function (x) { return km(Math.round(x)) + '&#8239;km'; } },
    elev: { ic: 'mountain', name: 'Desnivel', target: function (g) { return g.m; }, done: function (g) { return g.done.m; },
      v: function (x) { return fmt(Math.round(x)); }, u: '&#8239;m', full: function (x) { return fmt(Math.round(x)) + '&#8239;m'; } },
    time: { ic: 'clock', name: 'Tiempo', target: function (g) { return g.h ? g.h * 60 : undefined; }, done: function (g) { return g.done.min; },
      v: function (x) { return hm(x, true); }, u: '', full: function (x) { return hm(x); } }
  };
  function mets(g) { return ['dist', 'elev', 'time'].filter(function (k) { return MET[k].target(g) > 0; }); }
  function pct(x) { return Math.round(x * 100); }
  function pace(g) { return (diff(TODAY, g.from) + 1) / (diff(g.to, g.from) + 1); }
  function listAnd(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1]; }

  function volCard(key, g) {
    var ks = mets(g); if (!ks.length) return '';
    var k0 = ks[0], M = MET[k0], T = M.target(g), D = M.done(g), p = D / T, pc = pace(g), left = diff(g.to, TODAY);
    var title = g.period === 'week' ? 'Esta semana' : cap(MON[mon(g.from)]);
    var targets = listAnd(ks.map(function (k) { return MET[k].full(MET[k].target(g)); }));
    var sub = g.period === 'week'
      ? 'Del ' + day(g.from) + ' al ' + day(g.to) + ' de ' + MON[mon(g.to)] + '. Objetivo: ' + targets + '.'
      : 'Objetivo: ' + targets + ' en el mes.';
    var h = '<article class="card vol" data-m="' + k0 + '" data-goal="' + key + '" aria-labelledby="v-' + key + '-t">' +
      '<div class="card-h"><span class="card-ic">' + ic('calendar') + '</span>' +
      '<h3 class="card-title" id="v-' + key + '-t">' + title + '</h3>' +
      '<button class="icon-btn" type="button" data-goal-edit="' + key + '" aria-label="Editar el objetivo de ' + (g.period === 'week' ? 'la semana' : MON[mon(g.from)]) + '">' + ic('pencil') + '</button></div>' +
      /* «Conseguido» va con la entradilla, no junto al título: a 360 px partía «Esta semana» en dos */
      '<div class="vol-sub">' + (p >= 1 ? '<span class="chip chip--done">' + ic('check') + 'Conseguido</span>' : '') + '<span>' + sub + '</span></div>';
    var label = M.name + ': ' + plain(M.full(D)) + ' de ' + plain(M.full(T)) + ', el ' + pct(p) + ' %.' +
      (p < 1 ? ' El ritmo para llegar a tiempo es el ' + pct(pc) + ' %.' : ' Objetivo conseguido.');
    h += '<div class="vol-body"><div class="ring-wrap"><svg class="ring" data-ring="' + p.toFixed(4) + '|' + pc.toFixed(4) + '" role="img" aria-label="' + esc(label) + '"></svg>' +
      '<p class="ring-c" aria-hidden="true"><span class="ring-v">' + pct(p) + '<span class="u">&#8239;%</span></span><span class="ring-s"><b>' + M.v(D) + '</b> de ' + M.v(T) + M.u + '</span></p></div>';
    /* Líneas de lectura: siempre de la métrica del anillo */
    var lines = [];
    if (p >= 1) lines.push('<li class="is-good">' + ic('checkc') + '<span><b>' + M.full(D - T) + '</b> por encima del objetivo</span></li>');
    else {
      var dl = D - pc * T;
      lines.push(dl >= 0
        ? '<li class="is-good">' + ic('up') + '<span><b>' + M.full(dl) + '</b> por delante del ritmo</span></li>'
        : '<li>' + ic('down') + '<span><b>' + M.full(-dl) + '</b> por detrás del ritmo</span></li>');
    }
    lines.push('<li>' + ic('clock') + '<span>' + (left <= 0 ? 'Último día' : pl(left, 'Queda ', 'Quedan ') + left + pl(left, ' día', ' días')) + '</span></li>');
    var restK = k0 === 'dist' ? 'km' : k0 === 'elev' ? 'm' : null;
    if (p < 1 && g.rest && restK && g.rest[restK]) {
      var reach = D + g.rest[restK];
      lines.push('<li' + (reach >= T ? ' class="is-good"' : '') + '>' + ic(reach >= T ? 'checkc' : 'trend') + '<span>Con lo planificado del finde llegas a <b>' + M.full(reach) + '</b></span></li>');
    } else if (p < 1 && g.period === 'month' && left >= 7) {
      lines.push('<li>' + ic('trend') + '<span>Unos <b>' + M.full((T - D) / (left / 7)) + '</b> por semana hasta fin de mes</span></li>');
    }
    h += '<ul class="vol-lines">' + lines.join('') + '</ul></div>';
    /* El resto de métricas, como barras con la muesca del ritmo */
    h += '<div class="vol-more">' + ks.slice(1).map(function (k) {
      var m = MET[k], t = m.target(g), d0 = m.done(g), pp = d0 / t;
      var al = m.name + ': ' + plain(m.full(d0)) + ' de ' + plain(m.full(t)) + ', el ' + pct(pp) + ' %.' + (pp < 1 ? ' El ritmo para llegar a tiempo es el ' + pct(pc) + ' %.' : '');
      return '<div class="bar-row" data-m="' + k + '"><p class="bar-l"><span>' + ic(m.ic) + m.name + '</span><span class="nw"><b>' + (k === 'time' ? hm(d0) : m.v(d0)) + '</b> de ' + m.full(t) + '<span class="pct">' + pct(pp) + '&#8239;%</span></span></p>' +
        '<div class="meter meter--slim" style="--p:' + Math.min(pp, 1).toFixed(3) + ';--pace:' + pc.toFixed(3) + '" role="img" aria-label="' + esc(al) + '"><i></i>' + (pp < 1 ? '<b></b>' : '') + '</div></div>';
    }).join('') + '</div>';
    return h + '</article>';
  }
  function renderVol() {
    var grid = $('#vol-grid');
    var h = ['week', 'month'].map(function (k) { return GOALS[k] ? volCard(k, GOALS[k]) : ''; }).join('');
    /* Sin ningún volumen (p. ej. tras borrar los dos): una fila que invita a poner uno */
    $('#vol-key').hidden = !h;
    grid.innerHTML = h || '<ul class="list list--inset"><li><button class="row" type="button" data-goal-new="volume" data-m="time">' +
      '<span class="row-lead">' + ic('calendar') + '</span><span class="row-main"><span class="row-title">Sin objetivo de volumen</span>' +
      '<span class="row-meta">Tu semana media son 191&#8239;km: empieza por ahí</span></span><span class="row-trail">' + ic('chev', 'chev') + '</span></button></li></ul>';
    $$('svg[data-ring]', grid).forEach(function (s) { var v = s.dataset.ring.split('|'); ring(s, +v[0], +v[1]); });
  }

  /* ---------- Evento: fila compacta (cuenta atrás, nombre, preparación) que se despliega ---------- */
  function renderEvent() {
    var e = GOALS.event, box = $('#ev-card'), sec = box.closest('section');
    sec.hidden = !e; if (!e) return;
    var n = diff(e.date, TODAY), more = $('#ev-more'), open = !!more && !more.hidden;
    var band, big, said;
    if (n > 0) { band = pl(n, 'falta', 'faltan'); big = String(n); said = cap(band) + ' ' + n + pl(n, ' día', ' días'); }
    else if (n === 0) { band = 'hoy'; big = ic('flag'); said = 'Es hoy'; }
    else { band = 'pasó'; big = ic('flag'); said = 'Ya pasó'; }
    var figsTxt = [e.km && km(e.km) + '&#8239;km', e.m && fmt(e.m) + '&#8239;m'].filter(Boolean).join(', ');
    var meta = n > 0 ? longDate(e.date) + yearSfx(e.date) + (figsTxt ? ' · ' + figsTxt : '')
      : n === 0 ? 'Hoy' + (figsTxt ? ' · ' + figsTxt : '') + '. Buena marcha.'
      : 'Fue el ' + longDate(e.date).toLowerCase() + yearSfx(e.date) + '. Pon el siguiente.';
    var pk = e.km ? 'km' : e.m ? 'm' : null, prep = '';
    if (n > 0 && pk && e.best) {
      var pp = e.best[pk] / e[pk];
      prep = '<span class="meter meter--slim" style="--p:' + Math.min(pp, 1).toFixed(3) + '" aria-hidden="true"><i></i></span>' +
        '<span class="ev-prep-l">' + (pk === 'km' ? 'Tu salida más larga: ' : 'Tu salida con más desnivel: ') + '<b class="nw">' +
        (pk === 'km' ? km(e.best.km) + ' de ' + km(e.km) + '&#8239;km' : fmt(e.best.m) + ' de ' + fmt(e.m) + '&#8239;m') + '</b></span>';
    }
    var h = '<button class="ev-row" type="button" aria-expanded="' + open + '" aria-controls="ev-more">' +
      '<span class="hito-date" aria-hidden="true"><span class="wd">' + band + '</span><span class="d' + (n > 99 ? ' d--3' : '') + '">' + big + '</span></span>' +
      '<span class="ev-main"><span class="sr-only">' + said + ': </span><span class="ev-name">' + esc(e.name) + '</span>' +
      '<span class="ev-meta">' + meta + '</span>' + prep + '</span>' + ic('chevdown', 'ev-chev') + '</button>';
    /* Detalle */
    var d = '';
    if (n >= 0) {
      /* La fecha y las cifras ya están en la fila: el detalle empieza por la preparación */
      if (e.best && (e.km || e.m)) {
        d += '<div class="prep"><p class="prep-h">Tus mejores salidas de las últimas 8 semanas</p>';
        if (e.km) { var a = e.best.km / e.km; d += '<div class="bar-row" data-m="dist"><p class="bar-l"><span>' + ic('bike') + 'La más larga</span><span class="nw"><b>' + km(e.best.km) + '</b> de ' + km(e.km) + '&#8239;km</span></p><div class="meter meter--slim" style="--p:' + Math.min(a, 1).toFixed(3) + '" role="img" aria-label="Tu salida más larga, ' + km(e.best.km) + ' km, es el ' + pct(a) + ' % de la distancia de la marcha"><i></i></div></div>'; }
        if (e.m) { var b = e.best.m / e.m; d += '<div class="bar-row" data-m="elev"><p class="bar-l"><span>' + ic('mountain') + 'La de más desnivel</span><span class="nw"><b>' + fmt(e.best.m) + '</b> de ' + fmt(e.m) + '&#8239;m</span></p><div class="meter meter--slim" style="--p:' + Math.min(b, 1).toFixed(3) + '" role="img" aria-label="Tu salida con más desnivel, ' + fmt(e.best.m) + ' m, es el ' + pct(b) + ' % del desnivel de la marcha"><i></i></div></div>'; }
        d += '</div>';
      }
      if (n > 0) d += '<a class="link-row" href="calendario.html">' + ic('calendar') + '<span>' +
        (e.planned ? e.planned + pl(e.planned, ' entreno planificado', ' entrenos planificados') + ' hasta la marcha' : 'Planifica entrenos hasta la marcha') + '</span>' + ic('chev') + '</a>';
    } else {
      d += '<p class="ev-date">Cuando importes la salida de ese día, la verás en tu historial.</p>' +
        '<button class="btn btn--secondary btn--block" type="button" data-goal-new="event">' + ic('flag') + 'Poner el siguiente evento</button>';
    }
    box.innerHTML = h + '<div class="ev-more" id="ev-more"' + (open ? '' : ' hidden') + '>' + d + '</div>';
    $('#ev-edit').setAttribute('aria-label', 'Editar ' + e.name);
  }
  doc.addEventListener('click', function (ev) {
    var t = ev.target.closest('.ev-row'); if (!t) return;
    var on = t.getAttribute('aria-expanded') !== 'true';
    t.setAttribute('aria-expanded', on); $('#ev-more').hidden = !on;
  });
  function renderAll() { renderVol(); renderEvent(); }

  /* ---------- Anteriores: los 4 últimos en la página; todos en una hoja, con filtro ---------- */
  var PREV = [   // ordenados por el final del periodo, del más reciente al más antiguo
    // Sumas de las salidas de Historial (historial.js), semana de lunes a domingo
    { k: 'week', t: 'Semana del 26 de octubre', done: 188, target: 250 },
    { k: 'month', t: 'Octubre', done: 718, target: 800 },
    { k: 'week', t: 'Semana del 19 de octubre', done: 127, target: 250 },
    { k: 'week', t: 'Semana del 12 de octubre', done: 256, target: 250 },
    { k: 'week', t: 'Semana del 5 de octubre', done: 117, target: 250 },
    { k: 'week', t: 'Semana del 28 de septiembre', done: 158, target: 250 },
    { k: 'month', t: 'Septiembre', done: 673, target: 800 },
    { k: 'week', t: 'Semana del 21 de septiembre', done: 140, target: 250 },
    { k: 'week', t: 'Semana del 14 de septiembre', done: 133, target: 250 },
    { k: 'week', t: 'Semana del 7 de septiembre', done: 134, target: 250 },
    { k: 'month', t: 'Agosto', done: 905, target: 800 },
    { k: 'month', t: 'Julio', done: 760, target: 800 }
  ];
  var PREV_SHOWN = 4;
  function prevRow(r) {
    var p = Math.round(r.done * 100 / r.target), ok = r.done >= r.target;
    return '<li><div class="row"' + (ok ? ' style="--acc:var(--good)"' : '') + '><span class="row-lead">' + ic(ok ? 'checkc' : 'target') + '</span>' +
      '<span class="row-main"><span class="row-title">' + r.t + '</span><span class="row-meta">' + km(r.done) + ' de ' + km(r.target) + '&#8239;km' + (ok ? ', conseguido' : '') + '</span></span>' +
      '<span class="row-trail"><span class="row-val' + (ok ? ' is-good' : '') + '">' + p + '<span class="u">&#8239;%</span></span></span></div></li>';
  }
  function renderPrev(kind) {
    $('#prev-list').innerHTML = PREV.slice(0, PREV_SHOWN).map(prevRow).join('');
    var more = $('#prev-more');
    more.hidden = PREV.length <= PREV_SHOWN;
    more.firstChild.textContent = 'Ver los ' + PREV.length;
    var rows = PREV.filter(function (r) { return !kind || kind === 'all' || r.k === kind; });
    var won = rows.filter(function (r) { return r.done >= r.target; }).length;
    $('#prev-all').innerHTML = rows.map(prevRow).join('');
    $('#prev-sum').textContent = 'Conseguidos ' + won + ' de ' + rows.length + '.';
  }
  var prevSeg = $('#prev-seg');
  if (prevSeg) prevSeg.addEventListener('segchange', function (e) { renderPrev(e.detail.value); });

  /* ---------- Hoja: nuevo objetivo o editar ---------- */
  var editing = null;
  var F = { name: $('#fo-nombre'), date: $('#fo-fecha'), ekm: $('#fo-ekm'), em: $('#fo-em'), km: $('#fo-km'), m: $('#fo-m'), h: $('#fo-h'), min: $('#fo-min') };
  var typeSeg = $('#fo-tipo'), perSeg = $('#fo-periodo');
  function pick(seg, i) { var b = $$(':scope > button', seg)[i]; if (b) b.click(); }
  function nf(v) { return v ? fmt(v, v % 1 ? 1 : 0) : ''; }
  function curType() { return $('#fo-tipo [aria-selected="true"]').dataset.value; }
  function curPer() { return $('#fo-periodo [aria-pressed="true"]').dataset.value === 'month' ? 'month' : 'week'; }
  function evLive(e) { return e && diff(e.date, TODAY) >= 0; }
  function clearErr() {
    $$('.form-err, .field-error', gform).forEach(function (n) { n.hidden = true; });
    $$('[data-invalid]', gform).forEach(function (n) { n.removeAttribute('data-invalid'); });
    $$('input', gform).forEach(function (i) { i.setAttribute('aria-invalid', 'false'); });
  }
  /* Qué objetivo se escribiría al guardar y si ya hay otro en ese hueco (que se sustituye) */
  function target() { return curType() === 'event' ? 'event' : curPer(); }
  function replaces() {
    var k = target(), g = GOALS[k];
    if (!g || k === editing) return null;
    if (k === 'event') return evLive(g) ? g : null;   // un evento que ya pasó se reemplaza sin aviso
    return mets(g).length ? g : null;
  }
  function updateReplace() {
    var g = replaces(), k = target(), box = $('#fo-replace'), txt = '';
    if (g && k === 'event') {
      var n = diff(g.date, TODAY);
      txt = 'Ya tienes un evento: <b>' + esc(g.name) + '</b>, ' + (n === 0 ? 'hoy' : 'el ' + longDate(g.date).toLowerCase() + yearSfx(g.date)) + '. Este lo sustituye.';
    } else if (g) {
      txt = 'Ya tienes un objetivo para cada ' + (k === 'week' ? 'semana' : 'mes') + ': <b>' +
        listAnd(mets(g).map(function (m) { return MET[m].full(MET[m].target(g)); })) + '</b>. Este lo sustituye.';
    }
    box.hidden = !txt;
    box.innerHTML = txt ? ic('warn') + '<span>' + txt + '</span>' : '';
    $('#fo-guardar').textContent = editing && !g ? 'Guardar cambios' : g ? 'Sustituir objetivo' : 'Crear objetivo';
  }
  /* kind: 'event' | 'volume' | nada. Sin tipo, se abre en lo que aún falta: evento, semana, mes. */
  function open(key, trigger, kind) {
    editing = key;
    var g = key ? GOALS[key] : null, isEv = key === 'event';
    if (!g) {
      if (!kind) kind = !evLive(GOALS.event) ? 'event' : !GOALS.week || !GOALS.month ? 'volume' : 'event';
    }
    var per = g && !isEv ? g.period : !GOALS.week ? 'week' : !GOALS.month ? 'month' : 'week';
    $('#hoja-objetivo-t').textContent = g ? 'Editar objetivo' : 'Nuevo objetivo';
    $$('[data-edit-only]', gform).forEach(function (n) { n.hidden = !g; });
    typeSeg.hidden = !!g;
    F.date.min = TODAY;   // se puede poner un evento para hoy (la vista sabe pintarlo)
    F.name.value = isEv && g ? g.name : ''; F.date.value = isEv && g ? g.date : '2026-12-13';
    F.ekm.value = isEv && g ? nf(g.km) : ''; F.em.value = isEv && g ? nf(g.m) : '';
    var hh = g && !isEv && g.h ? Math.floor(g.h) : 0, mm = g && !isEv && g.h ? Math.round((g.h - hh) * 60) : 0;
    if (mm === 60) { hh++; mm = 0; }
    F.km.value = g && !isEv ? nf(g.km) : ''; F.m.value = g && !isEv ? nf(g.m) : '';
    F.h.value = g && !isEv && g.h ? String(hh) : ''; F.min.value = mm ? String(mm) : '';
    pick(typeSeg, g ? (isEv ? 0 : 1) : kind === 'volume' ? 1 : 0);
    pick(perSeg, per === 'month' ? 1 : 0);
    clearErr();
    updateReplace();
    FBT.sheet.open('hoja-objetivo', trigger);
  }
  doc.addEventListener('click', function (e) {
    var n = e.target.closest('[data-goal-new]');
    if (n) { open(null, n, n.dataset.goalNew === 'volume' ? 'volume' : n.dataset.goalNew === 'event' ? 'event' : ''); return; }
    var ed = e.target.closest('[data-goal-edit]');
    if (ed) { open(ed.dataset.goalEdit, ed); return; }
    var f = e.target.closest('[data-goal-fill]');
    if (f) {
      var week = curPer() === 'week';
      F.km.value = week ? '191' : '820'; F.m.value = week ? '2.450' : '10.500';
      F.h.value = week ? '7' : '31'; F.min.value = week ? '12' : '';
      clearErr();
    }
  });
  perSeg.addEventListener('segchange', function (e) {
    $('#fo-media').innerHTML = e.detail.value === 'week' ? 'Usar tu semana media: 191&nbsp;km, 2.450&nbsp;m y 7&nbsp;h&nbsp;12&nbsp;min' : 'Usar tu mes medio: 820&nbsp;km, 10.500&nbsp;m y 31&nbsp;h';
    updateReplace();
  });
  typeSeg.addEventListener('segchange', updateReplace);
  /* Tras guardar o borrar, el foco va al título de la sección (si no, caía en BODY) */
  function focusSec(k) {
    setTimeout(function () {
      var t = k === 'event' && GOALS.event ? $('#s-ev') : $('#s-vol');
      if (t) t.focus();
    }, 280);
  }
  gform.addEventListener('submit', function (e) {
    e.preventDefault();
    var isEvent = curType() === 'event';
    clearErr();
    if (isEvent && !F.name.value.trim()) {
      $('#fo-nombre-f').setAttribute('data-invalid', ''); F.name.setAttribute('aria-invalid', 'true'); $('#fo-nombre-e').hidden = false; F.name.focus(); return;
    }
    if (isEvent && !checkNums([F.ekm, F.em], $('#fo-ev-e'), function (i) { return i === F.ekm ? numMsg(i, '140,5', '1405') : numMsg(i, '2.600', '2600'); })) return;
    if (!isEvent) {
      if (!checkNums([F.km, F.m, F.h, F.min], $('#fo-vol-ne'), function (i) {
        return i === F.km ? numMsg(i, '74,5', '745') : i === F.m ? numMsg(i, '3.500', '3500')
          : i === F.h ? 'Escribe las horas así: 7, 7,5 o 7:30.' : 'Los minutos van de 0 a 59.';
      })) return;
      var hours = (parseIn(F.h).n || 0) + (parseIn(F.min).n || 0) / 60;
      if (!parseIn(F.km).n && !parseIn(F.m).n && !hours) { $('#fo-vol-e').hidden = false; F.km.focus(); return; }
    }
    var wasNew = !editing, key = target(), old = replaces(), was = editing ? GOALS[editing] : null;
    if (isEvent) {
      var prev = GOALS.event || { best: { km: 112, m: 1840 }, planned: 8 };
      GOALS.event = { name: F.name.value.trim(), date: F.date.value || '2026-12-13', km: parseIn(F.ekm).n, m: parseIn(F.em).n, best: prev.best, planned: prev.planned };
    } else {
      var base = BASE[key];
      GOALS[key] = { period: base.period, from: base.from, to: base.to, done: base.done, rest: base.rest,
        km: parseIn(F.km).n, m: parseIn(F.m).n, h: hours || undefined };
      if (editing && editing !== key) GOALS[editing] = null;   // al editar se cambió de semana a mes (o al revés)
    }
    FBT.sheet.close('hoja-objetivo');
    renderAll();
    if (old) {
      var edited = editing;
      FBT.toast('Objetivo sustituido', { tone: 'good', action: { label: 'Deshacer', onClick: function () {
        GOALS[key] = old; if (edited && edited !== key) GOALS[edited] = was;
        renderAll(); focusSec(key);
      } } });
    } else FBT.toast(wasNew ? 'Objetivo creado' : 'Cambios guardados', { tone: 'good' });
    focusSec(key);
  });
  $('[data-goal-delete]').addEventListener('click', function () {
    var key = editing, g = GOALS[key];
    FBT.sheet.close('hoja-objetivo');
    GOALS[key] = null; renderAll();
    FBT.toast('Objetivo borrado', { action: { label: 'Deshacer', onClick: function () { GOALS[key] = g; renderAll(); focusSec(key); } } });
    focusSec(key);
  });

  renderAll();
  renderPrev('all');
}
})();
