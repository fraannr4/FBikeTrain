/* FBikeTrain, prototipo final: AppShell y utilidades compartidas.
   En la app real cada pieza es un componente React (ver design-system.md).
   Aquí se inyecta con JS para no repetir el marco en cada HTML. */
(function () {
'use strict';
var root = document.documentElement;
var NS = 'http://www.w3.org/2000/svg';
var params = new URLSearchParams(location.search);
var FASE = params.get('fase') === '1' ? 1 : 5;
var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Iconos lucide (trazos 24x24 del set) ---------- */
var I = {
  house: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  sliders: '<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  bike: '<circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
  timer: '<path d="M10 2h4"/><path d="m12 14 3-3"/><circle cx="12" cy="14" r="8"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  trend: '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  max: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  chevdown: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  milestone: '<path d="M12 13v8"/><path d="M12 3v3"/><path d="M4 6a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h13a2 2 0 0 0 1.152-.365l3.424-2.317a1 1 0 0 0 0-1.635l-3.424-2.318A2 2 0 0 0 17 6z"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkc: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  key: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  table: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  filter: '<path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/>',
  sort: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  swap: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  palette: '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  bars1: '<rect x="1" y="7" width="2.4" height="4" rx=".6" fill="currentColor" stroke="none"/><rect x="4.8" y="4" width="2.4" height="7" rx=".6" fill="currentColor" stroke="none" opacity=".3"/><rect x="8.6" y="1" width="2.4" height="10" rx=".6" fill="currentColor" stroke="none" opacity=".3"/>',
  bars2: '<rect x="1" y="7" width="2.4" height="4" rx=".6" fill="currentColor" stroke="none"/><rect x="4.8" y="4" width="2.4" height="7" rx=".6" fill="currentColor" stroke="none"/><rect x="8.6" y="1" width="2.4" height="10" rx=".6" fill="currentColor" stroke="none" opacity=".3"/>',
  bars3: '<rect x="1" y="7" width="2.4" height="4" rx=".6" fill="currentColor" stroke="none"/><rect x="4.8" y="4" width="2.4" height="7" rx=".6" fill="currentColor" stroke="none"/><rect x="8.6" y="1" width="2.4" height="10" rx=".6" fill="currentColor" stroke="none"/>'
};
var sprite = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
  Object.keys(I).map(function (k) { return '<symbol id="i-' + k + '" viewBox="' + (k.indexOf('bars') === 0 ? '0 0 12 12' : '0 0 24 24') + '">' + I[k] + '</symbol>'; }).join('') +
  '<clipPath id="hito-clip"><path d="M1.5 33V13A11.5 11.5 0 0 1 24.5 13V33Z"/></clipPath></defs></svg>';
document.body.insertAdjacentHTML('afterbegin', sprite);

function ic(name, cls) { return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
var HITO = '<svg class="hito-logo" viewBox="0 0 26 34" aria-hidden="true"><path class="body" d="M1.5 33V13A11.5 11.5 0 0 1 24.5 13V33Z"/><rect class="band" x="0" y="0" width="26" height="11" clip-path="url(#hito-clip)"/><text x="13" y="28" text-anchor="middle">F</text></svg>';

/* ---------- AppShell: menú lateral, barra inferior, hoja «Más» y avisos ---------- */
var page = document.body.getAttribute('data-page');
var q = FASE === 1 ? '?fase=1' : '';
var NAV = [
  { id: 'inicio', t: 'Inicio', i: 'house', href: 'inicio.html' },
  { id: 'historial', t: 'Historial', i: 'chart', href: 'historial.html', f: 2 },
  { id: 'subidas', t: 'Subidas', i: 'mountain', href: '#', f: 2 },
  { id: 'calendario', t: 'Calendario', i: 'calendar', href: '#', f: 3 },
  { id: 'rutas', t: 'Rutas', i: 'route', href: 'rutas.html', f: 4 },
  { id: 'rutas-ia', t: 'Rutas con IA', i: 'sparkles', href: 'rutas.html?modo=ia', f: 5, tag: 'IA' },
  { sep: true },
  { id: 'importar', t: 'Importar', i: 'upload', href: 'importar.html' },
  { id: 'ajustes', t: 'Ajustes', i: 'sliders', href: 'ajustes.html' }
];
var modoIA = params.get('modo') === 'ia';
function cur(id) { return id === page && !(id === 'rutas' && modoIA) || (id === 'rutas-ia' && page === 'rutas' && modoIA); }
/* Sin salidas importadas (?estado=vacio) no hay avisos ni tarjeta de última importación */
var VACIO = params.get('estado') === 'vacio';
/* Avisos locales, los de inicioNotices() del plan: importación con más de 7 días y copia
   más antigua que la última importación. Con los datos de ejemplo (importaste hace 3 días,
   copia de hace 12) solo salta el de la copia. Sin avisos no hay campana. */
var NOTICES = VACIO ? [] : [
  { ic: 'archive', t: 'Tienes salidas importadas después de tu última copia, de hace 12 días.', a: 'Hacer copia', href: 'ajustes.html' + q }
].concat(FASE >= 3 ? [{ ic: 'calendar', t: 'Mañana: Coll d\'Estenalles, 72 km.', a: 'Ver salida', href: '#' }] : []);
var side = document.querySelector('.side');
if (side) {
  side.setAttribute('aria-label', 'Barra lateral');
  side.innerHTML = '<div class="side-in">' +
    '<a class="brand" href="inicio.html' + q + '" aria-label="FBikeTrain, inicio">' + HITO + '<span class="brand-name">FBikeTrain</span></a>' +
    '<nav aria-label="Menú principal"><ul class="nav">' + NAV.filter(function (n) { return !n.f || n.f <= FASE; }).map(function (n) {
      if (n.sep) return '<li class="nav-sep" role="presentation"></li>';
      var href = n.href === '#' ? '#' : n.href + (q ? (n.href.indexOf('?') > -1 ? '&' : '?') + 'fase=1' : '');
      return '<li><a href="' + href + '" class="press"' + (cur(n.id) ? ' aria-current="page"' : '') + '>' + ic(n.i) + '<span>' + n.t + '</span>' + (n.tag ? '<span class="tag" aria-hidden="true">' + n.tag + '</span>' : '') + '</a></li>';
    }).join('') + '</ul></nav>' +
    '<div class="side-foot">' +
      '<div class="import-card"><svg class="contours" viewBox="0 0 150 120" aria-hidden="true" data-topo="side"></svg>' +
        (VACIO ? '<p class="t">Aún no has importado salidas</p><p class="s">Sube el archivo que te envía Strava.</p>'
               : '<p class="t">Importaste hace 3 días</p><p class="s">13 salidas nuevas desde Strava</p>') +
        '<a href="importar.html' + q + '" class="btn btn-primary press">' + ic('upload', 'ic-sm') + (VACIO ? 'Importar salidas' : 'Importar') + '</a></div>' +
      '<div class="seg" role="group" aria-label="Tema"><button type="button" data-theme-set="dark" class="press">' + ic('moon', 'ic-sm') + 'Oscuro</button><button type="button" data-theme-set="light" class="press">' + ic('sun', 'ic-sm') + 'Claro</button></div>' +
      '<p class="version">FBikeTrain 0.5.0</p>' +
    '</div></div>';
}

var TABS = FASE === 1
  ? [{ id: 'inicio', t: 'Inicio', i: 'house', href: 'inicio.html?fase=1' }, { id: 'importar', t: 'Importar', i: 'upload', href: 'importar.html?fase=1' }]
  : [{ id: 'inicio', t: 'Inicio', i: 'house', href: 'inicio.html' }, { id: 'historial', t: 'Historial', i: 'chart', href: 'historial.html' },
     { id: 'rutas', t: 'Rutas', i: 'route', href: 'rutas.html' }, { id: 'rutas-ia', t: 'IA', i: 'sparkles', href: 'rutas.html?modo=ia' }];
var MORE = FASE === 1
  ? [{ t: 'Ajustes', i: 'sliders', href: 'ajustes.html?fase=1' }]
  : [{ t: 'Subidas', i: 'mountain', href: '#' }, { t: 'Calendario', i: 'calendar', href: '#' }, { t: 'Importar', i: 'upload', href: 'importar.html' }, { t: 'Ajustes', i: 'sliders', href: 'ajustes.html' }];
document.body.insertAdjacentHTML('beforeend',
  '<nav class="tabbar" aria-label="Pestañas" style="--tabs:' + (TABS.length + 1) + '">' + TABS.map(function (t) {
    return '<a href="' + t.href + '" class="press"' + (cur(t.id) ? ' aria-current="page"' : '') + '><span class="tic">' + ic(t.i) + '</span>' + t.t + '</a>';
  }).join('') + '<button type="button" class="press" id="more" aria-haspopup="dialog" aria-expanded="false" aria-controls="sheet"><span class="tic">' + ic('more') + '</span>Más</button></nav>' +
  '<dialog class="sheet" id="sheet" aria-labelledby="sheet-h"><div class="grab" aria-hidden="true"></div><h2 id="sheet-h">Más</h2>' +
    '<button class="icon-btn sheet-close press" type="button" aria-label="Cerrar" data-close>' + ic('x') + '</button>' +
    '<ul class="sheet-list">' + MORE.map(function (m) { return '<li><a href="' + m.href + '">' + ic(m.i) + m.t + ic('chev', 'chev') + '</a></li>'; }).join('') + '</ul>' +
    '<div class="sheet-theme"><p id="sheet-theme-l">Tema</p><div class="seg" role="group" aria-labelledby="sheet-theme-l"><button type="button" data-theme-set="dark" class="press">' + ic('moon', 'ic-sm') + 'Oscuro</button><button type="button" data-theme-set="light" class="press">' + ic('sun', 'ic-sm') + 'Claro</button></div></div>' +
  '</dialog>' +
  '<div id="avisos" popover aria-labelledby="avisos-h"><h2 id="avisos-h">Avisos</h2><ul>' + NOTICES.map(function (n) {
    return '<li>' + ic(n.ic) + '<p>' + n.t + '<a class="link" href="' + n.href + '">' + n.a + '</a></p></li>';
  }).join('') + '</ul></div>');
/* Campana: «Avisos, N avisos»; sin avisos no se pinta */
document.querySelectorAll('[popovertarget="avisos"]').forEach(function (b) {
  var n = NOTICES.length;
  if (!n) { b.hidden = true; return; }
  b.setAttribute('aria-label', 'Avisos, ' + n + (n === 1 ? ' aviso' : ' avisos'));
  var badge = b.querySelector('.badge'); if (badge) badge.textContent = n;
});

/* ---------- Tema ---------- */
var themeCbs = [];
function syncTheme() {
  var t = root.getAttribute('data-theme');
  document.querySelectorAll('[data-theme-set]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.themeSet === t)); });
}
document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-theme-set]'); if (!b) return;
  root.setAttribute('data-theme', b.dataset.themeSet);
  try { localStorage.setItem('fbt-theme', b.dataset.themeSet); } catch (err) {}
  syncTheme(); themeCbs.forEach(function (f) { f(); });
});
syncTheme();

/* ---------- Hoja «Más» y avisos ---------- */
var sheet = document.getElementById('sheet'), more = document.getElementById('more');
more.addEventListener('click', function () { sheet.showModal(); more.setAttribute('aria-expanded', 'true'); });
sheet.addEventListener('close', function () { more.setAttribute('aria-expanded', 'false'); });
sheet.querySelector('[data-close]').addEventListener('click', function () { sheet.close(); });
sheet.addEventListener('click', function (e) { if (e.target === sheet) sheet.close(); });
var avisos = document.getElementById('avisos');
avisos.addEventListener('beforetoggle', function (e) {
  if (e.newState !== 'open') return;
  var bell = document.querySelector('[popovertarget="avisos"]:not([hidden])');
  var bells = Array.prototype.filter.call(document.querySelectorAll('[popovertarget="avisos"]'), function (x) { return x.offsetParent; });
  bell = bells[0] || bell; if (!bell) return;
  var r = bell.getBoundingClientRect();
  avisos.style.position = 'fixed'; avisos.style.top = (r.bottom + 8) + 'px';
  avisos.style.left = Math.max(12, Math.min(innerWidth - 342, r.right - 330)) + 'px';
});

/* ---------- Utilidades ---------- */
function nf(v, d) { d = d || 0; return new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'always' }).format(v).replace('-', '−'); }
function hm(h) { var t = Math.round(h * 60); return Math.floor(t / 60) + ' h ' + String(t % 60).padStart(2, '0') + ' min'; }
function tok(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }
function hexA(hex, a) {
  var h = hex.replace('#', ''); if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
  return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')';
}
function el(tag, attrs, parent) {
  var n = document.createElementNS(NS, tag);
  for (var k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function smoothstep(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
var uid = 0; function gid(p) { return p + (++uid); }
function pathOf(pts, close) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('') + (close ? 'Z' : ''); }
function smoothPath(pts) {
  var d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
  for (var i = 0; i < pts.length - 1; i++) {
    var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += 'C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) + ' ' + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) + ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
  }
  return d;
}

/* Perfiles sintéticos (km, m) */
function makeProfile(keys, total, seed) {
  var r = rng(seed), out = [], step = 0.2, ph1 = r() * 6, ph2 = r() * 6;
  for (var km = 0; km <= total + 1e-6; km += step) {
    var i = 0; while (i < keys.length - 2 && keys[i + 1][0] < km) i++;
    var a = keys[i], b = keys[i + 1], t = (km - a[0]) / (b[0] - a[0]);
    out.push([Math.round(km * 10) / 10, a[1] + (b[1] - a[1]) * t + Math.sin(km * 1.7 + ph1) * 6 + Math.sin(km * 0.55 + ph2) * 11]);
  }
  for (var pass = 0; pass < 2; pass++) {
    out = out.map(function (p, j) { var s = 0, n = 0; for (var k = -2; k <= 2; k++) { var q2 = out[j + k]; if (q2) { s += q2[1]; n++; } } return [p[0], s / n]; });
  }
  return out;
}
function gradeClass(g) { return g < 1 ? 0 : g < 4 ? 1 : g < 7 ? 2 : g < 10 ? 3 : g < 16 ? 4 : 5; }
function gradeRuns(prof) {
  var runs = [], seg = 0.6, total = prof[prof.length - 1][0];
  function eleAt(km) { return prof[Math.min(prof.length - 1, Math.round(km / 0.2))][1]; }
  for (var x = 0; x < total - 1e-6; x += seg) {
    var x1 = Math.min(total, x + seg), g = (eleAt(x1) - eleAt(x)) / ((x1 - x) * 1000) * 100, c = gradeClass(g), last = runs[runs.length - 1];
    if (last && last.c === c) last.x1 = x1; else runs.push({ x0: x, x1: x1, c: c });
  }
  return runs;
}
var SLOPE_LABELS = ['menos del 1 % o bajada', '1 a 4 %', '4 a 7 %', '7 a 10 %', '10 a 16 %', '16 % o más'];
var SLOPE_SHORT = ['llano', '1–4 %', '4–7 %', '7–10 %', '10–16 %', '16+ %'];

/* Perfil por pendiente: un path con degradado horizontal, ejes en km y cota máxima */
function renderProfile(box, prof, opts) {
  opts = opts || {};
  var svg = box.querySelector('svg'), H = +svg.getAttribute('data-h'), W = Math.max(140, box.clientWidth);
  var axis = opts.axis ? 18 : 0, top = opts.peak ? 20 : 4;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + (H + axis)); svg.setAttribute('height', H + axis);
  svg.textContent = '';
  var total = prof[prof.length - 1][0], emin = Infinity, emax = -Infinity, pk = prof[0];
  prof.forEach(function (p) { emin = Math.min(emin, p[1]); emax = Math.max(emax, p[1]); if (p[1] > pk[1]) pk = p; });
  var bot = H - 1;
  var X = function (km) { return km / total * W; }, Y = function (e) { return top + (1 - (e - emin) / (emax - emin)) * (bot - top) * 0.94; };
  var id = gid('pg'), defs = el('defs', {}, svg), lg = el('linearGradient', { id: id, x1: 0, x2: 1, y1: 0, y2: 0 }, defs);
  gradeRuns(prof).forEach(function (r) { ['x0', 'x1'].forEach(function (k) { el('stop', { offset: (r[k] / total).toFixed(4), style: 'stop-color:var(--g' + r.c + ')' }, lg); }); });
  var d = prof.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); }).join('');
  el('path', { d: d + 'L' + W + ' ' + H + 'L0 ' + H + 'Z', fill: 'url(#' + id + ')' }, svg);
  el('path', { d: d, fill: 'none', stroke: 'var(--ink)', 'stroke-opacity': '.5', 'stroke-width': 1.2, 'stroke-linejoin': 'round' }, svg);
  if (opts.axis) {
    el('line', { x1: 0, x2: W, y1: H + 0.5, y2: H + 0.5, stroke: 'var(--line-strong)' }, svg);
    var step = total > 60 ? 20 : 10;
    for (var k = 0; k <= total; k += step) {
      var tx = X(k), anchor = k === 0 ? 'start' : (W - tx < 30 ? 'end' : 'middle');
      var t = el('text', { class: 'ax', x: tx, y: H + 15, 'text-anchor': anchor }, svg); t.textContent = k === 0 ? '0 km' : nf(k);
    }
  }
  if (opts.peak) {
    var px = X(pk[0]), py = Y(pk[1]);
    el('circle', { class: 'pkdot', cx: px, cy: py, r: 3.2 }, svg);
    var pt = el('text', { class: 'pk', x: px, y: py - 8, 'text-anchor': px > W - 60 ? 'end' : px < 60 ? 'start' : 'middle' }, svg);
    pt.textContent = nf(pk[1]) + ' m';
  }
  var xl = el('line', { class: 'xline', x1: 0, x2: 0, y1: top - 4, y2: H }, svg);
  var tip = box.querySelector('.prof-tip');
  if (tip) {
    svg.onpointermove = function (ev) {
      var r = svg.getBoundingClientRect(), x = Math.min(W, Math.max(0, ev.clientX - r.left)), km = x / W * total;
      var i = Math.min(prof.length - 1, Math.round(km / 0.2)), j = Math.min(prof.length - 1, i + 3), k0 = Math.max(0, i - 2);
      var g = (prof[j][1] - prof[k0][1]) / ((prof[j][0] - prof[k0][0]) * 1000 || 1) * 100;
      xl.setAttribute('x1', x); xl.setAttribute('x2', x); xl.classList.add('on');
      tip.textContent = 'km ' + nf(prof[i][0], 1) + ', ' + nf(prof[i][1]) + ' m, ' + nf(g, 1) + ' %';
      tip.style.left = Math.min(r.width - 74, Math.max(74, x)) + 'px'; tip.style.top = (svg.offsetTop + top - 6) + 'px'; tip.classList.add('on');
    };
    svg.onpointerleave = function () { xl.classList.remove('on'); tip.classList.remove('on'); };
  }
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Perfil de ' + nf(total, 1) + ' km, de ' + nf(emin) + ' a ' + nf(emax) + ' m; cota máxima en el km ' + nf(pk[0]));
}
function renderLegend(holder, prof) {
  var used = {}; gradeRuns(prof).forEach(function (r) { used[r.c] = 1; });
  holder.textContent = '';
  [1, 2, 3, 4, 5, 0].forEach(function (c) {
    if (!used[c]) return;
    var s = document.createElement('span'); s.title = 'Pendiente ' + SLOPE_LABELS[c];
    s.innerHTML = '<i style="background:var(--g' + c + ')"></i>' + SLOPE_SHORT[c]; holder.appendChild(s);
  });
}

/* Formas de ruta (lazo procedimental) y curvas de nivel */
function loop(seed, n) {
  var r = rng(seed), a = [r() * 6, r() * 6, r() * 6, r() * 6], pts = [];
  for (var i = 0; i <= n; i++) {
    var t = i / n * Math.PI * 2;
    var rad = 1 + 0.22 * Math.sin(2 * t + a[0]) + 0.13 * Math.sin(3 * t + a[1]) + 0.07 * Math.sin(5 * t + a[2]) + 0.035 * Math.sin(11 * t + a[3]);
    pts.push([Math.cos(t) * rad * 1.25, Math.sin(t) * rad]);
  }
  return pts.map(function (p, i) { var j = (i % 7 === 3) ? 0.035 : 0; return [p[0] + j, p[1] - j]; });
}
function fit(pts, w, h, pad) {
  var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  pts.forEach(function (p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
  var s = Math.min((w - pad * 2) / (x1 - x0), (h - pad * 2) / (y1 - y0)), ox = (w - (x1 - x0) * s) / 2, oy = (h - (y1 - y0) * s) / 2;
  return pts.map(function (p) { return [ox + (p[0] - x0) * s, oy + (p[1] - y0) * s]; });
}
function topo(svg, seed, cx, cy, rings, step) {
  var r = rng(seed), ph = [r() * 6, r() * 6];
  for (var k = 1; k <= rings; k++) {
    var pts = [], R = k * step;
    for (var i = 0; i <= 64; i++) {
      var t = i / 64 * Math.PI * 2, rr = R * (1 + 0.16 * Math.sin(2 * t + ph[0] + k * 0.3) + 0.08 * Math.sin(3 * t + ph[1] - k * 0.2));
      pts.push([cx + Math.cos(t) * rr * 1.2, cy + Math.sin(t) * rr]);
    }
    el('path', { class: 'topo-line', d: pathOf(pts, true) }, svg);
  }
}
/* Formas de ruta dibujadas a mano: cada salida tiene la suya, no un lazo genérico.
   Coordenadas en una caja de 1 x 1 (x a la derecha, y hacia abajo). kind:
   'loop' cerrada, 'tail' lazo con cola (sale y vuelve por la misma carretera),
   'oab' ida y vuelta (la vuelta va desplazada para que se vean los dos sentidos).
   En la app saldrán del track real: Douglas-Peucker y normalizado a la caja. */
var SHAPES = {
  montseny: { kind: 'tail', p: [[.47,1],[.46,.88],[.44,.76],[.30,.70],[.15,.58],[.10,.40],[.17,.22],[.33,.09],[.52,.04],[.69,.12],[.77,.30],[.73,.48],[.62,.60],[.51,.72],[.51,.86],[.52,1]] },
  valles: { kind: 'oab', p: [[0,.78],[.14,.70],[.30,.72],[.46,.60],[.62,.57],[.78,.43],[.92,.31],[1,.22]] },
  matadepera: { kind: 'loop', p: [[.50,.50],[.68,.30],[.88,.26],[1,.46],[.90,.70],[.70,.70],[.50,.50],[.32,.30],[.12,.30],[0,.52],[.12,.74],[.32,.70]] },
  garraf: { kind: 'loop', p: [[0,.42],[.12,.58],[.30,.62],[.45,.70],[.62,.66],[.80,.74],[1,.62],[.90,.50],[.72,.48],[.55,.40],[.36,.44],[.18,.36]] },
  estenalles: { kind: 'tail', p: [[.20,1],[.25,.84],[.30,.66],[.38,.52],[.30,.36],[.34,.18],[.50,.06],[.70,.10],[.80,.28],[.70,.44],[.52,.50],[.42,.56],[.36,.68],[.30,.84],[.25,1]] },
  santmiquel: { kind: 'loop', p: [[.10,.90],[.30,.60],[.45,.32],[.58,.06],[.70,.30],[.82,.55],[1,.86],[.70,.92],[.40,.88]] },
  recuperacion: { kind: 'oab', p: [[0,.50],[.20,.46],[.40,.53],[.60,.44],[.80,.50],[.92,.42],[1,.48]] },
  collformic: { kind: 'loop', p: [[.50,1],[.25,.90],[.08,.70],[.05,.45],[.15,.22],[.35,.08],[.48,.22],[.58,.05],[.75,.10],[.92,.30],[.95,.55],[.82,.80],[.68,.92]] },
  larga: { kind: 'loop', p: [[0,.90],[.15,.65],[.30,.45],[.50,.30],[.72,.12],[.95,0],[1,.15],[.82,.30],[.65,.50],[.42,.70],[.20,.90]] },
  llorenc: { kind: 'tail', p: [[.10,.92],[.25,.76],[.38,.62],[.30,.42],[.42,.22],[.62,.18],[.78,.32],[.72,.52],[.52,.60],[.42,.66],[.28,.80],[.15,.94]] },
  montcau: { kind: 'loop', p: [[.30,0],[.62,.04],[.86,.20],[.96,.46],[.86,.74],[.62,.90],[.38,.84],[.30,.64],[.42,.50],[.28,.36],[.12,.50],[.02,.30],[.10,.10]] },
  moia: { kind: 'loop', p: [[0,.10],[.35,.04],[.70,.08],[1,0],[.96,.40],[1,.80],[.60,.90],[.30,.86],[.04,.92],[.08,.50]] },
  montsenyc: { kind: 'loop', p: [[.50,0],[.78,.08],[.95,.30],[.90,.55],[1,.78],[.75,.95],[.48,.88],[.25,1],[.05,.80],[.08,.50],[0,.28],[.20,.08]] },
  llorencx: { kind: 'tail', p: [[.50,1],[.50,.76],[.38,.60],[.30,.40],[.40,.20],[.60,.18],[.70,.38],[.62,.60],[.53,.75],[.55,1]] }
};
function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
/* Catmull-Rom: curva suave por los puntos de control */
function catmull(p, closed, per) {
  var out = [], n = p.length, segs = closed ? n : n - 1;
  function at(i) { return closed ? p[(i + n) % n] : p[Math.max(0, Math.min(n - 1, i))]; }
  for (var i = 0; i < segs; i++) {
    var p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (var k = 0; k < per; k++) {
      var t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(function (j) {
        return 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
      }));
    }
  }
  if (!closed) out.push(p[n - 1].slice());
  return out;
}
/* Track denso: curva + pequeñas curvas de carretera, deterministas por nombre */
var denseCache = {};
function shapeDense(name) {
  if (denseCache[name]) return denseCache[name];
  var s = SHAPES[name], ph = rng(hashStr(name))() * 6;
  var base = catmull(s.p, s.kind === 'loop', 14);
  if (s.kind === 'oab') {
    var back = base.slice().reverse();
    base = base.concat(back.map(function (q, i) {
      var a = back[Math.max(0, i - 1)], b = back[Math.min(back.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      return [q[0] - dy / L * 0.035, q[1] + dx / L * 0.035];
    }));
  }
  var n = base.length;
  var pts = base.map(function (q, i) {
    var a = base[Math.max(0, i - 1)], b = base[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    var w = 0.008 * Math.sin(i * 0.32 + ph) + 0.004 * Math.sin(i * 0.9 + ph * 2) + 0.0015 * Math.sin(i * 2.3 + ph * 3);
    if (i === 0 || i === n - 1) w = 0;
    return [q[0] - dy / L * w, q[1] + dx / L * w];
  });
  return (denseCache[name] = { pts: pts, closed: s.kind === 'loop' });
}
/* Douglas-Peucker: se queda con los vértices que dan la forma */
function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  var keep = new Uint8Array(pts.length), stack = [[0, pts.length - 1]];
  keep[0] = keep[pts.length - 1] = 1;
  while (stack.length) {
    var seg = stack.pop(), a = pts[seg[0]], b = pts[seg[1]], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), best = -1, bi = 0;
    for (var i = seg[0] + 1; i < seg[1]; i++) {
      var p = pts[i], d = L ? Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / L : Math.hypot(p[0] - a[0], p[1] - a[1]);
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) { keep[bi] = 1; stack.push([seg[0], bi], [bi, seg[1]]); }
  }
  return pts.filter(function (p, i) { return keep[i]; });
}
/* Forma lista para pintar en una caja w x h: misma geometría que el mapa, simplificada */
function shapePoints(name, w, h, pad) {
  var d = shapeDense(name);
  return { pts: simplify(fit(d.pts, w, h, pad), Math.max(0.45, Math.min(w, h) / 150)), closed: d.closed };
}
function renderShape(svg) {
  var vb = svg.getAttribute('viewBox').split(' ').map(Number), w = vb[2], h = vb[3], key = svg.getAttribute('data-shape'), big = svg.hasAttribute('data-big');
  svg.textContent = '';
  // data-box="x y ancho alto" (fracciones): la forma ocupa solo esa parte, p. ej. la franja de la tarjeta IA
  var box = [0, 0, 1, 1];
  if (svg.hasAttribute('data-box')) {
    w = svg.clientWidth || w; h = svg.clientHeight || h; svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    box = svg.getAttribute('data-box').split(' ').map(Number);
  }
  var bx = box[0] * w, by = box[1] * h, bw = box[2] * w, bh = box[3] * h;
  if (big) topo(svg, hashStr(key) % 97, bx + bw * 0.62, by + bh * 0.38, 8, Math.max(w, h) / 9);
  var pad = big ? Math.min(bw, bh) * 0.14 : 5, sh = SHAPES[key] ? shapePoints(key, bw, bh, pad) : { pts: fit(loop(+key || 1, 160), bw, bh, pad), closed: true };
  sh.pts = sh.pts.map(function (q) { return [q[0] + bx, q[1] + by]; });
  var d = pathOf(sh.pts, sh.closed);
  el('path', { class: 'shape-halo', d: d }, svg);
  el('path', { class: 'shape-core', d: d }, svg);
  el('path', { class: 'shape-thread', d: d }, svg);
  el('circle', { class: 'shape-start', cx: sh.pts[0][0], cy: sh.pts[0][1], r: big ? 4 : 2.6 }, svg);
}
/* Visibilidad por fase: data-f="N" aparece a partir de la fase N */
document.querySelectorAll('[data-f]').forEach(function (n) { if (+n.getAttribute('data-f') > FASE) n.hidden = true; });
document.querySelectorAll('svg[data-shape]').forEach(renderShape);
var sideTopo = document.querySelector('[data-topo="side"]'); if (sideTopo) topo(sideTopo, 4, 112, 92, 8, 11);

/* Segmentado genérico: [data-seg] con botones y un .ind */
document.querySelectorAll('[data-seg]').forEach(function (g) {
  var btns = g.querySelectorAll('button'), ind = g.querySelector('.ind');
  g.style.setProperty('--n', btns.length);
  btns.forEach(function (b, i) {
    if (b.getAttribute('aria-pressed') === 'true' && ind) ind.style.transform = 'translateX(' + (i * 100) + '%)';
    b.addEventListener('click', function () {
      btns.forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
      if (ind) ind.style.transform = 'translateX(' + (i * 100) + '%)';
      g.dispatchEvent(new CustomEvent('segchange', { detail: b.dataset.v || b.textContent }));
    });
  });
});

/* Búsqueda local: «/» enfoca el buscador visible */
document.addEventListener('keydown', function (e) {
  if (e.key !== '/' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  var s = Array.prototype.find.call(document.querySelectorAll('input[type="search"]'), function (x) { return x.offsetParent; });
  if (s) { e.preventDefault(); s.focus(); }
});

window.FBT = {
  FASE: FASE, reduced: reduced, ic: ic, HITO: HITO, nf: nf, hm: hm, tok: tok, hexA: hexA, el: el, rng: rng, gid: gid,
  smoothstep: smoothstep, pathOf: pathOf, smoothPath: smoothPath, makeProfile: makeProfile, gradeRuns: gradeRuns,
  renderProfile: renderProfile, renderLegend: renderLegend, loop: loop, fit: fit, topo: topo, renderShape: renderShape, shapeDense: shapeDense, shapePoints: shapePoints,
  onTheme: function (f) { themeCbs.push(f); }
};
})();
