/* =====================================================================
   Historial (prototipo móvil). Lista de salidas agrupada por mes, con
   búsqueda, filtros y orden en una hoja inferior.
   Estados por URL: ?state=empty | loading | error (también ?estado=vacio…).
   Datos sintéticos de Osona, el Moianès y el Lluçanès: nunca un domicilio.
   En la app: las salidas salen de Dexie; los totales del mes, de aggregate();
   la media a día N, de la referencia (D2); la dificultad, de difficulty() (D5);
   «repetida», de groupRoutes().
   REQUISITO para la tarea de frontend (React): la lista no se pinta entera.
   Con 5.000 salidas (unos años de Strava) pintarla toda tardaba 13 s, 151.000
   nodos y 3 s por tecla. En la app: lista virtualizada agrupada por mes, con
   las cabeceras de mes pegajosas; búsqueda con 150 ms de espera tras la
   última tecla; miniaturas de forma dibujadas solo al entrar en pantalla;
   filtro «Periodo» (años) en la hoja. Este prototipo lo imita: 3 meses
   y 3 más cada vez que el final de la lista se acerca a la pantalla.
   Prueba de carga: ?salidas=5000 (salidas sintéticas hacia atrás desde ayer).
   ===================================================================== */
(function () {
'use strict';
var F = window.FBT, doc = document;
var NB = ' ';                                   // espacio fino antes de unidades y %
var Q = new URLSearchParams(location.search);
var STATE = { vacio: 'empty', carga: 'loading', cargando: 'loading' }[Q.get('estado')] || Q.get('state') || Q.get('estado') || '';

var TODAY = new Date(2026, 10, 6);                    // el prototipo vive el viernes 6 de noviembre de 2026
var MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
var MES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
var DIA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
var MEDIA_MES_KM = 700;                               // tu media mensual (referencia)

/* [mes 0-11, día, nombre, km, m, minutos en movimiento, dificultad 1-3, forma, ruta repetida] */
var RAW = [
  [10, 5, 'Collsuspina y Moià', 87.6, 1542, 192, 2, 3, 'cm'],
  [10, 3, 'Coll de Bracons desde Vic por la carretera vieja de Olot', 72.1, 1180, 176, 2, 11, 'br'],
  [10, 1, 'Vuelta corta a Tona', 41.3, 410, 92, 1, 19, 'to'],
  [9, 29, 'Rodaje por la Plana de Vic', 52.4, 380, 116, 1, 7, 'pl'],
  [9, 26, 'Rupit por el Collsacabra', 94.2, 1860, 248, 3, 23, ''],
  [9, 24, 'Lluçanès por Prats', 86.4, 1320, 206, 2, 5, 'pr'],
  [9, 21, 'Vuelta corta a Tona', 41.0, 405, 94, 1, 19, 'to'],
  [9, 18, 'Collformic y El Brull', 104.8, 2210, 282, 3, 29, ''],
  [9, 15, 'Sant Pere de Casserres', 63.5, 760, 150, 2, 31, ''],
  [9, 12, 'Collsuspina y Moià', 87.9, 1538, 212, 3, 3, 'cm'],
  [9, 10, 'Santa Maria de Besora', 78.3, 1420, 199, 2, 37, ''],
  [9, 5, 'Rodaje de recuperación', 38.2, 260, 86, 1, 41, ''],
  [9, 3, 'Sau y Tavertet', 71.6, 1290, 184, 2, 43, ''],
  [8, 28, 'Collsuspina y Moià', 86.8, 1551, 219, 3, 3, 'cm'],
  [8, 26, 'Sant Hilari por Viladrau', 98.7, 1940, 263, 3, 47, ''],
  [8, 23, 'Vuelta corta a Tona', 41.4, 412, 97, 1, 19, 'to'],
  [8, 20, 'La Garriga por el Figaró', 82.5, 1080, 196, 2, 53, ''],
  [8, 17, 'Rodaje por la Plana de Vic', 50.9, 350, 114, 1, 7, 'pl'],
  [8, 13, 'Coll de Bracons desde Vic por la carretera vieja de Olot', 72.4, 1175, 181, 2, 11, 'br'],
  [8, 10, 'Montesquiu y Sant Quirze', 61.2, 690, 146, 1, 59, ''],
  [8, 6, 'Collsuspina y Moià', 87.2, 1545, 226, 3, 3, 'cm'],
  [8, 2, 'Seva y el Montseny', 92.0, 1720, 238, 3, 61, '']
];
var RIDES = RAW.map(function (r, i) {
  return { id: i, date: new Date(2026, r[0], r[1]), name: r[2], km: r[3], m: r[4], min: r[5], dif: r[6], seed: r[7], route: r[8], kmh: r[3] / (r[5] / 60) };
});
/* Prueba de carga y de nombres extremos: ?salidas=N genera N salidas hacia atrás desde ayer */
(function synth(n) {
  if (!(n > 0)) return;
  var s = 4242, r = function () { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  var NAMES = ['Morning Ride', 'Salida matinal', 'Lunch Ride', 'Vuelta corta a Tona', 'Collsuspina y Moià', 'Rodaje por la Plana de Vic',
    'Volta llarga per la Plana de Vic, Sant Julià de Vilatorta, Folgueroles i Tavèrnoles amb la colla del diumenge 🚴‍♂️🔥☀️',
    'رحلة الصباح إلى الجبل', 'Sau y Tavertet', 'Afternoon Ride'];
  var d = new Date(2026, 10, 5), out = [];
  for (var i = 0; i < n; i++) {
    var km = 25 + r() * 110, kmh = 21 + r() * 8;
    out.push({ id: i, date: new Date(d), name: NAMES[Math.floor(r() * NAMES.length)], km: km, m: Math.round(km * (4 + r() * 18)),
      min: km / kmh * 60, dif: 1 + Math.floor(r() * 3), seed: Math.floor(r() * 60), route: r() < 0.2 ? 'r' + Math.floor(r() * 6) : '', kmh: kmh });
    d.setDate(d.getDate() - (r() < 0.3 ? 0 : 1 + Math.floor(r() * 2)));
  }
  RIDES = out;
})(+Q.get('salidas'));

/* ---------- Formato ---------- */
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function norm(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function hm(min) { return F.dur(min * 60, 'hm'); }
function hmFig(min) {                                  // «8 h 32» con las unidades en pequeño
  var h = Math.floor(min / 60), m = Math.round(min % 60);
  if (m === 60) { h++; m = 0; }
  return (h ? '<b>' + F.fmt(h) + '</b><span class="u">h</span>' : '') + '<b>' + (h && m < 10 ? '0' : '') + m + '</b>' + (h ? '' : '<span class="u">min</span>');
}
function pct(x) { var v = Math.round(x * 100); return (v > 0 ? '+' : v < 0 ? '−' : '') + F.fmt(Math.abs(v)) + NB + '%'; }
function plural(n, a, b) { return F.fmt(n) + ' ' + (n === 1 ? a : b); }
function dayDiff(d) { return Math.round((TODAY - d) / 864e5); }
function whenLabel(d, flat) {
  var k = dayDiff(d);
  if (k === 0) return 'Hoy';
  if (k === 1) return 'Ayer';
  if (flat) return d.getDate() + ' ' + MES_C[d.getMonth()] + (d.getFullYear() !== TODAY.getFullYear() ? ' ' + d.getFullYear() : '');   // lista sin meses: el año, si no es este
  return DIA[d.getDay()] + ' ' + d.getDate();
}
function ic(name) { return F.icon(name); }
function longDate(d) { return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }).format(d); }

/* ---------- Estado de la vista ---------- */
var S = { q: '', qn: '', sort: 'fecha', dist: 'all', dif: [], rep: false, year: 'all' };
var SORT_TXT = { km: 'de más a menos distancia', m: 'de más a menos desnivel', kmh: 'de más a menos rápida' };
var SORT_CHIP = { km: 'Por distancia', m: 'Por desnivel', kmh: 'Por velocidad' };
var DIST_TXT = { lt50: 'Menos de 50' + NB + 'km', '50-90': 'De 50 a 90' + NB + 'km', gt90: 'Más de 90' + NB + 'km' };
var DIF_TXT = ['', 'Suave', 'Media', 'Dura'];
var repCount = {};
RIDES.forEach(function (r) { r.nn = norm(r.name); });
RIDES.forEach(function (r) { if (r.route) repCount[r.route] = (repCount[r.route] || 0) + 1; });

function matches(r, st) {
  st = st || S;
  if (st.year !== 'all' && r.date.getFullYear() !== +st.year) return false;
  if (st.q && r.nn.indexOf(st.qn) < 0) return false;    // solo el nombre: la app no conoce los pueblos (no hay geocodificador)
  if (st.dist === 'lt50' && !(r.km < 50)) return false;
  if (st.dist === '50-90' && !(r.km >= 50 && r.km <= 90)) return false;
  if (st.dist === 'gt90' && !(r.km > 90)) return false;
  if (st.dif.length && st.dif.indexOf(r.dif) < 0) return false;
  if (st.rep && !(r.route && repCount[r.route] > 1)) return false;
  return true;
}
function filtersOn() { return S.dist !== 'all' || S.dif.length > 0 || S.rep || S.year !== 'all'; }
function activeCount() { return (S.sort !== 'fecha') + (S.dist !== 'all') + S.dif.length + (S.rep ? 1 : 0) + (S.year !== 'all'); }
function setQState(v) { S.q = v.trim(); S.qn = norm(S.q); }

/* ---------- Piezas ---------- */
/* Nombre con la búsqueda resaltada. Se compara sin tildes ni mayúsculas (como matches) y el rango
   se lleva al nombre original carácter a carácter. Si lo encontrado queda lejos del principio, la
   fila empieza poco antes («…per Tavèrnoles amb…»): con dos líneas, si no, quedaría oculto. */
function titleHTML(name) {
  if (!S.q) return esc(name);
  var nn = '', map = [];
  for (var i = 0; i < name.length;) {
    var ch = String.fromCodePoint(name.codePointAt(i)), n = norm(ch);
    for (var k = 0; k < n.length; k++) map.push(i);
    nn += n; i += ch.length;
  }
  map.push(name.length);
  var at = nn.indexOf(S.qn);
  if (at < 0) return esc(name);
  var a = map[at], b = map[at + S.qn.length], from = 0;
  if (a > 40) {                                        // empieza en la palabra anterior a la encontrada
    var sp = name.lastIndexOf(' ', a - 2);
    from = sp > 0 ? name.lastIndexOf(' ', sp - 1) + 1 : a;
    if (a - from > 24) from = sp + 1;
  }
  var html = (from ? '…' : '') + esc(name.slice(from, a)) + '<mark>' + esc(name.slice(a, b)) + '</mark>' + esc(name.slice(b));
  return from ? '<span aria-hidden="true">' + html + '</span><span class="sr-only">' + esc(name) + '</span>' : html;
}
function rowHTML(r, flat) {
  var repeated = r.route && repCount[r.route] > 1;
  return '<li><a class="row" href="salida.html?id=' + r.id + '">' +
    '<span class="row-lead row-lead--shape"><svg class="shape" data-ride="' + r.seed + '" aria-hidden="true"></svg>' +
      (repeated ? '<span class="rep-badge">' + ic('repeat') + '<span class="sr-only">Ruta repetida: </span></span>' : '') + '</span>' +
    '<span class="row-main"><span class="row-title" dir="auto" title="' + esc(r.name) + '">' + titleHTML(r.name) + '</span>' +
      '<span class="row-meta ride-meta"><span class="when">' + whenLabel(r.date, flat) + '</span>' +
      '<span data-m="elev">' + ic('mountain') + F.fmt(r.m) + NB + 'm</span></span></span>' +
    '<span class="row-trail"><span class="ride-figs"><span class="row-val">' + F.fmt(r.km, 1) + '<span class="u">km</span></span>' +
      '<span class="row-time"><span class="dif" data-dif="' + r.dif + '"><svg class="ic bars" aria-hidden="true"><use href="#i-bars' + r.dif + '"/></svg>' +
        '<span class="sr-only">, ' + DIF_TXT[r.dif].toLowerCase() + ' para ti, </span></span>' + hm(r.min) + '</span></span>' + ic('chev').replace('class="ic"', 'class="ic chev"') + '</span>' +
  '</a></li>';
}

function daysHTML(y, m, list, current) {
  var n = new Date(y, m + 1, 0).getDate(), km = {}, max = 110;
  list.forEach(function (r) { var d = r.date.getDate(); km[d] = (km[d] || 0) + r.km; });
  var cells = '';
  for (var d = 1; d <= n; d++) {
    var fut = current && d > TODAY.getDate();
    cells += km[d] ? '<i class="on" style="--h:' + Math.min(1, km[d] / max).toFixed(2) + '"></i>' : '<i' + (fut ? ' class="fut"' : '') + '></i>';
  }
  var longest = list.slice().sort(function (a, b) { return b.km - a.km; })[0];
  var label = 'Salidas por día de ' + MES[m].toLowerCase() + ': ' + plural(list.length, 'salida', 'salidas') +
    (longest ? '; la más larga, el ' + DIA[longest.date.getDay()].toLowerCase() + ' ' + longest.date.getDate() + ' con ' + F.fmt(longest.km, 1) + ' km' : '') + '.';
  var axis = current
    ? '<div class="days-axis" aria-hidden="true"><span>1</span><span class="today" style="left:' + ((TODAY.getDate() - 0.5) / n * 100).toFixed(2) + '%">hoy</span><span class="end">' + n + '</span></div>'
    : '';
  return '<div class="days" style="--n:' + n + '" role="img" aria-label="' + esc(label) + '">' + cells + '</div>' + axis;
}

function monthHTML(key, list, full) {
  var y = +key.split('-')[0], m = +key.split('-')[1];
  var current = y === TODAY.getFullYear() && m === TODAY.getMonth();
  var id = 'm-' + key;
  var name = MES[m] + (y !== TODAY.getFullYear() ? ' de ' + y : '');
  var km = 0, el = 0, min = 0;
  list.forEach(function (r) { km += r.km; el += r.m; min += r.min; });
  var bar = '<div class="month-bar"><div class="month-bar-in">' +
    '<h2 class="month-name" id="' + id + '">' + name + (current && full ? '<span class="month-note">hasta hoy</span>' : '') + '</h2>' +
    (full ? '<p class="month-km"><span class="sr-only">Distancia: </span>' + F.fmt(km, 1) + '<span class="u">km</span></p>'
          : '<p class="month-count">' + plural(list.length, 'salida', 'salidas') + '</p>') +
    '</div></div>';
  var sum = '';
  if (full) {
    var ref = current ? MEDIA_MES_KM * TODAY.getDate() / new Date(y, m + 1, 0).getDate() : MEDIA_MES_KM;
    var d = km / ref - 1, up = d >= 0;
    sum = '<div class="month-sum">' +
      '<p class="month-figs">' +
        '<span><span class="sr-only">Desnivel: </span><b>' + F.fmt(el) + '</b><span class="u">m</span></span>' +
        '<span><span class="sr-only">Tiempo en movimiento: </span>' + hmFig(min) + '</span>' +
        '<span><b>' + F.fmt(list.length) + '</b>' + (list.length === 1 ? 'salida' : 'salidas') + '</span>' +
      '</p>' +
      daysHTML(y, m, list, current) +
      '<p class="delta ' + (up ? 'delta--up' : 'delta--down') + '">' + ic(up ? 'up' : 'down') + (d > 2 ? 'Más del triple de km' : pct(d) + ' de km') + '<span class="vs">' +
        (current ? 'frente a tu media a día ' + TODAY.getDate() : 'frente a tu media mensual') + '</span></p>' +
    '</div>';
  }
  return '<section class="month' + (current ? '' : ' month--past') + '" aria-labelledby="' + id + '">' + bar + sum +
    '<ul class="list list--inset rides">' + list.map(function (r) { return rowHTML(r, false); }).join('') + '</ul></section>';
}

function stateHTML(kind, title, text, action) {
  return '<div class="card"><div class="state' + (kind ? ' state--' + kind : '') + '">' +
    '<span class="state-ic">' + ic(kind === 'error' ? 'alert' : kind === 'search' ? 'search' : 'bike') + '</span>' +
    '<h2 class="state-title">' + title + '</h2><p class="state-text">' + text + '</p>' + (action || '') + '</div></div>';
}

/* ---------- Pintado (por páginas) ---------- */
var list = doc.getElementById('lista'), res = doc.getElementById('resultado');
var applied = doc.getElementById('aplicados'), btnF = doc.getElementById('btn-filtros');
var IO = 'IntersectionObserver' in window;
var PAGE_MONTHS = 3, PAGE_ROWS = 40;

/* Miniaturas: solo cuando entran (o están a punto de entrar) en pantalla */
var shapeIO = IO ? new IntersectionObserver(function (es) {
  es.forEach(function (e) { if (!e.isIntersecting) return; var s = e.target; shapeIO.unobserve(s); F.shape(s, F.synth.route(+s.dataset.ride)); });
}, { rootMargin: '300px 0px' }) : null;
function drawShapes(ctx) {
  Array.prototype.forEach.call(ctx.querySelectorAll('svg.shape[data-ride]:not([data-drawn])'), function (s) {
    s.setAttribute('data-drawn', '');
    if (shapeIO) shapeIO.observe(s); else F.shape(s, F.synth.route(+s.dataset.ride));
  });
}

/* Centinela al final de la lista: al acercarse a la pantalla se añade la página siguiente */
var sentinel = doc.createElement('div');
sentinel.className = 'more-sentinel'; sentinel.setAttribute('aria-hidden', 'true');
list.parentNode.insertBefore(sentinel, list.nextSibling);
var feed = null;                                       // { items, step, i, target, tail }
var moreIO = IO ? new IntersectionObserver(function (es) { if (es[0].isIntersecting) more(); }, { rootMargin: '0px 0px 800px 0px' }) : null;
function more() {
  if (!feed || feed.i >= feed.items.length) return;
  var next = feed.items.slice(feed.i, feed.i + (moreIO ? feed.step : feed.items.length));
  feed.i += next.length;
  feed.target.insertAdjacentHTML('beforeend', next.map(feed.html).join(''));   // el HTML se construye solo al pintarse
  if (feed.i >= feed.items.length && feed.tail) list.insertAdjacentHTML('beforeend', feed.tail);
  drawShapes(feed.target);
  // Si la página no llena la pantalla, el centinela sigue a la vista: se vuelve a observar para pedir otra
  if (moreIO && feed.i < feed.items.length) { moreIO.unobserve(sentinel); moreIO.observe(sentinel); }
}
function startFeed(target, items, html, step, tail) {
  feed = { items: items, html: html, step: step, i: 0, target: target, tail: tail };
  more();
}

function render() {
  var plain = !S.q && !filtersOn();
  var out = RIDES.filter(function (r) { return matches(r); });
  var key = { fecha: function (r) { return -r.date; }, km: function (r) { return -r.km; }, m: function (r) { return -r.m; }, kmh: function (r) { return -r.kmh; } }[S.sort];
  out.sort(function (a, b) { return key(a) - key(b); });

  // Línea de resultado: solo cuando la lista no es la de siempre
  if ((plain && S.sort === 'fecha') || !out.length) { res.textContent = ''; }   // sin resultados lo dice el estado vacío
  else {
    res.innerHTML = '<span><b>' + F.fmt(out.length) + '</b> de ' + plural(RIDES.length, 'salida', 'salidas') +
      (S.sort !== 'fecha' ? ', ' + SORT_TXT[S.sort] : '') + '</span>' +
      (activeCount() ? '<button class="btn btn--ghost" type="button" data-reset>Quitar filtros</button>' : '');
  }

  feed = null;
  if (moreIO) moreIO.unobserve(sentinel);
  if (!out.length) {
    list.innerHTML = S.q
      ? stateHTML('search', 'Ninguna salida con «' + esc(S.q) + '»', 'Prueba con otra palabra del nombre de la salida.', '<button class="btn btn--secondary" type="button" data-clear-q>' + ic('x') + 'Borrar la búsqueda</button>')
      : stateHTML('search', 'Ninguna salida con estos filtros', 'Quita alguno para ver más salidas.', '<button class="btn btn--secondary" type="button" data-reset>Quitar filtros</button>');
  } else if (S.sort === 'fecha') {
    var groups = [], idx = {};
    out.forEach(function (r) {
      var k = r.date.getFullYear() + '-' + r.date.getMonth();
      if (!(k in idx)) { idx[k] = groups.length; groups.push({ key: k, list: [] }); }
      groups[idx[k]].list.push(r);
    });
    list.innerHTML = '';
    startFeed(list, groups, function (g) { return monthHTML(g.key, g.list, plain); }, PAGE_MONTHS,
      /* En la app: «Tu primera salida importada es del …». El ejemplo solo trae tres meses (Más cuenta 214 salidas): no se afirma aquí */
      plain ? '<p class="end-note">El ejemplo acaba el ' + longDate(out[out.length - 1].date) + '. En la app siguen tus salidas anteriores, hasta la primera que importaste.</p>' : '');
  } else {
    list.innerHTML = '<ul class="list list--inset rides"></ul>';
    startFeed(list.firstChild, out, function (r) { return rowHTML(r, true); }, PAGE_ROWS, '');
  }
  paintApplied();
  syncSheet();
  keepInUrl();
}

/* La búsqueda y el orden viven en la URL: al volver de una salida o al compartir el enlace se conservan */
function keepInUrl() {
  try {
    var u = new URL(location.href);
    if (S.q) u.searchParams.set('q', S.q); else u.searchParams.delete('q');
    if (S.sort !== 'fecha') u.searchParams.set('orden', S.sort); else u.searchParams.delete('orden');
    if (S.year !== 'all') u.searchParams.set('periodo', S.year); else u.searchParams.delete('periodo');
    if (u.href !== location.href) history.replaceState(null, '', u.href);
  } catch (e) { /* file:// en algunos navegadores */ }
}

function paintApplied() {
  var chips = [];
  if (S.sort !== 'fecha') chips.push(['sort', SORT_CHIP[S.sort]]);
  if (S.year !== 'all') chips.push(['year', yearTxt(S.year)]);
  if (S.dist !== 'all') chips.push(['dist', DIST_TXT[S.dist]]);
  S.dif.slice().sort().forEach(function (d) { chips.push(['dif:' + d, DIF_TXT[d]]); });
  if (S.rep) chips.push(['rep', 'Solo repetidas']);
  applied.hidden = !chips.length;
  applied.innerHTML = chips.map(function (c) {
    return '<button class="fchip fchip--x" type="button" data-remove="' + c[0] + '" aria-label="Quitar el filtro ' + esc(c[1]) + '"><span>' + c[1] + ic('x') + '</span></button>';
  }).join('');
  var n = chips.length;
  btnF.setAttribute('aria-label', 'Filtrar y ordenar' + (n ? ', ' + plural(n, 'filtro activo', 'filtros activos') : ''));
  var badge = btnF.querySelector('.count');
  if (n && !badge) { btnF.insertAdjacentHTML('beforeend', '<span class="count" aria-hidden="true"></span>'); badge = btnF.querySelector('.count'); }
  if (badge) { if (n) badge.textContent = n; else badge.remove(); }
}

/* ---------- Hoja de filtros: se aplica en directo ---------- */
var segOrden = doc.getElementById('f-orden'), dist = doc.getElementById('f-dist'), dif = doc.getElementById('f-dif');
var rep = doc.getElementById('f-rep'), ver = doc.getElementById('f-ver'), none = doc.getElementById('f-none');
/* Periodo: un chip por año con salidas, para saltar a 2019 sin cientos de pantallas de pulgar */
var per = doc.getElementById('f-per'), THIS_YEAR = TODAY.getFullYear();
function yearTxt(y) { return +y === THIS_YEAR ? 'Este año' : String(y); }
var YEARS = [];
RIDES.forEach(function (r) { var y = r.date.getFullYear(); if (YEARS.indexOf(y) < 0) YEARS.push(y); });
YEARS.sort(function (a, b) { return b - a; });
if (YEARS.length < 2) doc.getElementById('g-per').hidden = true;     // con un solo año no hay nada que elegir
function chipHTML(v, txt, on) {
  return '<button class="fchip" type="button" data-value="' + v + '" aria-pressed="' + on + '"><span>' + F.icon('check', 'ic-check') + txt + '</span></button>';
}
per.innerHTML = chipHTML('all', 'Todos', true) + YEARS.map(function (y) { return chipHTML(y, yearTxt(y), false); }).join('');
function pressYear(v) { Array.prototype.forEach.call(per.querySelectorAll('.fchip'), function (c) { c.setAttribute('aria-pressed', String(c.dataset.value === String(v))); }); }
per.addEventListener('chipchange', function (e) { S.year = e.detail.value; render(); });
function syncSheet() {
  var n = RIDES.filter(function (r) { return matches(r); }).length;
  ver.textContent = n ? 'Ver ' + plural(n, 'salida', 'salidas') : 'Ver resultados';
  none.hidden = n > 0;
}
segOrden.addEventListener('segchange', function (e) { S.sort = e.detail.value; render(); });
dist.addEventListener('chipchange', function (e) { S.dist = e.detail.value; render(); });
dif.addEventListener('chipchange', function () {
  S.dif = Array.prototype.filter.call(dif.querySelectorAll('.fchip'), function (c) { return c.getAttribute('aria-pressed') === 'true'; }).map(function (c) { return +c.dataset.value; });
  render();
});
doc.addEventListener('click', function (e) {          // después del kit: el interruptor ya ha cambiado
  var t = e.target;
  if (t.closest('#f-rep')) { S.rep = rep.getAttribute('aria-checked') === 'true'; render(); return; }
  if (t.closest('#f-reset') || t.closest('[data-reset]')) { reset(t.closest('[data-reset]')); return; }
  if (t.closest('[data-clear-q]')) { setQ(''); qIn.focus(); return; }
  var x = t.closest('[data-remove]');
  if (x) { removeChip(x.dataset.remove); return; }
});
function pressSort(v) { var b = segOrden.querySelector('[data-value="' + v + '"]'); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); }
function reset(fromList) {
  S.dist = 'all'; S.dif = []; S.rep = false; S.year = 'all'; pressYear('all');
  Array.prototype.forEach.call(dist.querySelectorAll('.fchip'), function (c) { c.setAttribute('aria-pressed', c.dataset.value === 'all' ? 'true' : 'false'); });
  Array.prototype.forEach.call(dif.querySelectorAll('.fchip'), function (c) { c.setAttribute('aria-pressed', 'false'); });
  rep.setAttribute('aria-checked', 'false');
  if (S.sort !== 'fecha') pressSort('fecha'); else render();   // pressSort ya vuelve a pintar
  if (fromList) { F.toast('Filtros quitados', { tone: 'info' }); qIn.focus(); }
}
function removeChip(k) {
  var next = applied.querySelector('[data-remove="' + k + '"]');
  next = next && (next.nextElementSibling || next.previousElementSibling);
  var nextKey = next && next.dataset.remove;
  if (k === 'sort') pressSort('fecha');
  else if (k === 'year') { S.year = 'all'; pressYear('all'); render(); }
  else if (k === 'dist') { S.dist = 'all'; Array.prototype.forEach.call(dist.querySelectorAll('.fchip'), function (c) { c.setAttribute('aria-pressed', c.dataset.value === 'all' ? 'true' : 'false'); }); render(); }
  else if (k === 'rep') { S.rep = false; rep.setAttribute('aria-checked', 'false'); render(); }
  else if (k.indexOf('dif:') === 0) {
    var d = +k.slice(4); S.dif = S.dif.filter(function (x) { return x !== d; });
    var c = dif.querySelector('[data-value="' + d + '"]'); if (c) c.setAttribute('aria-pressed', 'false'); render();
  }
  // El foco no se pierde al desaparecer el chip: pasa al siguiente o al botón de filtros
  var f = nextKey && applied.querySelector('[data-remove="' + nextKey + '"]');
  (f || btnF).focus();
}

/* ---------- Búsqueda ---------- */
var qIn = doc.getElementById('q'), qClear = doc.getElementById('q-clear');
var qT = null;
function setQ(v) { clearTimeout(qT); qIn.value = v; setQState(v); qClear.hidden = !v; render(); }
qIn.addEventListener('input', function () {             // se busca 150 ms después de la última tecla
  qClear.hidden = !qIn.value;
  clearTimeout(qT);
  qT = setTimeout(function () { setQState(qIn.value); render(); }, 150);
});
qIn.addEventListener('keydown', function (e) { if (e.key === 'Escape' && qIn.value) { e.preventDefault(); setQ(''); } });
qClear.addEventListener('click', function () { setQ(''); qIn.focus(); });
doc.addEventListener('keydown', function (e) {        // «/» lleva a la búsqueda (teclado físico)
  if (e.key === '/' && !/input|textarea/i.test(doc.activeElement.tagName) && !doc.querySelector('dialog[open]')) { e.preventDefault(); qIn.focus(); }
});

/* ---------- Estados ---------- */
var lead = doc.getElementById('lead'), tools = doc.getElementById('toolbar');
if (STATE === 'loading') {
  list.setAttribute('aria-busy', 'true');
  qIn.disabled = true; btnF.disabled = true;
  lead.hidden = true;                                  // como en el estado normal: sin entradilla
  var rows = '';
  [72, 58, 84, 64, 50].forEach(function (w, i) {
    rows += '<div class="sk-ride"><span class="sk sk-circle"></span><span class="sk-stack"><span class="sk sk-line" style="width:' + w + '%"></span><span class="sk sk-line" style="width:' + (36 + i * 4) + '%"></span></span><span class="sk sk-line"></span></div>';
  });
  list.innerHTML = '<span class="sr-only">Cargando tus salidas…</span><div class="month" aria-hidden="true">' +
    '<div class="month-bar"><div class="month-bar-in"><span class="sk sk-title" style="width:40%;height:22px"></span><span class="sk sk-line" style="width:72px;height:22px"></span></div></div>' +
    '<span class="sk sk-line" style="width:62%"></span><span class="sk sk-days"></span>' +
    '<div class="list">' + rows + '</div></div>';
} else if (STATE === 'empty') {
  lead.textContent = 'Aquí verás cada salida, agrupada por mes.';
  tools.hidden = true;
  list.innerHTML = stateHTML('', 'Aún no hay salidas', 'Importa el archivo que te envía Strava. Tus salidas se guardan solo en este teléfono.',
    '<a class="btn btn--primary" href="importar.html">' + ic('upload') + 'Importar salidas</a>');
} else if (STATE === 'error') {
  tools.hidden = true;
  lead.textContent = 'Tus salidas siguen guardadas en este teléfono.';
  list.innerHTML = stateHTML('error', 'No se han podido abrir tus salidas',
    'El navegador no ha dejado leer los datos guardados. Cierra las otras pestañas de FBikeTrain y vuelve a intentarlo.',
    '<button class="btn btn--secondary" type="button" id="retry">' + ic('refresh') + 'Reintentar</button>');
  doc.getElementById('retry').addEventListener('click', function () { location.href = location.pathname + (Q.get('theme') ? '?theme=' + Q.get('theme') : ''); });
} else {
  lead.hidden = true;   // el recuento ya sale en «N de M salidas» al filtrar y en las cifras de cada mes
  if (Q.get('q')) { qIn.value = Q.get('q'); setQState(Q.get('q')); qClear.hidden = false; }   // enlace directo a una búsqueda
  if (YEARS.indexOf(+Q.get('periodo')) >= 0) { S.year = Q.get('periodo'); pressYear(S.year); }
  render();
  if (SORT_TXT[Q.get('orden')]) pressSort(Q.get('orden'));
}
})();
