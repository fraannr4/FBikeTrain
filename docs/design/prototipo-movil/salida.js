/* =====================================================================
   Detalle de una salida (prototipo móvil).
   Mapa a todo el ancho, las cuatro cifras, perfil táctil sincronizado con
   el mapa, comparación con tus salidas de 12 meses, subidas detectadas y
   rutas parecidas.
   Estados por URL: ?state=loading | error | empty (empty = salida sin GPS).
   En la app:
   - perfil y subidas: buildProfile() y detectClimbs(); colores, gradeSegments() (D4);
   - «tu mejor aquí»: groupClimbs(); «la misma ruta»: groupRoutes();
   - «parecidas»: routeSimilarity() entre 0,3 y 0,6 (petición D9: hoy solo se
     agrupan las de 0,6 o más);
   - «Media para ti»: difficulty() para salidas (D5).
   ===================================================================== */
(function () {
'use strict';
var F = window.FBT, doc = document, NB = ' ';
var Q = new URLSearchParams(location.search);
var STATE = { vacio: 'empty', 'sin-gps': 'empty', carga: 'loading', cargando: 'loading' }[Q.get('estado')] || Q.get('state') || Q.get('estado') || '';

/* ---------- La salida (sintética) ---------- */
var RIDE = { name: 'Collsuspina y Moià', when: 'Ayer, jueves 5 de noviembre, a las 9:12', km: 87.6, m: 1542, min: 192, shape: 3 };
if (STATE === 'empty') RIDE = { name: 'Salida por la tarde', when: 'Martes 27 de octubre, a las 17:40', km: 42.0, m: 380, min: 98, shape: 0 };
/* Pruebas de casos extremos: ?nombre=<texto> (nombre largo, otro alfabeto) y ?km=<n> (salida larga:
   tras Vic sigue un llano ondulado hasta n km y las subidas quedan apretadas al principio) */
if (Q.get('nombre')) RIDE.name = Q.get('nombre');
var LONG_KM = STATE ? 0 : +Q.get('km') > RIDE.km ? +Q.get('km') : 0;
RIDE.kmh = RIDE.km / (RIDE.min / 60);

/* Perfil: puntos de paso (km, m) de Vic a Collsuspina, Moià y vuelta; cada 0,4 km */
var KEY = [[0, 487], [3, 505], [6, 522], [9, 548], [12, 540], [15, 562], [18.6, 585], [20.5, 640], [22.4, 702], [23.6, 760], [25.8, 915], [27.5, 890],
  [30, 858], [33, 812], [36, 786], [38.5, 768], [41, 735], [44, 690], [47, 648], [50.2, 612], [51.4, 640], [52.6, 694], [54, 742], [55.2, 856],
  [56.4, 902], [58, 888], [61, 820], [64, 742], [67, 690], [70, 640], [72.2, 602], [73.4, 640], [74.6, 718], [75.6, 768], [77, 752], [80, 690],
  [83, 600], [86, 520], [87.6, 489]];
if (LONG_KM) {
  for (var x = 95; x < LONG_KM - 4; x += 8) KEY.push([x, 489 + 40 * Math.sin(x / 13)]);
  KEY.push([LONG_KM, 489]);
  RIDE.min = Math.round(RIDE.min * LONG_KM / RIDE.km); RIDE.m = Math.round(RIDE.m * 1.4); RIDE.km = LONG_KM;
}
var STEP = 0.4, N = Math.round(RIDE.km / STEP) + 1, EL = [];
for (var i = 0; i < N; i++) {
  var k = Math.min(RIDE.km, i * STEP), j = 0;
  while (j < KEY.length - 2 && KEY[j + 1][0] < k) j++;
  var a = KEY[j], b = KEY[j + 1], t = (k - a[0]) / (b[0] - a[0]);
  EL.push(a[1] + (b[1] - a[1]) * t + 1.2 * Math.sin(k * 0.9));   // ya suavizado, como buildProfile (ventana de 100 m)
}
var CLIMBS = [
  { from: 18.6, to: 25.8, best: { txt: 'Tu mejor: 23:40 <span class="nw">(12 oct)</span>' } },
  { from: 50.2, to: 56.4, best: { me: true, txt: 'Tu mejor tiempo aquí' } },
  { from: 72.2, to: 75.6, best: { first: true, txt: 'La primera vez' } }
];

/* ---------- Utilidades ---------- */
function ic(n, c) { return F.icon(n, c); }
function idx(km) { return Math.max(0, Math.min(N - 1, Math.round(km / STEP))); }
function gradeAt(i) { var a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1); return ((EL[b] - EL[a]) / ((b - a) * STEP * 1000)) * 100; }
function gcls(g) { return g < 1 ? 0 : g < 4 ? 1 : g < 7 ? 2 : g < 10 ? 3 : g < 16 ? 4 : 5; }
function ord(n) { return n + '.ª'; }
function pct(x) {                                      // más de +200 % (el triple) ya no se lee como porcentaje
  var v = Math.round(x * 100);
  if (v > 200) return 'Más del triple';
  return (v > 0 ? '+' : v < 0 ? '−' : '') + F.fmt(Math.abs(v)) + NB + '%';
}
var MIN = Math.min.apply(null, EL), MAX = Math.max.apply(null, EL), TOP = EL.indexOf(MAX);
var LO = MIN - (MAX - MIN) * 0.12, SPAN = MAX - LO;           // la misma escala que FBT.profile
/* Cada subida acaba en su cima: el máximo local del perfil a ±0,4 km del punto de paso
   (como detectClimbs en la app). Así «Cima 911 m en el km 26,0» y «Del km 18,6 al 26,0» cuadran. */
CLIMBS.forEach(function (c) {
  var i = idx(c.to), best = i;
  for (var q = Math.max(0, i - 1); q <= Math.min(N - 1, i + 1); q++) if (EL[q] > EL[best]) best = q;
  c.to = +(best * STEP).toFixed(1);
});
function yFrac(v) { return (72 - ((v - LO) / SPAN) * 68) / 72; }

/* Subidas: cifras sacadas del mismo perfil (longitud, desnivel, pendiente, tiempo y VAM) */
CLIMBS.forEach(function (c, n) {
  var i0 = idx(c.from), i1 = idx(c.to);
  c.n = n + 1; c.len = c.to - c.from; c.gain = EL[i1] - EL[i0]; c.avg = c.gain / (c.len * 10);
  var mx = 0; for (var i = i0 + 1; i < i1; i++) { mx = Math.max(mx, ((EL[i + 1] - EL[i - 1]) / (2 * STEP * 1000)) * 100); }
  c.max = mx; c.cls = gcls(c.avg);
  var v = Math.max(9, 27 - 2 * c.avg);                         // km/h en la subida (modelo del prototipo)
  c.sec = (c.len / v) * 3600; c.vam = c.gain / (c.sec / 3600);
});

/* ---------- Estados ---------- */
var main = doc.getElementById('main'), back = doc.getElementById('volver');
if (STATE === 'loading') {
  back.classList.remove('icon-btn--glass');
  main.setAttribute('aria-busy', 'true');
  doc.getElementById('appbar-t').textContent = '';      // el nombre aún no se ha leído: no se anuncia
  main.innerHTML = '<span class="sr-only">Cargando la salida…</span><div class="ride-top" aria-hidden="true">' +
    '<div class="ride-map"><span class="sk sk-map" style="display:block"></span></div>' +
    '<div class="ride-head"><span class="sk sk-title" style="width:70%;height:34px"></span><span class="sk sk-line" style="width:58%"></span></div>' +
    '<div class="sk-figs"><span class="sk"></span><span class="sk"></span><span class="sk"></span><span class="sk"></span></div></div>' +
    '<div class="section" aria-hidden="true"><span class="sk sk-title" style="width:30%"></span><span class="sk sk-box" style="height:150px"></span></div>';
  return;
}
if (STATE === 'error') {
  back.classList.remove('icon-btn--glass');
  doc.getElementById('appbar-t').textContent = '';      // el h1 ya dice «Salida»: no se repite en la barra
  main.classList.add('ride--plain');
  main.innerHTML = '<div class="page-head"><h1 class="page-title">Salida</h1></div>' +
    '<div class="card"><div class="state state--error"><span class="state-ic">' + ic('alert') + '</span>' +
    '<h2 class="state-title">Esta salida ya no está en tus datos</h2>' +
    '<p class="state-text">Puede que se borrara al volver a importar el archivo de Strava. Búscala en el historial por su nombre.</p>' +
    '<a class="btn btn--primary" href="historial.html">' + ic('chart') + 'Ir al historial</a></div></div>';
  return;
}

/* ---------- Cabecera y cifras ---------- */
(function title() {
  var h = doc.getElementById('titulo');
  h.classList.toggle('is-long', RIDE.name.length > 40);
  h.textContent = RIDE.name;
  // Si pasa de 3 líneas se recorta y un toque lo despliega (y lo vuelve a recoger)
  var lh = parseFloat(getComputedStyle(h).lineHeight) || 36;
  if (h.scrollHeight <= lh * 3 + 4) return;
  h.textContent = '';
  var b = doc.createElement('button');
  b.type = 'button'; b.className = 'title-btn'; b.setAttribute('aria-expanded', 'false');
  b.innerHTML = '<span class="title-txt"></span><span class="sr-only">, ver el nombre completo</span>';
  b.firstChild.textContent = RIDE.name;
  b.addEventListener('click', function () { b.setAttribute('aria-expanded', String(b.getAttribute('aria-expanded') !== 'true')); });
  h.appendChild(b);
})();
doc.getElementById('appbar-t').textContent = RIDE.name;
doc.getElementById('cuando').textContent = RIDE.when;
var hmP = F.dur(RIDE.min * 60, 'hm').split(' h ');
doc.getElementById('cifras').innerHTML =
  '<div data-m="dist"><dt>' + ic('bike') + 'Distancia</dt><dd class="fig-i">' + F.fmt(RIDE.km, 1) + '<span class="u">km</span></dd></div>' +
  '<div data-m="elev"><dt>' + ic('mountain') + 'Desnivel</dt><dd>' + F.fmt(RIDE.m) + '<span class="u">m</span></dd></div>' +
  '<div data-m="time"><dt>' + ic('timer') + 'Tiempo</dt><dd>' + hmP[0] + '<span class="u">h</span>' + hmP[1] + '</dd></div>' +
  '<div data-m="speed"><dt>' + ic('gauge') + 'Media</dt><dd>' + F.fmt(RIDE.kmh, 1) + '<span class="u">km/h</span></dd></div>';

/* ---------- Frente a tu media: 12 meses de salidas sintéticas ---------- */
(function compare() {
  var s = 20251106, r = function () { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  var g = function () { return Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r()); };
  var all = [];
  for (var i = 0; i < 75; i++) {
    // Media de las 75: 74 km y 1050 m, la «salida media» de IA y Calendario
    var km = Math.max(24, Math.min(126, 74.7 + 21 * g())), kmh = Math.max(20.5, Math.min(29.5, 25.1 + 1.5 * g()));
    all.push({ km: km, m: Math.max(120, Math.min(2300, km * 13.84 * (0.55 + r() * 0.95))), min: km / kmh * 60, kmh: kmh });
  }
  var M = [
    { k: 'km', m: 'dist', ic: 'bike', l: 'Distancia', f: function (v) { return F.fmt(v, 1) + NB + 'km'; }, rank: 'más larga', rankLow: 'más corta' },
    { k: 'm', m: 'elev', ic: 'mountain', l: 'Desnivel', f: function (v) { return F.fmt(Math.round(v)) + NB + 'm'; }, rank: 'con más desnivel', rankLow: 'con menos desnivel' },
    { k: 'min', m: 'time', ic: 'timer', l: 'Tiempo en movimiento', f: function (v) { return F.dur(v * 60, 'hm'); }, rank: 'más larga en tiempo', rankLow: 'más corta en tiempo' },
    { k: 'kmh', m: 'speed', ic: 'gauge', l: 'Velocidad media', f: function (v) { return F.fmt(v, 1) + NB + 'km/h'; }, rank: 'más rápida', rankLow: 'más lenta' }
  ];
  var html = M.map(function (d) {
    var vals = all.map(function (x) { return x[d.k]; }), me = RIDE[d.k];
    var mean = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    var lo = Math.min.apply(null, vals.concat(me)), hi = Math.max.apply(null, vals.concat(me));
    var X = function (v) { return ((v - lo) / (hi - lo)) * 100; };
    var rank = 1 + vals.filter(function (v) { return v > me; }).length, total = vals.length + 1;
    // En la mitad baja se cuenta desde abajo: «la 18.ª más corta», no «la 59.ª más larga»
    var low = rank > total / 2, n = low ? 1 + vals.filter(function (v) { return v < me; }).length : rank;
    var rankTxt = (n === 1 ? '' : ord(n) + ' ') + (low ? d.rankLow : d.rank);
    var delta = me / mean - 1, up = delta >= 0;
    // Puntos en carriles para que no se tapen (enjambre sencillo): 5 carriles, 4 % de hueco
    var lanes = [[], [], [], [], []], order = [2, 1, 3, 0, 4];
    var dots = vals.slice().sort(function (a, b) { return a - b; }).map(function (v) {
      var x = X(v), L = 2;
      for (var o = 0; o < order.length; o++) {
        var ln = lanes[order[o]];
        if (!ln.length || x - ln[ln.length - 1] > 3.2) { L = order[o]; break; }
      }
      lanes[L].push(x);
      return '<i style="left:' + x.toFixed(2) + '%;top:' + (5 + L * 6) + 'px"></i>';
    }).join('');
    var label = d.l + ': ' + d.f(me) + ', la ' + rankTxt + ' de tus ' + total + ' salidas en 12 meses. Tu media es ' + d.f(mean) + '.';
    return '<div class="cmp-row" data-m="' + d.m + '">' +
      '<div class="cmp-h"><p class="cmp-l">' + ic(d.ic) + d.l + '</p>' +
        '<p class="delta ' + (up ? 'delta--up' : 'delta--down') + '">' + ic(up ? 'up' : 'down') + pct(delta) + '</p></div>' +
      '<div class="cmp-strip" role="img" aria-label="' + label + '">' + dots +
        '<b style="left:' + X(mean).toFixed(2) + '%"></b><em style="left:' + X(me).toFixed(2) + '%"></em></div>' +
      '<p class="cmp-foot">La <b>' + rankTxt + '</b> de tus ' + total + ' salidas en 12 meses. Tu media: ' + d.f(mean) + '.</p>' +
    '</div>';
  }).join('');
  doc.getElementById('cmp').innerHTML = '<div class="legend cmp-legend" aria-hidden="true">' +
    '<span><i class="k-dot"></i>Tus salidas de los últimos 12 meses</span><span><i class="k-mean"></i>Tu media</span><span><i class="k-me"></i>Esta salida</span></div>' + html;
})();

/* ---------- Sin GPS: sin mapa, sin perfil, sin subidas y sin parecidas ---------- */
if (STATE === 'empty') {
  back.classList.remove('icon-btn--glass');
  ['mapa', 'sec-perfil', 'sec-subidas', 'sec-parecidas', 'chip-mejor'].forEach(function (id) { var n = doc.getElementById(id); if (n) n.remove(); });
  var chips = doc.getElementById('chips');
  chips.innerHTML = '<span class="chip chip--easy"><svg class="ic bars" aria-hidden="true"><use href="#i-bars1"/></svg>Suave para ti</span>';
  main.classList.add('ride--plain');
  doc.getElementById('top').insertAdjacentHTML('afterend',
    '<div class="banner banner--warn">' + ic('warn') + '<p><b>Esta salida no tiene GPS.</b> Por eso no hay mapa, perfil ni subidas. Sus cifras sí cuentan en tu historial y en tus objetivos.</p></div>');
  doc.getElementById('top').style.paddingTop = '8px';
  return;
}

/* ---------- Perfil por pendiente ---------- */
var svgP = doc.getElementById('perfil'), scrub = doc.getElementById('scrub'), read = doc.getElementById('lectura');
var classes = F.profile(svgP, EL, RIDE.km);
var NAMES = ['Llano o bajada', '1-4 %', '4-7 %', '7-10 %', '10-16 %', '16 % o más'];
doc.getElementById('lg-perfil').innerHTML = classes.map(function (c) { return '<span><i style="background:var(--g' + c + ')"></i>' + NAMES[c] + '</span>'; }).join('');
doc.getElementById('rejilla').innerHTML = [600, 800].map(function (v) {
  return '<span style="top:' + (yFrac(v) * 100).toFixed(2) + '%"><b>' + v + NB + 'm</b></span>';
}).join('');
CLIMBS.forEach(function (c) {
  var i0 = idx(c.from), i1 = idx(c.to);
  scrub.insertAdjacentHTML('beforeend',
    '<span class="scrub-band" aria-hidden="true" style="left:' + (i0 / (N - 1) * 100).toFixed(2) + '%;width:' + ((i1 - i0) / (N - 1) * 100).toFixed(2) + '%"></span>');
});
/* Eje de km proporcional: 0, marcas redondas y el total al final */
(function axis() {
  var stepKm = [10, 20, 25, 50, 100, 200].filter(function (v) { return RIDE.km / v <= 4.5; })[0] || 500, html = '<span>0</span>';
  for (var v = stepKm; v < RIDE.km - stepKm * 0.6; v += stepKm) html += '<span style="left:' + (v / RIDE.km * 100).toFixed(2) + '%">' + v + '</span>';
  doc.getElementById('eje').innerHTML = html + '<span class="is-end" style="left:100%">' + F.fmt(RIDE.km, 1) + NB + 'km</span>';
  scrub.setAttribute('aria-valuemax', RIDE.km.toFixed(1));
})();

/* Chinchetas del perfil: las que se tocarían (menos de 28 px entre centros, o píldoras que se
   pisan) se fusionan en una sola, «2·3», sobre la cima más alta y con el color de la más dura */
function liftPins() {
  var w = scrub.clientWidth, h = scrub.clientHeight, groups = [];
  if (!w) return;
  CLIMBS.forEach(function (c) {
    var i = idx(c.to), x = i / (N - 1) * w, y = yFrac(EL[i]) * h;
    var g = groups.filter(function (q) { return Math.abs(q.y - y) < 26 && Math.abs(q.x - x) < q.half + 12 + 4; }).pop();
    if (g) {
      g.xs.push(x); g.n.push(c.n); g.cls = Math.max(g.cls, c.cls); g.y = Math.min(g.y, y);
      g.x = (Math.min.apply(null, g.xs) + Math.max.apply(null, g.xs)) / 2;
    } else groups.push(g = { xs: [x], x: x, y: y, n: [c.n], cls: c.cls });
    g.half = Math.max(12, (10 + g.n.join('·').length * 8) / 2);
  });
  Array.prototype.forEach.call(scrub.querySelectorAll('.scrub-pin'), function (n) { n.remove(); });
  scrub.insertAdjacentHTML('beforeend', groups.map(function (g) {
    var x = Math.max(g.half, Math.min(w - g.half, g.x));       // la píldora no se sale por los lados
    return '<span class="scrub-pin" aria-hidden="true" style="--pin:var(--g' + g.cls + ');left:' + x.toFixed(1) + 'px;top:' + g.y.toFixed(1) + 'px">' + g.n.join('·') + '</span>';
  }).join(''));
}
liftPins();
var line = scrub.querySelector('.scrub-line'), dot = scrub.querySelector('.scrub-dot');
var cur = -1;
function readDefault() {
  read.innerHTML = '<span>Cima <b>' + F.fmt(Math.round(MAX)) + '</b>m</span><span>en el km <b>' + F.fmt(TOP * STEP, 1) + '</b></span>';
  scrub.setAttribute('aria-valuenow', (TOP * STEP).toFixed(1));
  scrub.setAttribute('aria-valuetext', 'Cima: ' + F.fmt(Math.round(MAX)) + ' m en el km ' + F.fmt(TOP * STEP, 1) + '. Usa las flechas para recorrer el perfil.');
}
function show(i) {
  i = Math.max(0, Math.min(N - 1, i));
  if (i === cur) return; cur = i;
  var w = scrub.clientWidth, h = scrub.clientHeight, x = (i / (N - 1)) * w, g = gradeAt(i), km = i * STEP;
  line.style.transform = 'translateX(' + x + 'px)';
  dot.style.transform = 'translate(' + x + 'px,' + (yFrac(EL[i]) * h) + 'px)';
  scrub.classList.add('is-on');
  read.innerHTML = '<span>km <b>' + F.fmt(km, 1) + '</b></span><span><b>' + F.fmt(Math.round(EL[i])) + '</b>m</span>' +
    '<span><i class="sw" style="background:var(--g' + gcls(g) + ')"></i><b>' + (g < 0 ? '−' : '') + F.fmt(Math.abs(g), 1) + '</b>%</span>';
  scrub.setAttribute('aria-valuenow', km.toFixed(1));
  scrub.setAttribute('aria-valuetext', 'km ' + F.fmt(km, 1) + ': ' + F.fmt(Math.round(EL[i])) + ' metros, pendiente del ' + F.fmt(g, 1) + ' %');
  mapCursor(i / (N - 1));
}
function fromPointer(e) { var r = scrub.getBoundingClientRect(); show(Math.round(((e.clientX - r.left) / r.width) * (N - 1))); }
var dragging = false;
scrub.addEventListener('pointerdown', function (e) { if (e.button > 0) return; dragging = true; fromPointer(e); });
scrub.addEventListener('pointermove', function (e) { if (dragging || e.pointerType === 'mouse') fromPointer(e); });
['pointerup', 'pointercancel'].forEach(function (ev) { scrub.addEventListener(ev, function () { dragging = false; }); });
scrub.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { dragging = false; } });
scrub.addEventListener('keydown', function (e) {
  var step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 12, PageDown: -12 }[e.key];
  var start = cur < 0 ? TOP : cur;
  if (step) { show(start + step); e.preventDefault(); }
  else if (e.key === 'Home') { show(0); e.preventDefault(); }
  else if (e.key === 'End') { show(N - 1); e.preventDefault(); }
});
readDefault();

/* ---------- Mapa (SVG en píxeles reales; en la app, Leaflet con CyclOSM) ---------- */
var PTS = F.synth.route(RIDE.shape);
var maps = [];
function drawMap(svg, topInset) {
  var w = svg.clientWidth, h = svg.clientHeight;
  if (!w || !h) return null;
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  var xs = PTS.map(function (p) { return p[0]; }), ys = PTS.map(function (p) { return p[1]; });
  var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
  var padX = 36, top = topInset + 16, bottom = 52;
  var s = Math.min((w - padX * 2) / (x1 - x0), (h - top - bottom) / (y1 - y0));
  var ox = w / 2 - ((x0 + x1) / 2) * s, oy = top + (h - top - bottom) / 2 - ((y0 + y1) / 2) * s;
  var P = PTS.map(function (p) { return [p[0] * s + ox, p[1] * s + oy]; });
  var cum = [0]; for (var i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  var L = cum[cum.length - 1];
  function at(f) {
    var d = f * L, k = 1; while (k < cum.length - 1 && cum[k] < d) k++;
    var t = (d - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1);
    return [P[k - 1][0] + (P[k][0] - P[k - 1][0]) * t, P[k - 1][1] + (P[k][1] - P[k - 1][1]) * t];
  }
  function seg(f0, f1) { var o = [], n = 24; for (var q = 0; q <= n; q++) o.push(at(f0 + (f1 - f0) * q / n)); return o; }
  function path(pts) { return pts.map(function (p, q) { return (q ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(''); }
  // Relieve: curvas de nivel alrededor de las dos cimas
  var hills = [at(CLIMBS[0].to / RIDE.km), at(CLIMBS[1].to / RIDE.km)], cont = '';
  hills.forEach(function (c, hI) {
    [16, 32, 50, 70, 94, 120].forEach(function (rr, rI) {
      var d = '';
      for (var a = 0; a <= 48; a++) {
        var th = a / 48 * Math.PI * 2, rad = rr * (1 + 0.16 * Math.sin(3 * th + hI * 2 + rI) + 0.08 * Math.sin(5 * th + rI));
        d += (a ? 'L' : 'M') + (c[0] + Math.cos(th) * rad * 1.25).toFixed(1) + ' ' + (c[1] + Math.sin(th) * rad).toFixed(1);
      }
      cont += '<path class="contour" d="' + d + 'Z"/>';
    });
  });
  // Carreteras de fondo: unas pocas curvas que cruzan el mapa
  var roads = '', rs = 7;
  var rr2 = function () { rs = (rs * 9301 + 49297) % 233280; return rs / 233280; };
  for (var q = 0; q < 6; q++) {
    var vertical = q % 2, a0 = rr2(), a1 = rr2(), c0 = rr2(), c1 = rr2();
    roads += '<path class="road' + (q === 1 ? ' road--main' : '') + '" d="' + (vertical
      ? 'M' + (a0 * w) + ' -10C' + (c0 * w) + ' ' + h * 0.35 + ' ' + (c1 * w) + ' ' + h * 0.65 + ' ' + (a1 * w) + ' ' + (h + 10)
      : 'M-10 ' + (a0 * h) + 'C' + w * 0.35 + ' ' + (c0 * h) + ' ' + w * 0.65 + ' ' + (c1 * h) + ' ' + (w + 10) + ' ' + (a1 * h)) + '"/>';
  }
  var d = path(P);
  var climbs = CLIMBS.map(function (c) { return '<path class="climb" style="stroke:var(--g' + c.cls + ')" d="' + path(seg(c.from / RIDE.km, c.to / RIDE.km)) + '"/>'; }).join('');
  // Chinchetas a menos de 24 px se fusionan en una sola («2·3»), con el color de la más dura
  var groups = [];
  CLIMBS.forEach(function (c) {
    var p = at(c.to / RIDE.km), g = groups.filter(function (q) { return Math.hypot(q.p[0] - p[0], q.p[1] - p[1]) < 24; })[0];
    if (g) { g.n.push(c.n); g.cls = Math.max(g.cls, c.cls); } else groups.push({ p: p, n: [c.n], cls: c.cls });
  });
  var pins = groups.map(function (g) {
    var x = g.p[0].toFixed(1), y = g.p[1].toFixed(1), txt = g.n.join('·'), st = ' style="stroke:var(--g' + g.cls + ')"';
    var body = g.n.length === 1 ? '<circle r="11" cx="' + x + '" cy="' + y + '"' + st + '/>'
      : '<rect x="' + (g.p[0] - 7 - txt.length * 4).toFixed(1) + '" y="' + (g.p[1] - 11).toFixed(1) + '" width="' + (14 + txt.length * 8) + '" height="22" rx="11"' + st + '/>';
    return '<g class="pin">' + body + '<text x="' + x + '" y="' + y + '">' + txt + '</text></g>';
  }).join('');
  // Rótulo de un pueblo: de las cuatro esquinas posibles, la que menos trazado y chinchetas pisa
  var avoid = P.concat(groups.map(function (g) { return g.p; }));
  var st = P[0], town = function (p, txt) {
    var tw = txt.length * 7.4, best = null;
    [[14, 4, 'start'], [-14, 4, 'end'], [12, -12, 'start'], [-12, -12, 'end'], [12, 20, 'start'], [-12, 20, 'end']].forEach(function (o) {
      var x0 = o[2] === 'start' ? p[0] + o[0] : p[0] + o[0] - tw, y0 = p[1] + o[1] - 11;
      var hits = avoid.filter(function (q) { return q[0] > x0 - 4 && q[0] < x0 + tw + 4 && q[1] > y0 - 4 && q[1] < y0 + 15; }).length;
      if (x0 < 4 || x0 + tw > w - 4) hits += 1000;                 // que no se salga del mapa
      if (!best || hits < best.hits) best = { hits: hits, o: o };
    });
    var o = best.o;
    return '<text class="town" x="' + (p[0] + o[0]).toFixed(1) + '" y="' + (p[1] + o[1]).toFixed(1) + '" text-anchor="' + o[2] + '">' + txt + '</text>';
  };
  var moia = at(38.5 / RIDE.km), coll = at(CLIMBS[0].to / RIDE.km);
  svg.innerHTML = '<rect width="' + w + '" height="' + h + '" fill="var(--map-under)"/>' + '<g>' + cont + '</g>' + roads +
    '<path class="halo" d="' + d + '"/><path class="core" d="' + d + '"/>' + climbs + '<path class="thread" d="' + d + '"/>' +
    town(st, 'Vic') + town(coll, 'Collsuspina') + town(moia, 'Moià') +
    '<circle class="start" r="6" cx="' + st[0].toFixed(1) + '" cy="' + st[1].toFixed(1) + '"/>' + pins +
    '<circle class="cur" r="7" cx="0" cy="0"/>';
  return { svg: svg, at: at, cur: svg.querySelector('.cur') };
}
function mapCursor(f) {
  maps.forEach(function (m) { if (!m) return; var p = m.at(f); m.cur.setAttribute('cx', p[0].toFixed(1)); m.cur.setAttribute('cy', p[1].toFixed(1)); m.cur.classList.add('on'); });
}
var bar = doc.querySelector('.appbar');
function paintMaps() {
  liftPins();
  maps = [drawMap(doc.getElementById('map-svg'), bar.offsetHeight), drawMap(doc.getElementById('map-big'), 0)];
  if (cur >= 0) { var c = cur; cur = -1; show(c); }
}
paintMaps();
doc.querySelector('[data-sheet-open="hoja-mapa"]').addEventListener('click', function () { requestAnimationFrame(paintMaps); });
if ('ResizeObserver' in window) {
  var rT = null;
  new ResizeObserver(function () { clearTimeout(rT); rT = setTimeout(paintMaps, 60); }).observe(doc.getElementById('mapa'));
}

/* ---------- Subidas ---------- */
doc.getElementById('subidas').innerHTML = CLIMBS.map(function (c) {
  var b = c.best, cls = b.me ? ' is-best' : '';
  return '<li><a class="row" href="subidas.html">' +
    '<span class="row-lead climb-n" style="--pin:var(--g' + c.cls + ')"><span class="sr-only">Subida </span>' + c.n + '</span>' +
    '<span class="row-main"><span class="row-title">Del km ' + F.fmt(c.from, 1) + ' al ' + F.fmt(c.to, 1) + '</span>' +
      '<span class="row-meta">' + F.fmt(c.len, 1) + NB + 'km al ' + F.fmt(c.avg, 1) + NB + '%, máx. ' + F.fmt(c.max, 0) + NB + '%</span>' +
      '<span class="row-meta climb-best' + cls + '">' + ic(b.me ? 'flag' : b.first ? 'sparkles' : 'clock') + b.txt + '</span></span>' +
    '<span class="row-trail"><span class="row-figs"><span class="row-val">' + F.dur(c.sec, 'clock') + '</span>' +
      '<span class="row-sub">VAM ' + F.fmt(Math.round(c.vam)) + '</span></span>' + ic('chev', 'chev') + '</span>' +
  '</a></li>';
}).join('');

/* ---------- Rutas parecidas ---------- */
var SIM = [
  { name: 'Lluçanès por Prats', share: 48, km: 86.4, m: 1320, seed: 5 },
  { name: 'Santa Maria de Besora', share: 35, km: 78.3, m: 1420, seed: 37 },
  { name: 'Sant Pere de Casserres', share: 31, km: 63.5, m: 760, seed: 31 }
];
var simEl = doc.getElementById('parecidas');
simEl.innerHTML = SIM.map(function (r) {
  return '<li><a class="row" href="salida.html">' +
    '<span class="row-lead row-lead--shape"><svg class="shape" aria-hidden="true" data-sim="' + r.seed + '"></svg></span>' +
    '<span class="row-main"><span class="row-title">' + r.name + '</span><span class="row-meta"><span class="share">Coincide en un ' + r.share + NB + '%</span></span></span>' +
    '<span class="row-trail"><span class="row-val">' + F.fmt(r.km, 1) + '<span class="u">km</span></span>' + ic('chev', 'chev') + '</span>' +
  '</a></li>';
}).join('');
Array.prototype.forEach.call(simEl.querySelectorAll('svg[data-sim]'), function (s) { F.shape(s, F.synth.route(+s.dataset.sim)); });
})();
