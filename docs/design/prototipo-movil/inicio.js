/* =====================================================================
   FBikeTrain, prototipo móvil: Inicio.
   - Paisaje del hero: la cresta cercana es el perfil de tu última salida
     (el mismo que pinta la tarjeta «Tu última salida»), con su cima marcada.
   - Mapa oscuro de la última salida con el trazo luminoso.
   - Tendencia de 12 semanas: barras (sumas) o línea con puntos (velocidad,
     que no debe empezar en cero). Tocar una semana la lee; hay vista de tabla.
   Necesita movil.js (window.FBT). Datos sintéticos, sin ubicaciones reales.
   ===================================================================== */
(function () {
'use strict';
var doc = document, root = doc.documentElement, FBT = window.FBT;
var NS = 'http://www.w3.org/2000/svg';
var STATE = root.dataset.state || 'ok';
var NB = ' ';   // espacio fino antes de % y de las unidades
function $(s) { return doc.querySelector(s); }
function fmt(n, d) { return FBT.fmt(n, d); }
function el(tag, attrs) { var n = doc.createElementNS(NS, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); return n; }
function rnd(seed) { var s = seed * 9301 + 49297; return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
function poly(pts) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(''); }

/* ---------- Datos de ejemplo (coherentes entre sí) ----------
   Los mismos que Historial, Salida, Repetidas, Plan y Más (ver README.md, «Datos de ejemplo»).
   Hoy: viernes 6 de noviembre. Semana en curso, del lunes 2 a hoy: 2 salidas
   (martes 3, Coll de Bracons, 72,1 km; jueves 5, 87,6 km): 160 km, 2722 m, 6 h 08, 26,0 km/h.
   Última salida: jueves 5, Collsuspina y Moià, 87,6 km, 1542 m, 3 h 12, 27,4 km/h, cima 911 m.
   Noviembre: el domingo 1 (Vuelta corta a Tona, 41,3 km) y esta semana: 201 de 800 km.
   Próximo entreno: sábado 7, Lluçanès por Prats, 86 km y 1320 m; domingo 8, 50 km suaves.
   ?state=nohistory: las 11 semanas anteriores están vacías (lesión, invierno o
   solo se ha importado esta semana); la semana en curso es la misma. */
var NOHIST = STATE === 'nohistory';
var HAS_DATA = STATE === 'ok' || NOHIST;      // hay una última salida que dibujar
var RIDE_KM = 87.6;
var RIDE = FBT.synth.profile(4, 120, 470, 911);
var DECOR = FBT.synth.profile(9, 120, 500, 900);    // vacío: cresta de decorado

/* =====================================================================
   1. Paisaje del hero
   ===================================================================== */
function drawHero() {
  var svg = $('#hero-scene'); if (!svg) return;
  var hero = svg.parentNode, land = hero.querySelector('.hero-land');
  var sb = svg.getBoundingClientRect(), W = Math.round(sb.width), H = Math.round(sb.height);
  if (W < 10 || H < 10) return;
  var lb = land.getBoundingClientRect();
  var landTop = lb.top - sb.top, landBot = lb.bottom - sb.top;
  var textTop = hero.querySelector('.page-kicker').getBoundingClientRect().top - sb.top;
  var horizon = landTop + 34;
  var r = rnd(17);
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.innerHTML = '';

  var defs = el('defs', {});
  defs.innerHTML =
    '<linearGradient id="hs-sky" x1="0" y1="0" x2="0" y2="' + (horizon + 24) + '" gradientUnits="userSpaceOnUse">' +
      '<stop offset="0" style="stop-color:var(--sky-0)"/><stop offset=".34" style="stop-color:var(--sky-1)"/>' +
      '<stop offset=".62" style="stop-color:var(--sky-2)"/><stop offset=".84" style="stop-color:var(--sky-3)"/>' +
      '<stop offset="1" style="stop-color:var(--sky-4)"/></linearGradient>' +
    '<radialGradient id="hs-haze"><stop offset="0" style="stop-color:var(--haze);stop-opacity:.42"/><stop offset="1" style="stop-color:var(--haze);stop-opacity:0"/></radialGradient>' +
    '<radialGradient id="hs-orb"><stop offset=".25" style="stop-color:var(--orb-glow);stop-opacity:.55"/><stop offset="1" style="stop-color:var(--orb-glow);stop-opacity:0"/></radialGradient>' +
    '<radialGradient id="hs-scrim"><stop offset="0" style="stop-color:var(--hero-scrim)"/><stop offset=".55" style="stop-color:var(--hero-scrim)"/><stop offset="1" style="stop-color:var(--hero-scrim);stop-opacity:0"/></radialGradient>' +
    '<linearGradient id="hs-mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--mist);stop-opacity:0"/><stop offset="1" style="stop-color:var(--mist);stop-opacity:.42"/></linearGradient>' +
    // Fundido de la cresta al fondo con forma de «smoothstep»: la pendiente del color llega
    // a cero en los dos extremos y no se ve un borde (banda de Mach) sobre --bg.
    '<linearGradient id="hs-near" x1="0" y1="' + (landTop + 30) + '" x2="0" y2="' + H + '" gradientUnits="userSpaceOnUse">' +
      // Llega a --bg antes del pie del SVG: el borde inferior no deja una línea sobre la página
      '<stop offset="0" style="stop-color:var(--ridge-near)"/><stop offset=".4" style="stop-color:var(--ridge-near)"/>' +
      '<stop offset=".52" style="stop-color:color-mix(in srgb, var(--ridge-near) 84%, var(--bg))"/>' +
      '<stop offset=".64" style="stop-color:color-mix(in srgb, var(--ridge-near) 50%, var(--bg))"/>' +
      '<stop offset=".76" style="stop-color:color-mix(in srgb, var(--ridge-near) 16%, var(--bg))"/>' +
      '<stop offset=".88" style="stop-color:var(--bg)"/></linearGradient>';
  svg.appendChild(defs);

  // Cielo, bruma cálida del horizonte, estrellas y astro (luna u sol)
  svg.appendChild(el('rect', { width: W, height: H, fill: 'url(#hs-sky)' }));
  svg.appendChild(el('ellipse', { cx: W * 0.6, cy: horizon, rx: W * 0.75, ry: 70, fill: 'url(#hs-haze)' }));
  var stars = el('g', { style: 'opacity:var(--stars)' });
  for (var i = 0; i < 46; i++) {
    stars.appendChild(el('circle', { cx: (r() * W).toFixed(1), cy: (6 + r() * (horizon - 30)).toFixed(1), r: (0.5 + r() * 0.8).toFixed(2), style: 'fill:var(--star)', opacity: (0.35 + r() * 0.6).toFixed(2) }));
  }
  svg.appendChild(stars);
  var ox = W * 0.8, oy = horizon - 8;
  svg.appendChild(el('circle', { cx: ox, cy: oy, r: 62, fill: 'url(#hs-orb)' }));
  svg.appendChild(el('circle', { cx: ox, cy: oy, r: 13, style: 'fill:var(--orb)' }));

  // Cuatro crestas de fondo: perspectiva atmosférica, de la más lejana a la más cercana
  for (var k = 0; k < 4; k++) {
    var base = horizon - 6 + k * 15, amp = 22 + k * 7, ph = [r() * 6, r() * 6, r() * 6], pts = [[-4, H + 20]];
    for (var x = -4; x <= W + 8; x += 6) {
      var t = x / W;
      var y = base - amp * (0.5 + 0.28 * Math.sin(t * (5 + k) + ph[0]) + 0.16 * Math.sin(t * (13 + k * 2) + ph[1]) + 0.06 * Math.sin(t * 31 + ph[2]));
      pts.push([x, Math.min(y, H + 20)]);
    }
    pts.push([W + 8, H + 20]);   // por debajo del pie: ningún borde antialias en la última fila
    svg.appendChild(el('path', { d: poly(pts) + 'Z', style: 'fill:var(--ridge-' + (k + 1) + ')' }));
    if (k === 1) svg.appendChild(el('rect', { x: 0, y: horizon - 6, width: W, height: 46, fill: 'url(#hs-mist)' }));
  }

  // Velo tras el saludo: garantiza el contraste del texto sobre el cielo
  var tm = (textTop + landTop) / 2;
  svg.appendChild(el('ellipse', { cx: W * 0.28, cy: tm, rx: Math.max(W * 0.78, 260), ry: (landTop - textTop) * 0.82 + 20, fill: 'url(#hs-scrim)' }));

  // Cresta cercana: el perfil de tu última salida (decorado si no hay, o si no se ha podido cargar)
  var prof = HAS_DATA ? RIDE : DECOR;
  var mx = Math.max.apply(null, prof), mn = Math.min.apply(null, prof);
  // Toda la cresta queda a la vista, justo encima de las cifras (que se meten en el paisaje)
  var kp = doc.querySelector('.week .kpis'), kb = kp && kp.getBoundingClientRect();
  var kTop = kb && kb.height ? kb.top - sb.top : landBot - 36;
  var yLow = Math.min(landTop + 64, kTop - 4), yTop = Math.max(landTop + 4, yLow - 40), n = prof.length;
  var top = prof.map(function (v, j) { return [-8 + (j / (n - 1)) * (W + 16), yTop + (1 - (v - mn) / (mx - mn)) * (yLow - yTop)]; });
  svg.appendChild(el('path', { d: poly(top) + 'L' + (W + 8) + ' ' + (H + 20) + 'L-8 ' + (H + 20) + 'Z', fill: 'url(#hs-near)' }));
  // Curvas de nivel grabadas en la cresta
  [12, 24, 37, 52].forEach(function (dy, j) {
    svg.appendChild(el('path', { d: poly(top.map(function (p) { return [p[0], p[1] + dy + j * 2]; })), fill: 'none', style: 'stroke:var(--ridge-line);stroke-opacity:' + (0.13 - j * 0.025).toFixed(3), 'stroke-width': 1 }));
  });
  // Línea de luz (halo, núcleo e hilo): lo único que se dibuja al cargar
  var d = poly(top), g = el('g', {});
  g.appendChild(el('path', { d: d, pathLength: 1, class: 'ridge-light', fill: 'none', style: 'stroke:var(--ridge-line);opacity:calc(.55 * var(--glow))', 'stroke-width': 7, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  g.appendChild(el('path', { d: d, pathLength: 1, class: 'ridge-light', fill: 'none', style: 'stroke:var(--ridge-line)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  g.appendChild(el('path', { d: d, pathLength: 1, class: 'ridge-light', fill: 'none', style: 'stroke:#fff;opacity:calc(.8 * var(--thread))', 'stroke-width': 0.8, 'stroke-linejoin': 'round' }));
  svg.appendChild(g);

  // Cima: vértice geodésico y rótulo (solo con datos)
  var pill = $('#summit');
  if (HAS_DATA && pill) {
    var ip = prof.indexOf(mx), sp = top[ip];
    var pb = pill.querySelector('b'); if (pb) pb.textContent = fmt(mx) + NB + 'm';   // antes de medir la pastilla
    svg.appendChild(el('circle', { cx: sp[0].toFixed(1), cy: sp[1].toFixed(1), r: 3.5, style: 'fill:var(--ridge-line);stroke:var(--ridge-near)', 'stroke-width': 2 }));
    // El rótulo va al lado de la cima (donde haya sitio), a su altura: no choca con el saludo
    var lx = land.getBoundingClientRect().left - sb.left, pw = pill.offsetWidth, ph2 = pill.offsetHeight;
    var right = sp[0] - lx + 12, left = sp[0] - lx - 12 - pw;
    var px = right + pw <= land.clientWidth ? right : Math.max(0, left);
    pill.style.transform = 'translate(' + px.toFixed(0) + 'px,' + (sp[1] - landTop - ph2 / 2).toFixed(0) + 'px)';
    // Un aria-label en un <p> no se lee de forma fiable: el texto completo va en un sr-only
    var sr = $('#summit-sr');
    if (sr) sr.textContent = 'Cima de tu última salida: ' + fmt(mx) + ' m, en el km ' + fmt((ip / (n - 1)) * RIDE_KM, 1) + ', el jueves';
  }
}

/* El único momento orquestado: la línea de luz se dibuja (900 ms) y después aparece la cima */
var drawn = false;
function introHero() {
  var svg = $('#hero-scene'), pill = $('#summit');
  if (drawn || !svg) { if (pill) pill.classList.add('is-in'); return; }
  drawn = true;
  if (FBT.reduced()) { if (pill) pill.classList.add('is-in'); return; }
  svg.classList.add('is-drawing');
  svg.getBoundingClientRect();
  requestAnimationFrame(function () {
    svg.classList.remove('is-drawing');
    setTimeout(function () { if (pill) pill.classList.add('is-in'); }, 820);
  });
}

/* =====================================================================
   2. Tu última salida: mapa y perfil
   ===================================================================== */
function routePoints() {
  var loop = FBT.synth.loop(5, 140), st = loop[0], tail = [];
  for (var i = 6; i > 0; i--) tail.push([st[0] - 0.09 * i + 0.02 * Math.sin(i * 1.7), st[1] + 0.07 * i + 0.015 * Math.cos(i)]);
  return tail.concat(loop).concat(tail.slice().reverse());
}
function drawMap() {
  var svg = $('#ride-map'); if (!svg) return;
  var b = svg.getBoundingClientRect(), W = Math.round(b.width), H = Math.round(b.height);
  if (W < 10) return;
  var r = rnd(29), out = '';
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  // Relieve: dos colinas con curvas de nivel
  [[W * 0.22, H * 0.3], [W * 0.78, H * 0.72]].forEach(function (c) {
    for (var k = 1; k <= 6; k++) {
      var pts = [], ph = r() * 6;
      for (var a = 0; a <= 36; a++) {
        var t = (a / 36) * Math.PI * 2, rr = k * 17 * (1 + 0.12 * Math.sin(3 * t + ph) + 0.06 * Math.sin(5 * t + k));
        pts.push([c[0] + Math.cos(t) * rr * 1.5, c[1] + Math.sin(t) * rr]);
      }
      out += '<path class="contour" d="' + poly(pts) + 'Z"/>';
    }
  });
  // Río y carreteras de fondo
  out += '<path class="river" d="M-10 ' + (H * 0.86) + ' C ' + (W * 0.25) + ' ' + (H * 0.7) + ', ' + (W * 0.45) + ' ' + (H * 1.02) + ', ' + (W + 10) + ' ' + (H * 0.8) + '"/>';
  for (var i = 0; i < 6; i++) {
    var y0 = r() * H, y1 = r() * H, x0 = -10, x1 = W + 10;
    if (i % 2) { x0 = r() * W; x1 = r() * W; y0 = -10; y1 = H + 10; }
    out += '<path class="road' + (i === 0 ? ' road--main' : '') + '" d="M' + x0.toFixed(0) + ' ' + y0.toFixed(0) + ' Q ' + (r() * W).toFixed(0) + ' ' + (r() * H).toFixed(0) + ' ' + x1.toFixed(0) + ' ' + y1.toFixed(0) + '"/>';
  }
  // Trazo luminoso, ajustado a la caja sin deformar
  var pts2 = routePoints(), xs = pts2.map(function (p) { return p[0]; }), ys = pts2.map(function (p) { return p[1]; });
  var x0b = Math.min.apply(null, xs), x1b = Math.max.apply(null, xs), y0b = Math.min.apply(null, ys), y1b = Math.max.apply(null, ys);
  var pad = 26, s = Math.min((W - pad * 2) / (x1b - x0b), (H - pad * 2) / (y1b - y0b));
  var ox = W / 2 - ((x0b + x1b) / 2) * s, oy = H / 2 - ((y0b + y1b) / 2) * s;
  var P = pts2.map(function (p) { return [p[0] * s + ox, p[1] * s + oy]; }), d = poly(P);
  out += '<path class="halo" d="' + d + '"/><path class="core" d="' + d + '"/><path class="thread" d="' + d + '"/>';
  out += '<circle class="start" r="5.5" cx="' + P[0][0].toFixed(1) + '" cy="' + P[0][1].toFixed(1) + '"/>';
  svg.innerHTML = out;
}
function drawRideProfile() {
  var svg = $('#ride-profile'); if (!svg) return;
  var classes = FBT.profile(svg, RIDE, RIDE_KM);
  var NAMES = ['Llano o bajada', '1-4' + NB + '%', '4-7' + NB + '%', '7-10' + NB + '%', '10-16' + NB + '%', '16' + NB + '% o más'];
  var lg = $('#lg-ultima');
  if (lg) lg.innerHTML = classes.map(function (c) { return '<span><i style="background:var(--g' + c + ')"></i>' + NAMES[c] + '</span>'; }).join('');
  var mx = Math.max.apply(null, RIDE), km = (RIDE.indexOf(mx) / (RIDE.length - 1)) * RIDE_KM;
  var topEl = $('#ride-top'); if (topEl) topEl.textContent = fmt(mx);
  svg.setAttribute('aria-label', 'Perfil por pendiente: sube hasta ' + fmt(mx) + ' m en el km ' + fmt(km, 0) + ', con tramos de hasta el ' + NAMES[classes[classes.length - 1]] + ', y vuelve por un repecho más corto');
  // Eje de km proporcional a la longitud real: pasos de 20, 50 o 100 km
  var ax = $('#ride-axis');
  if (ax) {
    var st = RIDE_KM <= 120 ? 20 : RIDE_KM <= 300 ? 50 : 100, h = '';
    for (var t = 0; t < RIDE_KM - st * 0.6; t += st) h += '<span style="left:' + (t / RIDE_KM * 100).toFixed(2) + '%">' + t + '</span>';
    ax.innerHTML = h + '<span class="is-end" style="left:100%">' + fmt(RIDE_KM, RIDE_KM % 1 ? 1 : 0) + NB + 'km</span>';
  }
}

/* =====================================================================
   3. Tu semana, objetivo y tendencia de 12 semanas
   - La media de la gráfica es la de las 11 semanas completas; la última va en curso.
   - Las cifras de la semana se comparan con tus semanas «a estas alturas»: la suma
     de lunes a viernes de cada una de las 11 semanas completas, dividida entre 11.
     Comparar una semana a medias con semanas completas da −85 % los lunes.
   - Sin media todavía (menos de 3 semanas completas con salidas, o media 0): se
     ven las cifras, sin porcentajes ni línea de media. Es el estado ?state=nohistory.
   ===================================================================== */
var WEEKS = ['17 ago', '24 ago', '31 ago', '7 sep', '14 sep', '21 sep', '28 sep', '5 oct', '12 oct', '19 oct', '26 oct', '2 nov'];
var Z = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
function pick11(a) { return NOHIST ? Z : a; }
/* Semana en curso. Enlaces del prototipo para sus casos límite:
   ?rides=0  el lunes por la mañana (aún sin salidas; pasa cada semana);
   ?rides=1  una sola salida (el singular). */
var QS = new URLSearchParams(location.search);
var WK = { rides: 2, km: 159.7, el: 2722, min: 368 };
if (QS.get('rides') === '0') WK = { rides: 0, km: 0, el: 0, min: 0 };
else if (QS.get('rides') === '1') WK = { rides: 1, km: 42, el: 610, min: 98 };
var KM  = pick11([178, 152, 215, 196, 104, 241, 186, 208, 222, 164, 235]).concat([WK.km]);
var EL  = pick11([2810, 2240, 3350, 3020, 1480, 3720, 2890, 3110, 3460, 2560, 3800]).concat([WK.el]);
var MIN = pick11([395, 340, 480, 430, 230, 520, 410, 460, 490, 360, 554]).concat([WK.min]);
// De lunes a viernes de cada semana completa («a estas alturas»)
var KM_TD  = pick11([118, 98, 152, 140, 62, 165, 121, 148, 150, 112, 141]);
var EL_TD  = pick11([1820, 1410, 2290, 1990, 880, 2480, 1850, 2110, 2230, 1650, 2390]);
var MIN_TD = pick11([262, 220, 340, 305, 140, 355, 268, 325, 330, 245, 335]);
var RIDES_WEEK = WK.rides;
// Noviembre: el domingo 1 (41,3 km) y lo que llevas de semana
var GOAL = { target: 800, done: (NOHIST ? 0 : 41.3) + WK.km, day: 6, days: 30 };
// Próximo entreno. ?ruta=<nombre> prueba un nombre largo en el saludo
var NEXT_NAME = QS.get('ruta') || 'Lluçanès por Prats';
var MIN_WEEKS = 3;
var NOMEAN = 'Aún no hay media: necesitas 3 semanas con salidas.';

function hm(m) { var h = Math.floor(m / 60), mm = Math.round(m - h * 60); return h + NB + 'h ' + (mm < 10 ? '0' : '') + mm + NB + 'min'; }
function hShort(m) { var h = Math.floor(m / 60), mm = Math.round(m - h * 60); return h + NB + 'h' + NB + (mm < 10 ? '0' : '') + mm; }
function sum(a) { return a.reduce(function (s, v) { return s + v; }, 0); }
var M = {
  dist:  { name: 'Distancia', vals: KM, td: KM_TD, unit: 'km', dec: 0, kind: 'bar', acc: 'dist' },
  elev:  { name: 'Desnivel', vals: EL, td: EL_TD, unit: 'm', dec: 0, kind: 'bar', acc: 'elev' },
  time:  { name: 'Tiempo en movimiento', vals: MIN, td: MIN_TD, unit: 'min', dec: 0, kind: 'bar', acc: 'time' },
  // Una semana sin tiempo no tiene velocidad: null, y la línea se parte
  speed: { name: 'Velocidad media', vals: KM.map(function (k, i) { return MIN[i] ? (k / MIN[i]) * 60 : null; }), unit: 'km/h', dec: 1, kind: 'line', acc: 'speed' }
};
var WEEKS_WITH_RIDES = KM.slice(0, 11).filter(function (v) { return v > 0; }).length;
Object.keys(M).forEach(function (k) {
  var m = M[k];
  m.mean = null; m.meanTd = null;
  if (WEEKS_WITH_RIDES < MIN_WEEKS) return;
  if (k === 'speed') {
    var t = sum(MIN.slice(0, 11));                        // solo cuentan las semanas con tiempo
    m.mean = t ? (sum(KM.slice(0, 11)) / t) * 60 : null;
  } else {
    m.mean = sum(m.vals.slice(0, 11)) / 11 || null;
    m.meanTd = sum(m.td) / 11 || null;
  }
});
function val(m, v) { return m.unit === 'min' ? hm(v) : fmt(v, m.dec) + NB + m.unit; }
function pctNum(v, ref) { return ref ? Math.round((v / ref - 1) * 100) : null; }
function pct(v, ref) {
  var p = pctNum(v, ref);
  if (p === 0) return 'igual que tu media';
  return 'un ' + Math.abs(p) + NB + '% ' + (p > 0 ? 'más' : 'menos') + ' que tu media';
}
function signed(p) { return p == null ? '—' : (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p) + NB + '%'; }
// Referencia de la semana en curso: a estas alturas (la velocidad no depende del día)
function refNow(m) { return m.kind === 'line' ? m.mean : m.meanTd; }

/* ---------- Cifras de la semana ---------- */
function drawWeek() {
  // Sin salidas esta semana (cada lunes por la mañana): cifras a 0 sin «−100 %», y sin velocidad
  var none = RIDES_WEEK === 0;
  Array.prototype.forEach.call(doc.querySelectorAll('.kpi[data-k]'), function (card) {
    var m = M[card.dataset.k], v = m.vals[11], d = card.querySelector('.delta'), fig = card.querySelector('.kpi-v');
    if (fig) fig.innerHTML = v == null ? '—'
      : m.unit === 'min' ? Math.floor(v / 60) + '<span class="u">h</span>' + (v ? ('0' + Math.round(v % 60)).slice(-2) : '')
      : fmt(v, m.unit === 'km/h' ? 1 : 0) + '<span class="u">' + m.unit + '</span>';
    if (fig) fig.classList.toggle('is-none', v == null);
    if (!d) return;
    var p = none || v == null ? null : pctNum(v, refNow(m));
    if (p == null) { d.innerHTML = ''; d.className = 'delta'; return; }    // sin media o sin salidas: sin porcentaje
    d.className = 'delta' + (p > 0 ? ' delta--up' : p < 0 ? ' delta--down' : '');
    d.innerHTML = (p ? FBT.icon(p > 0 ? 'up' : 'down') : '') + signed(p) +
      '<span class="sr-only"> frente a ' + (m.kind === 'line' ? 'tu media' : 'tus semanas a estas alturas') + '</span>';
  });
  var cap = $('#week-cap'); if (!cap) return;
  if (none) {
    var td = M.dist.meanTd;
    cap.textContent = 'Aún no has salido esta semana.' + (td > 0 ? ' A estas alturas sueles llevar ' + val(M.dist, td) + '.' : '');
    return;
  }
  cap.textContent = RIDES_WEEK + (RIDES_WEEK === 1 ? ' salida' : ' salidas') + ' esta semana' +
    (M.dist.mean == null ? '. ' + NOMEAN : ', frente a tus semanas a estas alturas');
}

/* ---------- Objetivo de noviembre y frase del hero ---------- */
function drawGoal() {
  var p = GOAL.done / GOAL.target, pace = GOAL.day / GOAL.days, diff = Math.round((p - pace) * GOAL.target);
  var meter = $('#goal-meter'), done = $('#goal-done'), leg = $('#goal-pace'), lead = $('#hero-lead');
  if (Math.abs(diff) < GOAL.target * 0.01) diff = 0;   // a menos del 1 % del objetivo: vas al ritmo
  var ahead = diff > 0, word = diff === 0 ? 'al ritmo' : ahead ? 'por delante del ritmo' : 'por detrás del ritmo';
  if (done) done.textContent = fmt(GOAL.done);
  var unit = $('.goal-v .u'); if (unit) unit.textContent = 'de ' + fmt(GOAL.target) + NB + 'km';
  if (meter) {
    meter.style.setProperty('--p', p.toFixed(3)); meter.style.setProperty('--pace', pace.toFixed(3));
    meter.setAttribute('aria-label', 'El ' + Math.round(p * 100) + NB + '% del objetivo. A día ' + GOAL.day + ', el ritmo esperado es el ' + Math.round(pace * 100) + NB + '%: ' +
      (diff ? 'vas ' + fmt(Math.abs(diff)) + NB + 'km ' + word : 'vas ' + word));
  }
  // En km y no en «puntos»: (lo hecho − lo esperado a día de hoy) × objetivo
  if (leg) leg.innerHTML = diff
    ? '<span class="delta' + (ahead ? ' delta--up' : ' delta--down') + '">' + FBT.icon(ahead ? 'up' : 'down') + fmt(Math.abs(diff)) + NB + 'km</span> ' + word
    : 'Vas justo al ritmo';
  // Una línea: el ritmo ya lo dice el objetivo, justo debajo. El nombre lleva al próximo entreno.
  var sn = shortName(NEXT_NAME);
  if (lead) lead.innerHTML = 'Mañana toca <a class="lead-link" href="#s-proximo">' + esc(sn) + '</a>' + (/…$/.test(sn) ? '' : '.');
  var nt = $('.next-title'); if (nt) { nt.textContent = NEXT_NAME; nt.title = NEXT_NAME; }
}
/* Nombre corto para el saludo: hasta « por » o la primera coma, 28 caracteres como mucho */
function shortName(s) {
  var c = Array.from(s.split(/ por |,/)[0].trim());
  return c.length > 28 ? c.slice(0, 27).join('').trim() + '…' : c.join('');
}
function esc(s) { return s.replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); }

/* ---------- Escala: paso «agradable» 1-2-2,5-5 × 10^n, 4 intervalos como mucho ---------- */
function niceSteps(from, cands) {
  var out = [], e = Math.floor(Math.log10(from)) - 1;
  for (var k = 0; k < 6; k++, e++) cands.forEach(function (c) { out.push(c * Math.pow(10, e)); });
  return out;
}
function scale(m) {
  var vs = m.vals.filter(function (v) { return v != null; });
  if (m.mean != null) vs.push(m.mean);
  var max = Math.max.apply(null, vs), min = Math.min.apply(null, vs), lo = 0, hi = 1, step = 1;
  if (m.kind === 'bar') {
    if (max <= 0) max = m.unit === 'min' ? 60 : m.unit === 'm' ? 500 : 50;
    // El tiempo se rotula en horas enteras
    var cands = m.unit === 'min' ? [1, 2, 3, 4, 5, 10, 20, 25, 50, 100].map(function (s) { return s * 60; })
                                 : niceSteps(max / 4, [1, 2, 2.5, 5]);
    for (var i = 0; i < cands.length; i++) {
      step = cands[i]; hi = Math.ceil(max / step) * step;
      if (hi - max < step * 0.18) hi += step;              // aire para la cifra encima de la barra
      if (hi / step <= 4) break;
    }
  } else {
    var mid = (max + min) / 2;
    max = Math.max(max, mid + 1); min = Math.min(min, mid - 1);   // nunca menos de 2 km/h de rango
    var c2 = niceSteps((max - min) / 4, [1, 2, 2.5, 5]);
    for (var j = 0; j < c2.length; j++) {
      step = c2[j]; lo = Math.floor(min / step) * step; hi = Math.ceil(max / step) * step;
      if (hi - max < step * 0.3) hi += step;
      if ((hi - lo) / step <= 4) break;
    }
  }
  var ticks = []; for (var t = lo; t <= hi + 1e-9; t += step) ticks.push(+t.toFixed(4));
  return { lo: lo, hi: hi, ticks: ticks, step: step };
}
function tick(m, v, step) {
  if (m.unit === 'min') return fmt(v / 60) + NB + 'h';
  return fmt(v, m.unit === 'km/h' && step < 1 ? 1 : 0);
}

var cur = 'dist', sel = 11;
function drawTrend() {
  var svg = $('#trend-chart'); if (!svg) return;
  var m = M[cur], W = Math.round(svg.getBoundingClientRect().width), H = 188;
  svg.closest('.trend').dataset.m = m.acc;   // el acento de la métrica colorea barras, línea e icono
  if (W < 10) return;
  var sc = scale(m);
  var meanTxt = m.mean == null ? '' : (m.unit === 'min' ? hShort(m.mean) : fmt(m.mean, m.dec));
  var pillW = Math.round(meanTxt.length * 6.9 + 12);
  var padL = Math.max(38, pillW + 6), padR = 2, padT = 22, padB = 26, pw = W - padL - padR, ph = H - padT - padB;
  var slot = pw / 12, bw = Math.max(6, Math.min(24, slot * 0.62));
  var Y = function (v) { return padT + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph; };
  var X = function (i) { return padL + slot * (i + 0.5); };
  var ym = m.mean == null ? null : Y(m.mean);
  var o = '';
  sc.ticks.forEach(function (t, i) {
    var yt = Y(t);
    o += '<line class="' + (i === 0 && m.kind === 'bar' ? 'base' : 'grid') + '" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + yt.toFixed(1) + '" y2="' + yt.toFixed(1) + '"/>';
    if (ym != null && Math.abs(yt - ym) < 15) return;     // la etiqueta de la media sustituye a la marca que choca
    o += '<text x="' + (padL - 8) + '" y="' + (yt + 4).toFixed(1) + '" text-anchor="end">' + tick(m, t, sc.step) + '</text>';
  });
  var plot = '';
  if (m.kind === 'bar') {
    m.vals.forEach(function (v, i) {
      if (!(v > 0)) return;                                // semana sin salidas: sin barra
      var x = X(i) - bw / 2, y = Y(v), b = Y(0), rr = Math.min(4, bw / 2, b - y);
      plot += '<path class="bar' + (i === sel ? ' is-on' : '') + '" d="M' + x.toFixed(1) + ' ' + b.toFixed(1) + 'V' + (y + rr).toFixed(1) +
        'Q' + x.toFixed(1) + ' ' + y.toFixed(1) + ' ' + (x + rr).toFixed(1) + ' ' + y.toFixed(1) + 'H' + (x + bw - rr).toFixed(1) +
        'Q' + (x + bw).toFixed(1) + ' ' + y.toFixed(1) + ' ' + (x + bw).toFixed(1) + ' ' + (y + rr).toFixed(1) + 'V' + b.toFixed(1) + 'Z"/>';
    });
  } else {
    // La línea se parte donde no hay dato (semana sin tiempo)
    var seg = [], segs = [];
    m.vals.forEach(function (v, i) { if (v == null) { if (seg.length) segs.push(seg); seg = []; } else seg.push([X(i), Y(v)]); });
    if (seg.length) segs.push(seg);
    segs.forEach(function (s) { if (s.length > 1) plot += '<path class="line" d="' + poly(s) + '"/>'; });
    m.vals.forEach(function (v, i) { if (v != null) plot += '<circle class="dot' + (i === sel ? ' is-on' : '') + '" cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="' + (i === sel ? 6 : 4) + '"/>'; });
  }
  // Media: discontinua sobre los datos; su cifra va en el eje, fuera del área de datos
  if (ym != null) {
    plot += '<line class="mean" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + ym.toFixed(1) + '" y2="' + ym.toFixed(1) + '"/>';
    o += '<rect class="mean-pill" x="' + (padL - 4 - pillW) + '" y="' + (ym - 10).toFixed(1) + '" width="' + pillW + '" height="20" rx="6"/>' +
         '<text class="mean-t" x="' + (padL - 4 - pillW / 2).toFixed(1) + '" y="' + (ym + 4).toFixed(1) + '" text-anchor="middle">' + meanTxt + '</text>';
  }
  // Semana en curso, con barras: marca de lo que sueles llevar «a estas alturas». Explica por qué
  // una semana a medias puede ir por encima de lo normal aunque su barra no llegue a la media.
  // Se ve con la semana en curso elegida, que es cuando la lectura de arriba la nombra.
  var yt = null;
  if (m.kind === 'bar' && m.meanTd != null && sel === 11) {
    yt = Y(m.meanTd);
    var tx0 = (X(11) - bw / 2 - 3).toFixed(1), tx1 = (X(11) + bw / 2 + 3).toFixed(1);
    plot += '<line class="td-halo" x1="' + tx0 + '" x2="' + tx1 + '" y1="' + yt.toFixed(1) + '" y2="' + yt.toFixed(1) + '"/>' +
            '<line class="td" x1="' + tx0 + '" x2="' + tx1 + '" y1="' + yt.toFixed(1) + '" y2="' + yt.toFixed(1) + '"/>';
  }
  // Cifra de la semana elegida, pegada encima de su barra: nunca a la altura de las vecinas ni de la
  // media. Si cae sobre la discontinua, su halo la corta (una barra de 24 px no admite la cifra dentro).
  // En la línea, al lado contrario de la media. Sin salidas (0 o sin dato) no hay cifra.
  var sv = m.vals[sel];
  if (m.kind === 'bar' ? sv > 0 : sv != null) {
    var label = m.unit === 'min' ? hShort(sv) : fmt(sv, m.dec), half = label.length * 4.4 + 2;
    var sx = Math.max(padL + half, Math.min(X(sel), W - padR - half)), sy;
    if (m.kind === 'bar') {
      sy = Y(sv) - 7;
      if (yt != null && sv < m.meanTd && sy > yt - 8) sy = yt - 8;          // por encima de la marca
    } else sy = m.mean == null || sv >= m.mean ? Y(sv) - 12 : Y(sv) + 22;
    plot += '<text class="val" x="' + sx.toFixed(1) + '" y="' + sy.toFixed(1) + '" text-anchor="middle">' + label + '</text>';
  }
  // Eje X: tres fechas y la semana en curso
  [0, 4, 8].forEach(function (i) { o += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + WEEKS[i] + '</text>'; });
  o += '<text class="xl-now" x="' + (W - padR) + '" y="' + (H - 6) + '" text-anchor="end">En curso</text>';
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.innerHTML = o + '<g class="trend-plot">' + plot + '</g>';
  svg._geo = { padL: padL, slot: slot };
  var vs = m.vals.filter(function (v) { return v != null; }), mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
  svg.setAttribute('aria-label', m.name + ' por semana en las últimas 12 semanas: entre ' + val(m, mn) + ' y ' + val(m, mx) +
    '. ' + (m.mean == null ? NOMEAN : 'Tu media, ' + val(m, m.mean) + '.') +
    (m.vals[11] > 0 ? ' Esta semana, aún en curso, ' + val(m, m.vals[11]) : ' Esta semana, aún sin salidas') +
    (m.kind === 'bar' && m.meanTd != null ? '; a estas alturas sueles llevar ' + val(m, m.meanTd) : '') + '. Los datos están en la tabla.');
  var key = $('#trend-key'); if (key) key.hidden = m.mean == null;
  readout();
}
function readout() {
  var m = M[cur], v = m.vals[sel], p = $('#trend-read'); if (!p) return;
  var who = sel === 11 ? '<b>Esta semana</b>, en curso: ' : '<b>Semana del ' + WEEKS[sel] + '</b>: ';
  var s, key = '<span class="td-key" aria-hidden="true"></span>';   // la misma marca que en la gráfica
  var empty = v == null || (m.kind === 'bar' && !(v > 0));
  if (empty && sel === 11 && m.meanTd != null)
    s = who + 'aún sin salidas. ' + key + 'A estas alturas sueles llevar ' + val(m, m.meanTd) + '.';
  else if (empty) s = who + 'sin salidas.';
  else if (m.mean == null) s = who + '<b>' + val(m, v) + '</b>. ' + NOMEAN;
  else if (sel === 11 && m.meanTd != null)
    s = who + '<b>' + val(m, v) + '</b>. ' + key + 'A estas alturas sueles llevar ' + val(m, m.meanTd) + '; la semana completa, ' + val(m, m.mean) + '.';
  else s = who + '<b>' + val(m, v) + '</b>, ' + pct(v, m.mean) + (sel === 11 ? ' de ' + val(m, m.mean) : '') + '.';
  p.innerHTML = s;
  var prev = $('#trend-prev'), next = $('#trend-next');
  if (prev) prev.disabled = sel === 0;
  if (next) next.disabled = sel === 11;
}
function drawTable() {
  var wrap = $('#trend-table-wrap'); if (!wrap) return;
  var m = M[cur], now = refNow(m);
  var cap = m.name + ' por semana, de lunes a domingo. ' + (m.mean == null ? NOMEAN
    : 'La media es la de las 11 semanas completas: ' + val(m, m.mean) + '.' +
      (m.kind === 'bar' ? ' La semana en curso se compara con tus semanas a estas alturas: ' + val(m, now) + '.' : ''));
  wrap.innerHTML = '<table class="trend-table"><caption>' + cap + '</caption>' +
    '<thead><tr><th scope="col">Semana del</th><th scope="col">' + (m.unit === 'min' ? 'Tiempo' : m.name.split(' ')[0]) + '</th><th scope="col">Frente a tu media</th></tr></thead><tbody>' +
    m.vals.map(function (v, i) {
      var p = v == null || (i === 11 && !(v > 0)) ? null : pctNum(v, i === 11 ? now : m.mean);
      var note = i === 11 && m.kind === 'bar' && now != null ? '<br><span class="td-note">a estas alturas: ' + val(m, now) + '</span>' : '';
      return '<tr' + (i === 11 ? ' class="is-now"' : '') + '><th scope="row">' + WEEKS[i] + (i === 11 ? ' (en curso)' : '') + '</th><td>' + (v == null ? '—' : val(m, v)) + '</td><td>' + signed(p) + note + '</td></tr>';
    }).reverse().join('') + '</tbody></table>';
}
function setupTrend() {
  var svg = $('#trend-chart'); if (!svg) return;
  var seg = $('#trend-metric');
  seg.addEventListener('segchange', function (e) {
    cur = e.detail.value; drawTrend(); drawTable();
    var g = svg.querySelector('.trend-plot');               // fundido corto al cambiar de métrica
    if (g && !FBT.reduced()) { g.classList.add('is-swapping'); g.getBoundingClientRect(); g.classList.remove('is-swapping'); }
  });
  function go(i) { i = Math.max(0, Math.min(11, i)); if (i !== sel) { sel = i; drawTrend(); } }
  // Tocar o arrastrar sobre la gráfica (fechas incluidas) elige la semana cuyo centro está más cerca;
  // el desplazamiento vertical sigue funcionando. Las flechas ‹ › (44 px) mueven de una en una.
  var pressing = false;
  function pick(e) {
    var geo = svg._geo; if (!geo) return;
    var b = svg.getBoundingClientRect();
    go(Math.round((e.clientX - b.left - geo.padL) / geo.slot - 0.5));
  }
  svg.addEventListener('pointerdown', function (e) { pressing = true; pick(e); });
  svg.addEventListener('pointermove', function (e) { if (pressing || e.pointerType === 'mouse') pick(e); });
  addEventListener('pointerup', function () { pressing = false; });
  addEventListener('pointercancel', function () { pressing = false; });
  var prev = $('#trend-prev'), next = $('#trend-next');
  if (prev) prev.addEventListener('click', function () { go(sel - 1); });
  if (next) next.addEventListener('click', function () { go(sel + 1); });
  // Vista de tabla: la alternativa accesible a tocar la gráfica
  var tg = $('#trend-toggle'), wrap = $('#trend-table-wrap');
  tg.addEventListener('click', function () {
    var open = tg.getAttribute('aria-expanded') !== 'true';
    tg.setAttribute('aria-expanded', open ? 'true' : 'false');
    wrap.hidden = !open;
    tg.lastChild.textContent = open ? 'Ocultar tabla' : 'Ver tabla';
  });
  // Enlace directo del prototipo: ?metric=dist|elev|time|speed, ?sel=0..11 y ?tabla=1
  var q = new URLSearchParams(location.search), qm = q.get('metric'), qs = q.get('sel');
  if (M[qm]) { var qb = seg.querySelector('[data-value="' + qm + '"]'); if (qb) qb.click(); }
  if (qs !== null && /^\d+$/.test(qs)) sel = Math.min(11, +qs);
  if (q.get('tabla') === '1') tg.click();
  drawTable();
}

/* =====================================================================
   Arranque y redibujado al cambiar el ancho (giro del teléfono)
   ===================================================================== */
function drawAll() { drawHero(); drawMap(); drawTrend(); }
drawRideProfile();
drawWeek();
drawGoal();
setupTrend();
drawAll();
introHero();
if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(drawHero);   // la altura del saludo cambia al cargar la fuente
var lastW = innerWidth, timer = null;
addEventListener('resize', function () {
  clearTimeout(timer);
  timer = setTimeout(function () { if (innerWidth !== lastW) { lastW = innerWidth; drawAll(); } }, 80);
});
})();
