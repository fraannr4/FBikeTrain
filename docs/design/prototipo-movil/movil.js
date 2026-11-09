/* =====================================================================
   FBikeTrain: kit móvil compartido (JS mínimo, sin dependencias).
   Se carga al final de <body>, sin defer:  <script src="movil.js"></script>
   Expone window.FBT: theme, sheet, toast, icon, fmt, profile, shape.
   Todo el movimiento se apaga con prefers-reduced-motion (lo hace el CSS;
   aquí solo se acortan las esperas).
   ===================================================================== */
(function () {
'use strict';
var doc = document, root = doc.documentElement, body = doc.body;
var RM = matchMedia('(prefers-reduced-motion: reduce)');
function reduced() { return RM.matches; }
function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }

/* ---------- Iconos lucide (trazo 2, 24x24) ---------- */
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
I.back = '<path d="m15 18-6-6 6-6"/>';
I.wifioff = '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>';
I.navigation = '<polygon points="3 11 22 2 13 21 11 13 3 11"/>';
I.grid = '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>';
I.clock = '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>';
I.folder = '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>';
I.external = '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>';
I.eyeoff = '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>';
I.paste = '<path d="M11 14h10"/><path d="M16 4h2a2 2 0 0 1 2 2v1.344"/><path d="m17 18 4-4-4-4"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113"/><rect x="8" y="2" width="8" height="4" rx="1"/>';
I.mail = '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>';
I.map = '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>';

var sprite = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>' +
  Object.keys(I).map(function (k) {
    return '<symbol id="i-' + k + '" viewBox="' + (k.indexOf('bars') === 0 ? '0 0 12 12' : '0 0 24 24') + '">' + I[k] + '</symbol>';
  }).join('') +
  '<clipPath id="hito-clip"><path d="M1.5 33V13A11.5 11.5 0 0 1 24.5 13V33Z"/></clipPath></defs></svg>';
body.insertAdjacentHTML('afterbegin', sprite);

function icon(name, cls) { return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true" focusable="false"><use href="#i-' + name + '"/></svg>'; }
var HITO = '<svg class="hito-logo" viewBox="0 0 26 34" aria-hidden="true" focusable="false"><path class="body" d="M1.5 33V13A11.5 11.5 0 0 1 24.5 13V33Z"/><rect class="band" x="0" y="0" width="26" height="11" clip-path="url(#hito-clip)"/><text x="13" y="28" text-anchor="middle">F</text></svg>';

/* Atajo para el HTML: <i data-ic="bike"></i> se sustituye por el icono */
$$('i[data-ic]').forEach(function (n) {
  n.insertAdjacentHTML('beforebegin', icon(n.dataset.ic, n.className));
  n.remove();
});
$$('[data-hito]').forEach(function (n) { n.innerHTML = HITO; });

/* ---------- Formato es-ES (punto de miles desde 10.000, como pide la RAE; coma decimal; menos U+2212) ---------- */
function fmt(n, dec) {
  dec = dec || 0;
  var s = Math.abs(n).toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: 'min2' });
  return (n < 0 ? '−' : '') + s;
}

/* =====================================================================
   Tema: oscuro por defecto; ?theme=light fuerza; el conmutador recuerda.
   El script previo al pintado (en <head>) ya puso data-theme.
   ===================================================================== */
var THEME_KEY = 'fbt-theme';
function getTheme() { return root.dataset.theme === 'light' ? 'light' : 'dark'; }
function setTheme(t, persist) {
  t = t === 'light' ? 'light' : 'dark';
  root.dataset.theme = t;
  if (persist) { try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* sin almacenamiento */ } }
  var meta = doc.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim();
  syncThemeControls();
  doc.dispatchEvent(new CustomEvent('themechange', { detail: { theme: t } }));
}
function syncThemeControls() {
  var t = getTheme();
  $$('[data-theme-toggle]').forEach(function (seg) { segSelect(seg, seg.querySelector('[data-value="' + t + '"]'), false); });
  $$('[data-theme-flip]').forEach(function (b) {
    b.setAttribute('aria-label', t === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
    b.innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
  });
}

/* =====================================================================
   Navegación: barra inferior de 5 destinos (carril lateral desde 900 px).
   <nav class="tabbar" data-tabbar data-current="historial"></nav>
   data-badge="plan:2" pone un contador en una pestaña.
   ===================================================================== */
var TABS = [
  { id: 'inicio',    href: 'inicio.html',     label: 'Inicio',    ic: 'house' },
  { id: 'historial', href: 'historial.html',  label: 'Historial', ic: 'chart' },
  { id: 'rutas',     href: 'rutas.html',      label: 'Rutas',     ic: 'route' },
  { id: 'plan',      href: 'calendario.html', label: 'Plan',      ic: 'calendar' },
  { id: 'mas',       href: 'mas.html',        label: 'Más',       ic: 'more' }
];
$$('[data-tabbar]').forEach(function (nav) {
  var cur = nav.dataset.current || '';
  var badges = {};
  (nav.dataset.badge || '').split(',').forEach(function (p) { var kv = p.split(':'); if (kv[1]) badges[kv[0].trim()] = kv[1].trim(); });
  nav.setAttribute('aria-label', nav.getAttribute('aria-label') || 'Principal');
  nav.innerHTML = '<a class="rail-brand" href="index.html" aria-label="FBikeTrain, galería">' + HITO + '</a>' +
    TABS.map(function (t) {
      var b = badges[t.id];
      return '<a class="tab" href="' + t.href + '"' + (t.id === cur ? ' aria-current="page"' : '') + '>' +
        '<span class="tab-ic">' + icon(t.ic) + (b ? '<span class="tab-badge" aria-hidden="true">' + b + '</span>' : '') + '</span>' +
        '<span>' + t.label + '</span>' + (b ? '<span class="sr-only">, ' + b + ' pendientes</span>' : '') +
        '</a>';
    }).join('');
});

/* =====================================================================
   Cabecera: cuando el título grande pasa bajo la barra, aparece el
   título pequeño y la barra se vuelve de vidrio. (El encogido del título
   grande es CSS puro: animation-timeline: scroll().)
   ===================================================================== */
var appbar = doc.querySelector('.appbar');
var bigTitle = doc.querySelector('.page-title');
if (appbar) {
  if (bigTitle && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { appbar.toggleAttribute('data-scrolled', !e.isIntersecting && e.boundingClientRect.top < 80); });
    }, { rootMargin: '-' + Math.round(appbar.offsetHeight) + 'px 0px 0px 0px', threshold: 0 });
    io.observe(bigTitle);
  } else {
    var onScroll = function () { appbar.toggleAttribute('data-scrolled', scrollY > 8); };
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
  }
}

/* ---------- Acción principal: se aparta al bajar, vuelve al subir ---------- */
var fab = doc.querySelector('body > .fab');
if (fab) {
  var lastY = scrollY, ticking = false;
  addEventListener('scroll', function () {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      var y = scrollY, dy = y - lastY;
      if (Math.abs(dy) > 6) {
        var away = dy > 0 && y > 120 && innerWidth < 900;   // en escritorio no estorba
        fab.toggleAttribute('data-away', away);
        lastY = y;
      }
      ticking = false;
    });
  }, { passive: true });
  fab.addEventListener('focus', function () { fab.removeAttribute('data-away'); });  // con teclado, siempre visible
}

/* =====================================================================
   Segmentados: .seg con botones. Dos sabores:
   - role="tablist" + role="tab" (aria-selected, aria-controls): cambia de vista.
   - role="group" + aria-pressed: elige un valor (filtro, tema, rango).
   Lanza 'segchange' con { value, index }. Flechas izquierda/derecha.
   - <nav class="seg"> con enlaces <a aria-current="page">: vistas que son
     páginas distintas (Historial: Salidas, Subidas, Repetidas). Solo se
     desliza el indicador; el enlace navega. Sin flechas: se recorre con Tab.
   ===================================================================== */
function segButtons(seg) { return $$(':scope > button, :scope > a', seg); }
function segSelect(seg, btn, emit) {
  if (!seg || !btn) return;
  var bs = segButtons(seg), i = bs.indexOf(btn), tabs = seg.getAttribute('role') === 'tablist', links = btn.tagName === 'A';
  bs.forEach(function (b, j) {
    if (links) return;   // los enlaces llevan aria-current en el HTML: no se toca
    if (tabs) {
      b.setAttribute('aria-selected', j === i ? 'true' : 'false');
      b.tabIndex = j === i ? 0 : -1;
      var p = b.getAttribute('aria-controls') && doc.getElementById(b.getAttribute('aria-controls'));
      if (p) p.hidden = j !== i;
    } else {
      b.setAttribute('aria-pressed', j === i ? 'true' : 'false');
    }
  });
  var ind = seg.querySelector('.seg-ind');
  if (ind) ind.style.transform = 'translateX(' + (i * 100) + '%)';
  if (emit && !links) seg.dispatchEvent(new CustomEvent('segchange', { bubbles: true, detail: { value: btn.dataset.value, index: i } }));
}
$$('.seg').forEach(function (seg) {
  var bs = segButtons(seg);
  seg.style.setProperty('--n', bs.length);
  if (!seg.querySelector('.seg-ind')) seg.insertAdjacentHTML('afterbegin', '<span class="seg-ind" aria-hidden="true"></span>');
  var ind = seg.querySelector('.seg-ind');
  var on = bs.filter(function (b) { return b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-selected') === 'true' || b.getAttribute('aria-current') === 'page'; })[0] || bs[0];
  ind.style.transition = 'none';           // primera colocación sin deslizar
  segSelect(seg, on, false);
  ind.offsetWidth; ind.style.transition = '';
  seg.addEventListener('click', function (e) {
    var b = e.target.closest('button, a'); if (!b || b.parentNode !== seg) return;
    segSelect(seg, b, true);
  });
  seg.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (doc.activeElement && doc.activeElement.tagName === 'A') return;
    var list = segButtons(seg), i = list.indexOf(doc.activeElement); if (i < 0) return;
    var n = list[(i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length];
    n.focus(); segSelect(seg, n, true); e.preventDefault();
  });
});
doc.addEventListener('segchange', function (e) {
  if (e.target.hasAttribute('data-theme-toggle')) setTheme(e.detail.value, true);
});

/* ---------- Chips de filtro, interruptores y tema rápido ---------- */
doc.addEventListener('click', function (e) {
  var t = e.target;
  var chip = t.closest('.fchip');
  if (chip) {
    var group = chip.closest('[data-single]');
    if (group) $$('.fchip', group).forEach(function (c) { c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
    else chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    chip.dispatchEvent(new CustomEvent('chipchange', { bubbles: true, detail: { value: chip.dataset.value, on: chip.getAttribute('aria-pressed') === 'true' } }));
    return;
  }
  var sw = t.closest('[role="switch"]');
  if (sw) { sw.setAttribute('aria-checked', sw.getAttribute('aria-checked') === 'true' ? 'false' : 'true'); return; }
  if (t.closest('[data-theme-flip]')) { setTheme(getTheme() === 'dark' ? 'light' : 'dark', true); return; }
  var opener = t.closest('[data-sheet-open]');
  if (opener) { e.preventDefault(); openSheet(opener.dataset.sheetOpen, opener); return; }
  var closer = t.closest('[data-sheet-close]');
  if (closer) closeSheet(closer.closest('dialog.sheet'));   // sigue: puede llevar además data-toast
  var tb = t.closest('[data-toast]');
  if (tb) toast(tb.dataset.toast, { tone: tb.dataset.tone, action: tb.dataset.action ? { label: tb.dataset.action } : null });
});

/* =====================================================================
   Hojas inferiores
   <button data-sheet-open="hoja-filtros">Filtros</button>
   <dialog class="sheet" id="hoja-filtros" aria-labelledby="hoja-filtros-t">
     <div class="sheet-grab"><span class="sheet-handle"></span>
       <div class="sheet-h"><h2 class="sheet-title" id="hoja-filtros-t">Filtros</h2>
         <button class="icon-btn" data-sheet-close aria-label="Cerrar">…</button></div></div>
     <div class="sheet-body">…</div>
     <div class="sheet-foot">…</div>
   </dialog>
   Se cierra con: el botón, Escape, un toque en el fondo, o arrastrando
   el asa hacia abajo (distancia o velocidad). FBT.sheet.open(id) / close(id).
   ===================================================================== */
var lastTrigger = null;
var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function openSheet(id, trigger) {
  var d = typeof id === 'string' ? doc.getElementById(id) : id;
  if (!d || d.open) return;
  lastTrigger = trigger || doc.activeElement;
  d.classList.remove('is-open'); d.style.transform = '';
  d.showModal();
  root.style.overflow = 'hidden';            // la página de detrás no se desplaza
  d.offsetHeight;                             // fija el estado inicial antes de la transición
  requestAnimationFrame(function () { d.classList.add('is-open'); });
  var first = d.querySelector('[autofocus]') || d.querySelector('.sheet-title');
  if (first && first.classList.contains('sheet-title')) { first.tabIndex = -1; }
  if (first) first.focus({ preventScroll: true });
}
function closeSheet(d) {
  d = typeof d === 'string' ? doc.getElementById(d) : d;
  if (!d || !d.open || d.dataset.closing) return;
  d.dataset.closing = '1';
  d.classList.remove('is-open', 'is-dragging');
  d.style.transform = '';
  var finished = false;
  function done() {
    if (finished) return; finished = true;
    d.close(); delete d.dataset.closing;
    root.style.overflow = '';
    if (lastTrigger && lastTrigger.focus) lastTrigger.focus({ preventScroll: true });
    d.dispatchEvent(new CustomEvent('sheetclose', { bubbles: true }));
  }
  d.addEventListener('transitionend', function te(e) { if (e.target === d) { d.removeEventListener('transitionend', te); done(); } });
  setTimeout(done, reduced() ? 180 : 260);
}

$$('dialog.sheet').forEach(function (d) {
  var id = d.id;
  $$('[data-sheet-open="' + id + '"]').forEach(function (b) { b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-controls', id); });

  d.addEventListener('cancel', function (e) { e.preventDefault(); closeSheet(d); });   // Escape
  d.addEventListener('click', function (e) {                                           // toque en el fondo
    if (e.target !== d) return;
    var r = d.getBoundingClientRect();
    if (e.clientY < r.top || e.clientX < r.left || e.clientX > r.right) closeSheet(d);
  });
  d.addEventListener('keydown', function (e) {                                         // foco atrapado
    if (e.key !== 'Tab') return;
    var f = $$(FOCUSABLE, d).filter(function (n) { return n.offsetParent !== null; });
    if (!f.length) return;
    var a = f[0], z = f[f.length - 1];
    if (e.shiftKey && (doc.activeElement === a || !d.contains(doc.activeElement))) { z.focus(); e.preventDefault(); }
    else if (!e.shiftKey && doc.activeElement === z) { a.focus(); e.preventDefault(); }
  });

  /* Arrastre desde el asa y la cabecera (touch-action: none) */
  var grab = d.querySelector('.sheet-grab');
  if (!grab) return;
  var drag = null;
  grab.addEventListener('pointerdown', function (e) {
    if (drag || e.button > 0 || e.target.closest('button, a, input')) return;  // un solo dedo; los botones siguen siendo botones
    drag = { id: e.pointerId, y0: e.clientY, t0: performance.now(), dy: 0 };
    grab.setPointerCapture(e.pointerId);
    d.classList.add('is-dragging');
  });
  grab.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dy = e.clientY - drag.y0;
    drag.dy = dy;
    var y = dy >= 0 ? dy : -Math.sqrt(-dy) * 2.2;   // hacia arriba: fricción, no un muro
    d.style.transform = 'translateY(' + y + 'px)';
  });
  function end(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dt = Math.max(1, performance.now() - drag.t0), v = drag.dy / dt; // px/ms
    var shouldClose = drag.dy > d.offsetHeight * 0.32 || (drag.dy > 24 && v > 0.45);
    drag = null;
    d.classList.remove('is-dragging');
    if (shouldClose) closeSheet(d); else d.style.transform = '';
  }
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
});

/* =====================================================================
   Avisos (toasts): FBT.toast('Ruta guardada', { tone: 'good', action: { label: 'Deshacer', onClick } })
   tone: info (por defecto) | good | warn | error. Duran 4 s (6 s con acción),
   se pausan si la pestaña se oculta o si se tienen pulsados. Máximo 3.
   ===================================================================== */
var TONE_IC = { info: 'info', good: 'checkc', warn: 'warn', error: 'alert' };
function region() {
  var r = doc.querySelector('.toasts');
  if (!r) { r = doc.createElement('div'); r.className = 'toasts'; body.appendChild(r); }
  r.setAttribute('role', 'status'); r.setAttribute('aria-live', 'polite');
  return r;
}
function toast(text, o) {
  o = o || {};
  var tone = TONE_IC[o.tone] ? o.tone : 'info';
  var r = region();
  var el = doc.createElement('div');
  el.className = 'toast'; el.dataset.tone = tone; el.dataset.state = 'enter';
  el.innerHTML = icon(TONE_IC[tone]) + '<span class="toast-text"></span>';
  el.querySelector('.toast-text').textContent = text;
  if (o.action) {
    var b = doc.createElement('button');
    b.type = 'button'; b.className = 'btn btn--ghost'; b.textContent = o.action.label;
    b.addEventListener('click', function () { if (o.action.onClick) o.action.onClick(); dismiss(); });
    el.appendChild(b);
  }
  r.appendChild(el);
  var all = $$('.toast:not([data-state="exit"])', r);
  if (all.length > 3) all.slice(0, all.length - 3).forEach(function (t) { t._dismiss && t._dismiss(); });
  requestAnimationFrame(function () { requestAnimationFrame(function () { el.removeAttribute('data-state'); }); });

  var left = o.duration || (o.action ? 6000 : 4000), started = Date.now(), timer = null;
  function run() { started = Date.now(); timer = setTimeout(dismiss, left); }
  function pause() { if (timer) { clearTimeout(timer); timer = null; left -= Date.now() - started; } }
  function dismiss() {
    if (el.dataset.state === 'exit') return;
    pause(); doc.removeEventListener('visibilitychange', vis);
    el.dataset.state = 'exit';
    setTimeout(function () { el.remove(); }, reduced() ? 0 : 180);
  }
  function vis() { if (doc.hidden) pause(); else if (!timer) run(); }
  el._dismiss = dismiss;
  el.addEventListener('pointerdown', pause);
  el.addEventListener('pointerup', function () { if (!timer) run(); });
  doc.addEventListener('visibilitychange', vis);
  run();
  return dismiss;
}

/* =====================================================================
   Gráficas en SVG
   FBT.profile(svg, alturas[], km)  perfil coloreado por pendiente.
     Devuelve las clases presentes (para pintar solo esas en la leyenda).
   FBT.shape(svg, puntos[[x,y]])    forma de ruta luminosa sobre curvas de nivel.
   Atajos declarativos: <svg class="profile" data-seed="4" data-km="87.6">,
   <svg class="shape" data-seed="4">: generan datos sintéticos para el prototipo.
   ===================================================================== */
var NS = 'http://www.w3.org/2000/svg';
function gradeClass(g) { g = Math.abs(g) < 1 || g < 0 ? 0 : g; return g < 1 ? 0 : g < 4 ? 1 : g < 7 ? 2 : g < 10 ? 3 : g < 16 ? 4 : 5; }
function profile(svg, el, km) {
  var W = 320, H = 72, n = el.length, max = Math.max.apply(null, el), min = Math.min.apply(null, el);
  var lo = min - (max - min) * 0.12, span = (max - lo) || 1;
  var X = function (i) { return (i / (n - 1)) * W; }, Y = function (v) { return H - ((v - lo) / span) * (H - 4); };
  var stepM = (km * 1000) / (n - 1), present = {}, out = '', i = 0;
  while (i < n - 1) {
    var c = gradeClass(((el[i + 1] - el[i]) / stepM) * 100), j = i;
    while (j < n - 1 && gradeClass(((el[j + 1] - el[j]) / stepM) * 100) === c) j++;
    var pts = [];
    for (var k = i; k <= j; k++) pts.push(X(k).toFixed(1) + ',' + Y(el[k]).toFixed(1));
    out += '<polygon class="g' + c + '" points="' + X(i).toFixed(1) + ',' + H + ' ' + pts.join(' ') + ' ' + X(j).toFixed(1) + ',' + H + '"/>';
    present[c] = 1; i = j;
  }
  var edge = el.map(function (v, k) { return (k ? 'L' : 'M') + X(k).toFixed(1) + ' ' + Y(v).toFixed(1); }).join('');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.innerHTML = out + '<path class="edge" vector-effect="non-scaling-stroke" d="' + edge + '"/>';
  return Object.keys(present).map(Number).sort();
}
function shape(svg, pts) {
  var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
  var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
  var s = 76 / Math.max(x1 - x0, y1 - y0, 1), ox = 50 - ((x0 + x1) / 2) * s, oy = 50 - ((y0 + y1) / 2) * s;
  var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + (p[0] * s + ox).toFixed(1) + ' ' + (p[1] * s + oy).toFixed(1); }).join('');
  var st = pts[0];
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.innerHTML = '<g class="contours">' + [18, 30, 42, 56].map(function (r, i) {
      return '<ellipse class="contour" cx="' + (62 - i * 3) + '" cy="' + (40 + i * 2) + '" rx="' + r * 1.15 + '" ry="' + r * 0.8 + '"/>';
    }).join('') + '</g>' +
    '<path class="halo" d="' + d + '"/><path class="core" d="' + d + '"/><path class="thread" d="' + d + '"/>' +
    '<circle class="start" r="4.2" cx="' + (st[0] * s + ox).toFixed(1) + '" cy="' + (st[1] * s + oy).toFixed(1) + '"/>';
}
/* Datos sintéticos estables por semilla (solo para el prototipo) */
function rnd(seed) { var s = seed * 9301 + 49297; return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
function synthLoop(seed, n) {
  var r = rnd(seed), a = [r() * 6, r() * 6, r() * 6], pts = [];
  n = n || 90;
  for (var i = 0; i < n; i++) {
    var t = (i / n) * Math.PI * 2;
    var rad = 1 + 0.28 * Math.sin(2 * t + a[0]) + 0.14 * Math.sin(3 * t + a[1]) + 0.08 * Math.sin(5 * t + a[2]);
    pts.push([Math.cos(t) * rad * (1.2 + r() * 0.02), Math.sin(t) * rad * 0.9]);
  }
  pts.push(pts[0]);
  return pts;
}
function synthProfile(seed, n, base, top) {
  // Llano de aproximación, un puerto principal y otro secundario (campanas
  // gaussianas: dan rampas del 6 al 10 % en 80-90 km) y un poco de ruido.
  var r = rnd(seed), out = [], c1 = 0.3 + r() * 0.12, c2 = 0.66 + r() * 0.1, ph = r() * 6;
  n = n || 120; base = base || 320; top = top || 980;
  for (var i = 0; i < n; i++) {
    var t = i / (n - 1);
    out.push(Math.exp(-Math.pow((t - c1) / 0.075, 2)) + 0.42 * Math.exp(-Math.pow((t - c2) / 0.05, 2)) + 0.04 * Math.sin(23 * t + ph));
  }
  var mx = Math.max.apply(null, out), mn = Math.min.apply(null, out);
  return out.map(function (v) { return base + ((v - mn) / (mx - mn)) * (top - base); });
}
$$('svg.profile[data-seed]').forEach(function (s) {
  var classes = profile(s, synthProfile(+s.dataset.seed, 120, +(s.dataset.min || 320), +(s.dataset.max || 980)), +(s.dataset.km || 80));
  var lg = s.dataset.legend && doc.getElementById(s.dataset.legend);
  var NAMES = ['Llano o bajada', '1-4 %', '4-7 %', '7-10 %', '10-16 %', '16 % o más'];
  if (lg) lg.innerHTML = classes.map(function (c) { return '<span><i style="background:var(--g' + c + ')"></i>' + NAMES[c] + '</span>'; }).join('');
});
$$('svg.shape[data-seed]').forEach(function (s) { shape(s, synthLoop(+s.dataset.seed)); });

/* =====================================================================
   Tiempos, perfil de puerto y evolución de pasadas (Subidas y Repetidas)
   FBT.dur(seg, 'clock' | 'hm')   24:18 · 1:02:15  |  1 h 21 · 48 min
   FBT.climb(svg, { grades: [% por km], km, start })
     Perfil de puerto como en el libro de ruta: un bloque por kilómetro,
     coloreado por su pendiente (g0-g5) y con la cifra encima.
   FBT.passes(wrap, { items: [{ t, s, sub }], dur: 'clock'|'hm', label })
     Una pasada por punto, en orden. Eje invertido: arriba, más rápido.
     La mejor en --good; la discontinua es tu media. Deslizar el dedo
     cambia la lectura de arriba (.passes-read). La tabla equivalente es
     la lista de pasadas que va debajo.
   Las dos se vuelven a pintar al cambiar de ancho (ResizeObserver).
   ===================================================================== */
function dur(sec, mode) {
  sec = Math.round(sec);
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (mode === 'hm') { if (s >= 30) { m++; if (m === 60) { h++; m = 0; } } return h ? h + ' h ' + (m < 10 ? '0' : '') + m : m + ' min'; }
  return h ? h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s : m + ':' + (s < 10 ? '0' : '') + s;
}
function f1(n) { return (Math.round(n * 10) / 10).toString(); }
var redraw = 'ResizeObserver' in window ? new ResizeObserver(function (es) {
  es.forEach(function (e) { var t = e.target; if (t._draw && Math.abs(e.contentRect.width - (t._w || 0)) > 1) t._draw(); });
}) : null;
function keepDrawn(el, fn) { el._draw = fn; fn(); if (redraw && !el._watched) { el._watched = true; redraw.observe(el); } }

function climb(svg, o) {
  keepDrawn(svg, function () {
    var W = Math.round(svg.getBoundingClientRect().width) || 320, H = o.height || Math.round(svg.getBoundingClientRect().height) || 140;
    svg._w = W;
    var g = o.grades, L = o.km, n = g.length, padT = 26, padB = 24, i;
    var ele = [o.start];
    for (i = 0; i < n; i++) ele.push(ele[i] + g[i] * 10 * Math.min(1, L - i));
    var top = Math.max.apply(null, ele), lo = o.start - (top - o.start) * 0.3, span = (top - lo) || 1;
    var X = function (km) { return (km / L) * (W - 2) + 1; };
    var Y = function (e) { return padT + (1 - (e - lo) / span) * (H - padT - padB); };
    var base = H - padB, blocks = '', cuts = '', labels = '', ticks = '';
    var steep = g.indexOf(Math.max.apply(null, g)), bw = X(1) - X(0);
    for (i = 0; i < n; i++) {
      var x0 = X(i), x1 = X(Math.min(i + 1, L)), ya = Y(ele[i]), yb = Y(ele[i + 1]);
      blocks += '<polygon class="g' + gradeClass(g[i]) + '" points="' + f1(x0) + ',' + base + ' ' + f1(x0) + ',' + f1(ya) + ' ' + f1(x1) + ',' + f1(yb) + ' ' + f1(x1) + ',' + base + '"/>';
      if (i && x1 - x0 >= 8) cuts += '<line x1="' + f1(x0) + '" x2="' + f1(x0) + '" y1="' + f1(ya) + '" y2="' + base + '"/>';  // sin corte ante una astilla final
      if (x1 - x0 >= 26 || i === steep) {
        var lx = Math.min(Math.max((x0 + x1) / 2, 12), W - 12);
        labels += '<text class="' + (i === steep ? 'gl gl--max' : 'gl') + '" x="' + f1(lx) + '" y="' + f1(Math.min(ya, yb) - 8) + '" text-anchor="middle">' + fmt(g[i], 1) + '</text>';
      }
    }
    var every = bw >= 30 ? 1 : bw >= 15 ? 2 : 5;
    for (var k = 0; k < L; k += every) {
      if (X(L) - X(k) < 56) continue;   // que la última marca no se pegue a «7,6 km»
      ticks += '<text x="' + f1(k ? X(k) : 0) + '" y="' + (H - 6) + '" text-anchor="' + (k ? 'middle' : 'start') + '">' + k + '</text>';
    }
    ticks += '<text x="' + W + '" y="' + (H - 6) + '" text-anchor="end">' + fmt(L, 1) + ' km</text>';
    var edge = ele.map(function (e, j) { return (j ? 'L' : 'M') + f1(X(Math.min(j, L))) + ' ' + f1(Y(e)); }).join('');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = '<g class="blocks">' + blocks + '</g><g class="cuts">' + cuts + '</g>' +
      '<path class="edge" d="' + edge + '"/><line class="base" x1="0" x2="' + W + '" y1="' + base + '" y2="' + base + '"/>' +
      '<g class="labels">' + labels + '</g><g class="ticks">' + ticks + '</g>';
  });
}

function passes(wrap, o) {
  var svg = wrap.querySelector('svg'), read = wrap.querySelector('.passes-read');
  var src = o.items, mode = o.dur || 'clock', noun = o.noun || 'pasada', MAX = 30;
  var Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
  /* La cifra se escribe igual en la lectura, el eje y el resto de la hoja: «1 h 22» con la h pequeña */
  function figHtml(s) { var t = dur(s, mode); return mode === 'hm' ? t.replace(/^(\d+) h (\d+)$/, '$1<span class="u">h</span>$2').replace(' min', '<span class="u">min</span>') : t; }
  function tick(s) { var t = dur(s, mode); return mode === 'hm' ? t.replace(/^(\d+) h (\d+)$/, '$1<tspan class="u">h</tspan>$2').replace(' min', '<tspan class="u">min</tspan>') : t; }
  function when(t) { return new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', ''); }
  var MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  function mk(t) { var d = new Date(t); return d.getFullYear() * 12 + d.getMonth(); }
  /* «Todas»: una marca por mes, con el mejor tiempo del mes */
  function byMonth(a) {
    var out = [];
    a.forEach(function (p) {
      var k = mk(p.t), m = out[out.length - 1];
      if (!m || m.k !== k) out.push(m = { k: k, t: p.t, s: p.s, sub: p.sub, count: 0 });
      m.count++;
      if (p.s < m.s) { m.s = p.s; m.sub = p.sub; }
    });
    return out;
  }
  var it, n, best, monthly, offset, sel, X, Y, Xk;
  /* Marca personal de todas: con «Últimas 30» puede quedar fuera y se dibuja como referencia */
  var allBest = src.reduce(function (a, p) { return p.s < a ? p.s : a; }, Infinity);

  /* Con más de 30, se ven las últimas 30 y un selector «Últimas 30 / Todas, por meses» */
  var ctl = wrap.querySelector('.passes-mode');
  if (src.length > MAX) {
    if (!ctl) {
      ctl = doc.createElement('div'); ctl.className = 'passes-mode cluster';
      ctl.setAttribute('role', 'group'); ctl.setAttribute('data-single', '');
      wrap.insertBefore(ctl, wrap.firstChild);
      ctl.addEventListener('chipchange', function (e) { if (e.detail.on && wrap._setView) wrap._setView(e.detail.value); });
    }
    ctl.setAttribute('aria-label', 'Qué ' + noun + 's ver');
    ctl.innerHTML = [['last', 'Últimas ' + MAX], ['all', 'Todas, por meses']].map(function (v, j) {
      return '<button class="fchip" type="button" data-value="' + v[0] + '" aria-pressed="' + (j === 0) + '"><span>' + icon('check', 'ic-check') + v[1] + '</span></button>';
    }).join('');
    ctl.hidden = false;
  } else if (ctl) ctl.hidden = true;

  function setView(v) {
    monthly = v === 'all' && src.length > MAX;
    it = monthly ? byMonth(src) : src.slice(-MAX);
    n = it.length; offset = monthly ? 0 : src.length - n;
    best = 0; it.forEach(function (p, j) { if (p.s < it[best].s) best = j; });
    sel = typeof wrap._sel === 'number' && wrap._sel < n && !monthly ? wrap._sel : n - 1;
    var mean = it.reduce(function (a, p) { return a + p.s; }, 0) / n, me = wrap.querySelector('[data-mean]');
    var part = !monthly && offset > 0;   // solo una parte: la leyenda no puede decir «Tu mejor» ni «Tu media»
    if (me) me.innerHTML = (monthly ? 'Media de los meses, ' : part ? 'Media de estas ' + n + ', ' : 'Tu media, ') + figHtml(mean);
    var kb = wrap.querySelector('.passes-key .k-best');
    if (kb) kb.parentNode.innerHTML = kb.outerHTML + (part ? 'Mejor de estas ' + n : monthly ? 'Tu mejor mes' : 'Tu mejor');
    wrap._mean = mean;
  }
  function show(i) {
    sel = wrap._sel = i;
    var c = svg.querySelector('.sel'), gl = svg.querySelector('.guide');
    if (c) { c.setAttribute('cx', f1(X(i))); c.setAttribute('cy', f1(Y(it[i].s))); }
    if (gl) { gl.setAttribute('x1', f1(X(i))); gl.setAttribute('x2', f1(X(i))); }
    if (!read) return;
    var p = it[i], head, cap;
    if (monthly) {
      head = MES[p.k % 12] + ' de ' + Math.floor(p.k / 12);
      cap = (i === best ? 'Tu mejor mes. ' : '') + (p.count === 1 ? 'Una ' + noun + ' en el mes' : 'La mejor de ' + p.count + ' ' + noun + 's del mes');
    } else {
      head = p.when || when(p.t);
      cap = i === best && n === src.length ? 'Tu mejor ' + noun : i === best ? 'Tu mejor de estas ' + n : i === n - 1 ? 'Tu última ' + noun : Noun + ' ' + (offset + i + 1) + ' de ' + src.length;
    }
    read.innerHTML = '<span class="pr-when"><b>' + head + '</b><span>' + cap + '</span></span>' +
      '<span class="pr-val"><span class="fig' + (i === best ? ' is-best' : '') + '">' + figHtml(p.s) + '</span><span>' + (p.sub || '') + '</span></span>';
  }
  function draw() {
    var W = Math.round(svg.getBoundingClientRect().width) || 320, H = o.height || Math.round(svg.getBoundingClientRect().height) || 176;
    svg._w = W;
    var padL = 10, padR = 50, padT = 14, padB = 30, plotW = W - padL - padR - 16;
    var ss = it.map(function (p) { return p.s; }), mn = Math.min.apply(null, ss), mx = Math.max.apply(null, ss);
    var range = Math.max(mx - mn, mode === 'hm' ? 300 : 30);
    var step = [10, 15, 30, 60, 120, 180, 300, 600, 900, 1200, 1800, 3600].filter(function (c) { return range / c <= 2.2; })[0] || 3600;
    var lo = Math.floor((mn - range * 0.12) / step) * step, hi = Math.ceil((mx + range * 0.12) / step) * step;
    /* La marca personal, si no está entre las 30 que se ven; si cae fuera de la escala, en una franja arriba */
    var hasRef = !monthly && offset > 0 && allBest < it[best].s, refOut = hasRef && allBest < lo;
    if (refOut) padT += 18;
    /* Eje X: por meses, proporcional a la fecha; en las últimas 30, por orden de pasada (sin años: fingirían una escala de tiempo) */
    var k0 = monthly ? it[0].k : 0, kspan = monthly ? Math.max(1, it[n - 1].k - k0) : 1;
    Xk = function (k) { return padL + 8 + (k - k0) / kspan * plotW; };
    X = monthly ? function (i) { return Xk(it[i].k); } : function (i) { return n === 1 ? (padL + (W - padR)) / 2 : padL + 8 + i * plotW / (n - 1); };
    Y = function (s) { return padT + ((s - lo) / (hi - lo)) * (H - padT - padB); };
    var grid = '', xl = '';
    for (var v = lo; v <= hi + 0.1; v += step) {
      grid += '<line x1="' + padL + '" x2="' + (W - padR + 6) + '" y1="' + f1(Y(v)) + '" y2="' + f1(Y(v)) + '"/>' +
        '<text x="' + W + '" y="' + f1(Y(v) + 4) + '" text-anchor="end">' + tick(v) + '</text>';
    }
    if (monthly) {
      var y0 = Math.floor(k0 / 12), y1 = Math.floor(it[n - 1].k / 12), lastX = -99;
      for (var yr = y0; yr <= y1; yr++) {
        var x = Xk(Math.max(k0, yr * 12));
        if (x - lastX >= 44 && x <= W - padR - 10) { xl += '<text x="' + f1(Math.max(x, padL)) + '" y="' + (H - 8) + '" text-anchor="start">' + yr + '</text>'; lastX = x; }
      }
    } else if (n > 1) {
      xl = '<text x="' + f1(X(0) - 4) + '" y="' + (H - 8) + '" text-anchor="start">' + (offset + 1) + '.ª</text>' +
        '<text x="' + f1(X(n - 1) + 4) + '" y="' + (H - 8) + '" text-anchor="end">' + (offset + n) + '.ª ' + noun + '</text>';
    }
    var d = it.map(function (p, j) { return (j ? 'L' : 'M') + f1(X(j)) + ' ' + f1(Y(p.s)); }).join('');
    /* Con más de 60 marcas (años por meses) los puntos se solapan: solo la línea, el mejor y el último */
    var r = n > 16 ? 2.6 : 4, many = n > 60;
    var dots = it.map(function (p, j) {
      var key = j === best || j === n - 1;
      if (many && !key) return '';
      var cls = j === best ? 'dot dot--best' : j === n - 1 ? 'dot dot--last' : 'dot';
      return '<circle class="' + cls + '" r="' + (key ? 5.5 : r) + '" cx="' + f1(X(j)) + '" cy="' + f1(Y(p.s)) + '"/>';
    }).join('');
    var ref = '';
    if (hasRef) {
      var ry = refOut ? padT - 12 : Y(allBest);
      ref = '<line class="ref" x1="' + padL + '" x2="' + (W - padR + 6) + '" y1="' + f1(ry) + '" y2="' + f1(ry) + '"/>' +
        '<text class="ref-t" x="' + padL + '" y="' + f1(ry - 5) + '">' + (refOut ? '↑ ' : '') + 'Tu mejor, ' + tick(allBest) + '</text>';
    }
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = '<g class="grid">' + grid + '</g>' +
      '<line class="mean" x1="' + padL + '" x2="' + (W - padR + 6) + '" y1="' + f1(Y(wrap._mean)) + '" y2="' + f1(Y(wrap._mean)) + '"/>' +
      ref + '<line class="guide" y1="' + padT + '" y2="' + (H - padB + 4) + '"/>' +
      (n > 1 ? '<path class="halo" d="' + d + '"/><path class="line" d="' + d + '"/>' : '') + dots +
      '<circle class="sel" r="9"/><g class="xl">' + xl + '</g>';
    show(sel);
  }
  wrap._setView = function (v) { wrap._sel = undefined; setView(v); draw(); };
  setView('last');
  keepDrawn(svg, draw);

  /* Gestos y teclado se registran una vez; lo que eligen se renueva en cada llamada (otra subida, otra ruta) */
  svg.setAttribute('tabindex', '0');
  svg._pick = function (e) {
    var b = svg.getBoundingClientRect(), x = e.clientX - b.left, k = 0, dmin = Infinity;
    for (var j = 0; j < n; j++) { var dx = Math.abs(X(j) - x); if (dx < dmin) { dmin = dx; k = j; } }
    if (k !== sel) show(k);
  };
  svg._key = function (e) {
    var k = { ArrowLeft: sel - 1, ArrowRight: sel + 1, Home: 0, End: n - 1 }[e.key];
    if (k === undefined) return;
    e.preventDefault();
    if (read) read.setAttribute('aria-live', 'polite');   // con teclado se anuncia; al deslizar el dedo, no
    show(Math.max(0, Math.min(n - 1, k)));
  };
  if (!svg._scrub) {
    svg._scrub = true;
    svg.addEventListener('pointerdown', function (e) { if (read) read.setAttribute('aria-live', 'off'); svg._pick(e); });
    svg.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse' || e.pressure > 0) svg._pick(e); });
    svg.addEventListener('keydown', function (e) { svg._key(e); });
  }
}

/* ---------- Fila de chips con desbordamiento: data-more mientras quede algo a la derecha ---------- */
function chipsMore(ctx) {
  $$('.chips-scroll', ctx).forEach(function (c) {
    if (c.scrollWidth - c.clientWidth - c.scrollLeft > 4) c.setAttribute('data-more', ''); else c.removeAttribute('data-more');
  });
}
window.addEventListener('load', function () { chipsMore(); });
window.addEventListener('resize', function () { chipsMore(); });
doc.addEventListener('scroll', function (e) { if (e.target.classList && e.target.classList.contains('chips-scroll')) chipsMore(e.target.parentNode); }, true);

/* ---------- Arranque ---------- */
syncThemeControls();
var meta = doc.querySelector('meta[name="theme-color"]');
if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim();

window.FBT = {
  theme: { get: getTheme, set: setTheme },
  sheet: { open: openSheet, close: closeSheet },
  toast: toast, icon: icon, fmt: fmt,
  profile: profile, shape: shape, synth: { loop: synthLoop, profile: synthProfile },
  dur: dur, climb: climb, passes: passes, chipsMore: chipsMore,
  reduced: reduced
};
})();

/* =====================================================================
   Ampliación del kit: stepper y carrusel (se apoyan en window.FBT).
   ===================================================================== */
(function () {
'use strict';
var FBT = window.FBT, doc = document;
function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }

/* ---------- Stepper: pulsar suma un paso; mantener pulsado repite y acelera ---------- */
function stepper(st) {
  if (st._stepper) return st._stepper;
  var min = +st.dataset.min || 0, max = +(st.dataset.max || 1e9), step = +st.dataset.step || 1;
  var fig = st.querySelector('.stepper-v .fig'), btns = $$('.stepper-btn', st), timer = null, n = 0;
  /* Al mantener pulsado el valor cambia cada 55-90 ms: el lector de pantalla no debe leer cada cifra
     intermedia. La salida visible no anuncia nada; el valor final se anuncia una vez, al soltar. */
  var out = st.querySelector('.stepper-v'), live = doc.createElement('span');
  if (out) out.removeAttribute('aria-live');
  live.className = 'sr-only'; live.setAttribute('aria-live', 'polite'); st.appendChild(live);
  function announce() { live.textContent = out ? out.textContent.replace(/\s+/g, ' ').trim() : FBT.fmt(+st.dataset.value); }
  function set(v, emit) {
    v = Math.max(min, Math.min(max, Math.round(v / step) * step));
    var changed = v !== +st.dataset.value;
    st.dataset.value = v;
    if (fig) fig.textContent = FBT.fmt(v);
    btns.forEach(function (b) { var d = +b.dataset.dir; b.setAttribute('aria-disabled', (d < 0 ? v <= min : v >= max) ? 'true' : 'false'); });
    if (emit && changed) st.dispatchEvent(new CustomEvent('stepchange', { bubbles: true, detail: { value: v } }));
    return v;
  }
  function stop() { var was = timer !== null; clearTimeout(timer); timer = null; n = 0; if (was) announce(); }
  btns.forEach(function (b) {
    var dir = +b.dataset.dir;
    b.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      set(+st.dataset.value + dir * step, true);
      (function rep(delay) {
        timer = setTimeout(function () { n++; set(+st.dataset.value + dir * step * (n > 12 ? 2 : 1), true); rep(n > 6 ? 55 : 90); }, delay);
      })(420);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (t) { b.addEventListener(t, stop); });
    b.addEventListener('click', function (e) { if (e.detail === 0) { set(+st.dataset.value + dir * step, true); announce(); } }); // teclado
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  });
  set(+st.dataset.value, false);
  st._stepper = { set: set, get: function () { return +st.dataset.value; } };
  return st._stepper;
}

/* ---------- Carrusel: índice activo, paginador y flechas ---------- */
function carousel(wrap) {
  var track = wrap.querySelector('.carousel'); if (!track) return null;
  var prev = wrap.querySelector('[data-prev]'), next = wrap.querySelector('[data-next]');
  var count = wrap.querySelector('.pager-count'), dots = wrap.querySelector('.pager-dots');
  var cur = -1, ticking = false;
  function slides() { return Array.prototype.slice.call(track.children); }
  function index() {
    var s = slides(); if (s.length < 2) return 0;
    if (track.scrollLeft >= track.scrollWidth - track.clientWidth - 2) return s.length - 1;
    var w = s[1].offsetLeft - s[0].offsetLeft;
    return Math.max(0, Math.min(s.length - 1, Math.round(track.scrollLeft / w)));
  }
  function paint(force) {
    var s = slides(), i = index();
    if (i === cur && !force) return;
    cur = i;
    if (count) count.textContent = (i + 1) + ' de ' + s.length;
    if (dots) {
      if (dots.children.length !== s.length) dots.innerHTML = s.map(function () { return '<i></i>'; }).join('');
      $$('i', dots).forEach(function (d, j) { d.toggleAttribute('data-on', j === i); });
    }
    if (prev) prev.setAttribute('aria-disabled', i === 0 ? 'true' : 'false');
    if (next) next.setAttribute('aria-disabled', i === s.length - 1 ? 'true' : 'false');
    wrap.dispatchEvent(new CustomEvent('slidechange', { bubbles: true, detail: { index: i, count: s.length } }));
  }
  function go(i) {
    var s = slides(); i = Math.max(0, Math.min(s.length - 1, i));
    track.scrollTo({ left: s[i].offsetLeft - s[0].offsetLeft, behavior: FBT.reduced() ? 'auto' : 'smooth' });
  }
  if (!wrap._carousel) {
    track.addEventListener('scroll', function () {
      if (ticking) return; ticking = true;
      requestAnimationFrame(function () { ticking = false; paint(); });
    }, { passive: true });
    if (prev) prev.addEventListener('click', function () { go(cur - 1); });
    if (next) next.addEventListener('click', function () { go(cur + 1); });
    track.addEventListener('keydown', function (e) {
      if (e.target !== track || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      go(cur + (e.key === 'ArrowRight' ? 1 : -1)); e.preventDefault();
    });
  }
  wrap._carousel = { go: go, index: function () { return cur; }, refresh: function () { cur = -1; track.style.scrollBehavior = 'auto'; track.scrollLeft = 0; track.style.scrollBehavior = ''; paint(true); } };
  paint(true);
  return wrap._carousel;
}

$$('[data-stepper]').forEach(stepper);
$$('[data-carousel]').forEach(carousel);
FBT.stepper = stepper;
FBT.carousel = carousel;
})();

/* =====================================================================
   Ampliación del kit: volver atrás (Historial y Salida).
   <a class="icon-btn" href="historial.html" data-back aria-label="Volver al historial">
   - Al pulsarlo, si se llegó desde esta misma web, vuelve en el historial
     del navegador (conserva el desplazamiento de la lista); si no, sigue el enlace.
   - Gesto: deslizar desde el borde izquierdo (los primeros 16 px, dentro
     del margen: nunca coincide con el contenido) hacia la derecha. No nace
     sobre un control que se arrastra (perfil táctil, gráficas, carruseles,
     tiras de chips). Un círculo con la flecha acompaña al dedo; pasados 72 px se
     vuelve azul y, al soltar, vuelve atrás. Con movimiento reducido solo
     aparece y desaparece. Útil sobre todo con la app instalada, donde el
     navegador no ofrece su propio gesto.
   ===================================================================== */
(function () {
'use strict';
var FBT = window.FBT, doc = document;
var back = doc.querySelector('[data-back]');
if (!back) return;

/* Si se llegó desde otra pantalla del prototipo (Inicio, Repetidas...), el botón dice a cuál vuelve
   y, sin historial utilizable (file://), lleva allí y no siempre a Historial */
(function fromPage() {
  var NAMES = { 'inicio.html': 'Inicio', 'historial.html': 'Historial', 'subidas.html': 'Subidas', 'repetidas.html': 'Repetidas',
    'calendario.html': 'Plan', 'objetivos.html': 'Objetivos', 'rutas.html': 'Rutas', 'mas.html': 'Más' };
  try {
    var ref = new URL(doc.referrer), f = ref.pathname.split('/').pop();
    if (ref.protocol !== location.protocol || ref.host !== location.host || !NAMES[f] || f === location.pathname.split('/').pop()) return;
    back.setAttribute('aria-label', 'Volver a ' + NAMES[f]);
    back.href = f;
  } catch (e) {}
})();

function goBack() {
  var same = false;
  try { same = !!doc.referrer && new URL(doc.referrer).origin === location.origin && history.length > 1; } catch (e) {}
  if (same && location.protocol !== 'file:') history.back(); else location.href = back.href;
}
back.addEventListener('click', function (e) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
  e.preventDefault(); goBack();
});

var EDGE = 16, GO = 72, MAX = 96;
var DRAGGABLE = '[role="slider"], .scrub, .passes svg, .carousel, .chips-scroll';
var ind = doc.createElement('span');
ind.className = 'edge-back'; ind.setAttribute('aria-hidden', 'true');
ind.innerHTML = FBT.icon('back');
doc.body.appendChild(ind);
var t = null;
function paint(dx) {
  var p = Math.min(dx, MAX), ready = dx >= GO;
  ind.toggleAttribute('data-ready', ready);
  ind.style.opacity = String(Math.min(1, dx / GO));
  if (!FBT.reduced()) ind.style.transform = 'translateX(' + (p - 56) + 'px) scale(' + (ready ? 1.06 : 1) + ')';
}
function settle() {
  ind.classList.add('is-settling');
  ind.style.opacity = '0'; ind.style.transform = '';
  ind.removeAttribute('data-ready');
  setTimeout(function () { ind.classList.remove('is-settling'); }, 220);
}
doc.addEventListener('touchstart', function (e) {
  if (e.touches.length !== 1 || doc.querySelector('dialog[open]')) { t = null; return; }
  if (e.target.closest && e.target.closest(DRAGGABLE)) { t = null; return; }
  var p = e.touches[0];
  t = p.clientX < EDGE ? { x0: p.clientX, y0: p.clientY, on: false, dx: 0 } : null;
}, { passive: true });
doc.addEventListener('touchmove', function (e) {
  if (!t) return;
  var p = e.touches[0], dx = p.clientX - t.x0, dy = Math.abs(p.clientY - t.y0);
  if (!t.on) {
    if (dy > 12 && dy > dx) { t = null; return; }      // es un desplazamiento vertical
    if (dx > 10) t.on = true; else return;
  }
  t.dx = dx; paint(dx);
}, { passive: true });
function end() {
  if (!t) return;
  var ok = t.on && t.dx >= GO; t = null;
  settle();
  if (ok) goBack();
}
doc.addEventListener('touchend', end, { passive: true });
doc.addEventListener('touchcancel', function () { if (t) { t = null; settle(); } }, { passive: true });
})();

/* =====================================================================
   Ampliación del kit: formas de ruta variadas para el prototipo.
   FBT.synth.route(semilla) -> puntos [[x,y]...] para FBT.shape o un mapa.
   Según la semilla (semilla % 3): 0 lazo con cola (sale, da la vuelta y
   vuelve por la misma carretera), 1 lazo, 2 ida y vuelta. Siempre la misma
   forma para la misma semilla: la fila del Historial y el mapa de la Salida
   enseñan el mismo recorrido.
   ===================================================================== */
(function () {
'use strict';
var FBT = window.FBT;
function rnd(seed) { var s = (seed * 9301 + 49297) % 233280; return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
function route(seed) {
  var kind = ['lolli', 'loop', 'out'][seed % 3];
  if (kind === 'loop') return FBT.synth.loop(seed);
  var r = rnd(seed * 7 + 3), a = -Math.PI / 2 + (r() - 0.5) * 1.4, x = 0, y = 0, i;
  var n = kind === 'out' ? 36 : 14, step = kind === 'out' ? 0.09 : 0.075, tail = [[0, 0]];
  for (i = 0; i < n; i++) { a += (r() - 0.5) * 0.75; x += Math.cos(a) * step; y += Math.sin(a) * step; tail.push([x, y]); }
  var back = tail.slice(0, -1).reverse();
  if (kind === 'out') return tail.concat(back);
  // Lazo pegado al final de la cola, girado para que se abra en la dirección de la marcha
  var loop = FBT.synth.loop(seed, 70), s = 0.62, th = a + Math.PI, c = Math.cos(th), sn = Math.sin(th);
  var p0 = loop[0], rx = (p0[0] * c - p0[1] * sn) * s, ry = (p0[0] * sn + p0[1] * c) * s;
  var cx = x - rx, cy = y - ry;
  var ring = loop.map(function (p) { return [cx + (p[0] * c - p[1] * sn) * s, cy + (p[0] * sn + p[1] * c) * s]; });
  return tail.concat(ring.slice(1), back);
}
FBT.synth.route = route;
})();
