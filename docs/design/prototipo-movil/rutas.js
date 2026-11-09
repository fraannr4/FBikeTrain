/* =====================================================================
   FBikeTrain móvil: Rutas (rutas.html) y Rutas con IA (ia.html).
   Se carga después de movil.js. Datos sintéticos (Cataluña interior), sin
   domicilio: «Casa» es solo una etiqueta. Estados por URL:
     rutas.html?state=empty|nodata|loading|error|nokey|quota
     ia.html?state=empty|loading|error|nokey  y  ?paso=1|2|3|resumen|propuestas
   (también vale ?estado=vacio|sinsalidas|carga|error|sinclave|cuota).
   ===================================================================== */
(function () {
'use strict';
var FBT = window.FBT, doc = document, ic = FBT.icon, fmt = FBT.fmt;
function $(s, c) { return (c || doc).querySelector(s); }
function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }
var Q = new URLSearchParams(location.search);
var ALIAS = { vacio: 'empty', sinsalidas: 'nodata', carga: 'loading', cargando: 'loading', sinclave: 'nokey', cuota: 'quota' };
var STATE = Q.get('state') || Q.get('estado') || '';
STATE = ALIAS[STATE] || STATE;
var NB = ' ';   // espacio duro: la cifra y su unidad no se separan nunca

/* ---------- Modelo: tiempo a tu ritmo y dificultad para ti ----------
   Tu velocidad en llano ronda 31,5 km/h y cae 0,25 km/h por cada metro por km.
   Calibrado con tu última salida (Inicio): 87,6 km y 1.542 m dan 27,1 km/h y
   3 h 14 (real: 27,4 km/h, 3 h 12). La IA, las propuestas y Rutas usan este modelo.
   Dificultad: Suave por debajo de 11 m/km, Dura por encima de 18.
   Sin salidas importadas (GENERIC) no hay ritmo propio: 25 km/h y umbrales generales. */
var GENERIC = false, PACE = 25;
var MPK = { suave: 8, media: 14.5, dura: 21 };
function speed(mpk) { return 31.5 - 0.25 * mpk; }
function hours(km, m) { return GENERIC ? km / PACE : km / speed(m / km); }
function difOf(km, m) { var r = m / km; return r < 11 ? 1 : r <= 18 ? 2 : 3; }
var DIF = [null, ['chip--easy', 'Suave', 'suave'], ['chip--mid', 'Media', 'media'], ['chip--hard', 'Dura', 'dura']];
function hm(h) { var t = Math.round(h * 60); return [Math.floor(t / 60), ('0' + (t % 60)).slice(-2)]; }
function bars(n) { return '<svg class="ic bars" aria-hidden="true" focusable="false"><use href="#i-bars' + n + '"/></svg>'; }
function esc(s) { return String(s).replace(/[<>&'"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c]; }); }
function gradeClass(g) { return g < 1 ? 0 : g < 4 ? 1 : g < 7 ? 2 : g < 10 ? 3 : g < 16 ? 4 : 5; }

/* ---------- Nombre del GPX ----------
   El BSC200S y la app iGPSPORT cortan los nombres largos: slug de 40 caracteres
   como mucho, cortado en un límite de palabra, y siempre un sufijo único
   (n.º de ruta y fecha). Si el nombre no deja nada legible (otro alfabeto,
   solo emoji), «ruta-<n>-<aaaammdd>». El nombre completo va en <name>. */
function ymd() { var d = new Date(); return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
function slug(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function gpxFile(r, i) {
  var s = slug(r.n), tail = '-' + (i + 1) + '-' + ymd();
  if (s.length < 3) return 'ruta' + tail + '.gpx';
  if (s.length > 40) {
    var cut = s.slice(0, 41).lastIndexOf('-');
    s = (cut >= 12 ? s.slice(0, cut) : s.slice(0, 40)).replace(/-+$/, '');
  }
  return s + tail + '.gpx';
}

/* ---------- Formas sintéticas: cada ruta la suya ---------- */
function rnd(seed) { var s = seed * 9301 + 49297; return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
function smooth(p) { return p.map(function (q, i) { var a = p[Math.max(0, i - 1)], c = p[Math.min(p.length - 1, i + 1)]; return [(a[0] + 2 * q[0] + c[0]) / 4, (a[1] + 2 * q[1] + c[1]) / 4]; }); }
var SHAPES = {
  lazo: function (s) { return FBT.synth.loop(s); },
  'lazo-cola': function (s) {   // lazo con cola: sales, das la vuelta y vuelves por el mismo tramo
    var r = rnd(s), ph = r() * 6, out = [], loop = [], back = [], i;
    for (i = 0; i <= 12; i++) { var t = i / 12; out.push([0.16 * Math.sin(t * 5 + ph), 2.25 - t * 1.2]); }
    for (i = 0; i <= 72; i++) {
      var a = Math.PI / 2 + (i / 72) * Math.PI * 2, rad = 1 + 0.17 * Math.sin(3 * a + ph) + 0.07 * Math.sin(5 * a + ph * 2);
      loop.push([Math.cos(a) * rad * 1.2, 1.05 + (Math.sin(a) - 1) * rad * 0.95]);
    }
    for (i = 12; i >= 0; i--) { var u = i / 12; back.push([0.16 * Math.sin(u * 5 + ph) + 0.1, 2.25 - u * 1.2]); }
    return out.concat(smooth(loop), back);
  },
  ocho: function (s) {
    var r = rnd(s), ph = r() * 6, p = [];
    for (var i = 0; i <= 96; i++) {
      var a = (i / 96) * Math.PI * 2, w = 1 + 0.08 * Math.sin(7 * a + ph);
      p.push([Math.sin(a) * 1.5 * w, Math.sin(a) * Math.cos(a) * 1.15 * w + 0.12 * Math.sin(a * 3 + ph)]);
    }
    return smooth(p);
  },
  ida: function (s) {           // ida y vuelta: los dos sentidos separados
    var r = rnd(s), ph = r() * 6, go = [], ret = [], i;
    for (i = 0; i <= 40; i++) { var t = i / 40; go.push([t * 2.4, 0.3 * Math.sin(t * 4 + ph) + 0.1 * Math.sin(t * 11) - t * 0.9]); }
    for (i = 40; i >= 0; i--) { var u = i / 40; ret.push([u * 2.4 + 0.05, 0.3 * Math.sin(u * 4 + ph) + 0.1 * Math.sin(u * 11) - u * 0.9 + 0.1]); }
    return smooth(go).concat(smooth(ret));
  },
  triangulo: function (s) {
    var r = rnd(s), V = [[0, 0], [1.9, -0.55], [1.15, 1.25], [0, 0]], p = [];
    for (var k = 0; k < 3; k++) for (var i = 0; i < 24; i++) {
      var t = i / 24, a = V[k], b = V[k + 1], n = (r() - 0.5) * 0.09 + 0.07 * Math.sin(t * Math.PI * 3 + k);
      p.push([a[0] + (b[0] - a[0]) * t - (b[1] - a[1]) * n, a[1] + (b[1] - a[1]) * t + (b[0] - a[0]) * n]);
    }
    p.push(V[0]);
    return smooth(smooth(p));
  }
};
var FORMA = { lazo: 'un lazo', 'lazo-cola': 'un lazo con un tramo de ida y vuelta', ocho: 'un ocho', ida: 'ida y vuelta por el mismo valle', triangulo: 'un triángulo' };
var GRADES = ['llano', 'del 1 al 4' + NB + '%', 'del 4 al 7' + NB + '%', 'del 7 al 10' + NB + '%', 'del 10 al 16' + NB + '%', 'de más del 16' + NB + '%'];
var LEGEND = ['Llano o bajada', '1-4' + NB + '%', '4-7' + NB + '%', '7-10' + NB + '%', '10-16' + NB + '%', '16' + NB + '% o más'];

/* ---------- Perfil sintético que cuadra con el desnivel ----------
   Subidas en campana (r.climbs: [centro, anchura, peso] o, si no, una cada
   ~420 m de desnivel, hasta 8) y se escala hasta que la suma de lo que se
   sube sea r.m. Así 1.540 m no salen de dos repechos ni 10.000 m de un llano. */
function synthEl(r, n) {
  var R = rnd(r.seed * 3 + 1), C = r.climbs, i;
  if (!C) {
    var k = Math.max(1, Math.min(8, Math.round(r.m / 420)));
    C = [];
    for (i = 0; i < k; i++) C.push([0.08 + ((i + 0.5 + (R() - 0.5) * 0.5) / k) * 0.84, 0.035 + R() * 0.03, 0.55 + R() * 0.45]);
  }
  var raw = [];
  for (i = 0; i < n; i++) {
    var t = i / (n - 1), v = 0.02 * Math.sin(19 * t + r.seed);
    C.forEach(function (c) { v += c[2] * Math.exp(-Math.pow((t - c[0]) / c[1], 2)); });
    raw.push(v);
  }
  var mn = Math.min.apply(null, raw), up = 0;
  for (i = 1; i < n; i++) up += Math.max(0, raw[i] - raw[i - 1]);
  var s = r.m / (up || 1);
  return raw.map(function (v) { return Math.round(r.base + (v - mn) * s); });
}
function route(o) {
  o.h = hours(o.km, o.m); o.dif = difOf(o.km, o.m); o.tipo = o.tipo || 'Circular';
  o.el = synthEl(o, 120); o.top = Math.max.apply(null, o.el);
  return o;
}

/* ---------- Tarjeta de ruta ----------
   Orden: forma, nombre, etiquetas, cifras y perfil; la explicación de la IA,
   al final y recortada a tres líneas, para que las tarjetas se comparen de un vistazo. */
function card(r, i, n, pre) {
  var id = pre + i, d = DIF[r.dif], t = hm(r.h), circ = r.tipo !== 'Ida y vuelta';
  var time = t[0] >= 10 ? t[0] + '<span class="u">h</span>' + t[1] : t[0] + '<span class="u">h</span>' + t[1] + '<span class="u">min</span>';
  return '<li><article class="rcard"' + (i === 0 ? ' data-best' : '') + ' aria-labelledby="' + id + '-t">' +
    '<div class="rcard-map" data-map="' + i + '">' +
      '<svg class="shape" data-k="' + i + '" role="img" aria-label="Forma de la ruta: ' + FORMA[r.kind] + '"></svg>' +
      '<span class="rcard-rank" aria-hidden="true">' + (i + 1) + '</span>' +
      '<button class="rcard-mapbtn" type="button" data-map="' + i + '" aria-haspopup="dialog" aria-label="Ver ' + esc(r.n) + ' en el mapa">' + ic('map') + '<span aria-hidden="true">Mapa</span></button>' +
      '<span class="chip rcard-kind">' + ic(circ ? 'repeat' : 'swap') + r.tipo + '</span>' +
    '</div>' +
    '<div class="rcard-body">' +
      '<div class="rcard-head">' +
        (i === 0 ? '<p class="rcard-best">' + ic('checkc') + 'La que mejor encaja</p>' : '') +
        '<h3 class="rcard-name" id="' + id + '-t" title="' + esc(r.n) + '" dir="auto"><span class="sr-only">Ruta ' + (i + 1) + ' de ' + n + ': </span>' + esc(r.n) + '</h3>' +
      '</div>' +
      '<div class="cluster rcard-chips">' +
        '<span class="chip ' + d[0] + '">' + bars(r.dif) + d[1] + (GENERIC ? '' : ' para ti') + '</span>' +
        (r.nueva > 0 ? '<span class="chip chip--new">' + ic('sparkles') + r.nueva + NB + '% carretera nueva</span>'
          : '<span class="chip">Todo ya rodado</span>') +
      '</div>' +
      '<dl class="rcard-figs">' +
        '<div><dt>Distancia</dt><dd><span class="fig-i">' + fmt(r.km, 1) + '</span><span class="u">km</span></dd></div>' +
        '<div><dt>Desnivel</dt><dd>' + fmt(r.m) + '<span class="u">m</span></dd></div>' +
        '<div><dt>' + (GENERIC ? 'A ' + PACE + NB + 'km/h' : 'A tu ritmo') + '</dt><dd>' + time + '</dd></div>' +
      '</dl>' +
      '<div class="rcard-prof">' +
        '<p class="rcard-prof-h"><span>Perfil por pendiente</span><span>cima <span class="fig">' + fmt(r.top) + '</span>' + NB + 'm</span></p>' +
        '<svg class="profile" data-k="' + i + '" role="img"></svg>' +
        '<div class="profile-axis" aria-hidden="true"><span>0</span><span>' + fmt(Math.round(r.km / 2)) + '</span><span>' + fmt(Math.round(r.km)) + NB + 'km</span></div>' +
        '<div class="legend" aria-hidden="true"></div>' +
      '</div>' +
      (r.why ? '<div class="rcard-why">' + ic('sparkles') +
        '<div class="rcard-why-main"><p class="rcard-why-t" id="' + id + '-why"><b>Por qué esta. </b>' + r.why + '</p>' +
        '<button class="btn btn--ghost rcard-more" type="button" aria-expanded="false" aria-controls="' + id + '-why" hidden>Leer más</button></div></div>' : '') +
      '<div class="rcard-actions"><button class="btn btn--primary btn--block" type="button" data-export="' + i + '">' + ic('download') + 'Exportar GPX</button></div>' +
    '</div></article></li>';
}
function legendOf(cls) { return cls.map(function (c) { return '<span><i style="background:var(--g' + c + ')"></i>' + LEGEND[c] + '</span>'; }).join(''); }
function paintProfile(svg, r) {
  var cls = FBT.profile(svg, r.el, r.km);
  svg.setAttribute('aria-label', 'Perfil: de ' + fmt(r.base) + ' a ' + fmt(r.top) + NB + 'm, con tramos ' + GRADES[cls[cls.length - 1]] + ' como máximo');
  return cls;
}
function render(list, routes, pre) {
  list.innerHTML = routes.map(function (r, i) { return card(r, i, routes.length, pre); }).join('');
  routes.forEach(function (r, i) {
    FBT.shape($('svg.shape[data-k="' + i + '"]', list), SHAPES[r.kind](r.seed));
    var svg = $('svg.profile[data-k="' + i + '"]', list);
    svg.parentNode.querySelector('.legend').innerHTML = legendOf(paintProfile(svg, r));
  });
  fitWhy(list);
}
/* «Leer más» solo si la explicación no cabe en tres líneas (se mide cuando se ve) */
function fitWhy(ctx) {
  $$('.rcard-why', ctx).forEach(function (w) {
    var t = $('.rcard-why-t', w), b = $('.rcard-more', w);
    if (w.classList.contains('is-open') || !t.clientHeight) return;
    b.hidden = t.scrollHeight <= t.clientHeight + 1;
  });
}
doc.addEventListener('click', function (e) {
  var b = e.target.closest('.rcard-more'); if (!b) return;
  var w = b.closest('.rcard-why'), open = !w.classList.contains('is-open');
  w.classList.toggle('is-open', open);
  b.setAttribute('aria-expanded', open ? 'true' : 'false');
  b.textContent = open ? 'Leer menos' : 'Leer más';
});
window.addEventListener('resize', function () { fitWhy(doc); });

/* ---------- Exportar GPX (la primera vez enseña cómo pasarlo al iGPSPORT) ---------- */
function trackPts(r) {   // puntos sintéticos alrededor de la Plana de Vic, a escala de la distancia
  var P = SHAPES[r.kind](r.seed), L = 0, i;
  for (i = 1; i < P.length; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  var k = r.km / (L || 1), lat0 = 41.9, lon0 = 2.3, cos = Math.cos(lat0 * Math.PI / 180), acc = 0, out = [];
  for (i = 0; i < P.length; i++) {
    if (i) acc += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    var e = r.el[Math.min(r.el.length - 1, Math.round((acc / (L || 1)) * (r.el.length - 1)))];
    out.push([(lat0 - (P[i][1] - P[0][1]) * k / 111.32).toFixed(5), (lon0 + (P[i][0] - P[0][0]) * k / (111.32 * cos)).toFixed(5), e]);
  }
  return out;
}
function gpxXml(r) {
  var name = esc(r.n);
  return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="FBikeTrain" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    '<metadata><name>' + name + '</name></metadata>\n<trk><name>' + name + '</name><trkseg>\n' +
    trackPts(r).map(function (p) { return '<trkpt lat="' + p[0] + '" lon="' + p[1] + '"><ele>' + p[2] + '</ele></trkpt>'; }).join('\n') +
    '\n</trkseg></trk>\n</gpx>\n';
}
function exportGpx(r, i) {
  var seen = false;
  try { seen = localStorage.getItem('fbt-gpx-ayuda') === '1'; localStorage.setItem('fbt-gpx-ayuda', '1'); } catch (e) { seen = true; }
  var file = gpxFile(r, i);
  try {
    var a = doc.createElement('a');
    a.href = URL.createObjectURL(new Blob([gpxXml(r)], { type: 'application/gpx+xml' }));
    a.download = file; doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  } catch (e) { /* sin descarga en este navegador: el aviso sigue sirviendo */ }
  $$('[data-gpx-file]').forEach(function (n) { n.textContent = file; });
  $$('[data-gpx-name]').forEach(function (n) { n.textContent = r.n; });
  if (!seen) FBT.sheet.open('hoja-gpx');
  else FBT.toast('GPX exportado: ' + file, { tone: 'good', action: { label: 'Cómo pasarlo', onClick: function () { FBT.sheet.open('hoja-gpx'); } } });
}

/* ---------- Ver en el mapa: trazado sobre CyclOSM y el perfil debajo ----------
   En el prototipo el mapa es un SVG que imita CyclOSM (relieve, carreteras y
   pueblos); en la app, Leaflet con las teselas de CyclOSM. Los tramos de 4 % o
   más se pintan sobre el trazado con el color de su pendiente. */
function drawMap(svg, r) {
  var w = svg.clientWidth, h = svg.clientHeight;
  if (!w || !h) return;
  var PTS = SHAPES[r.kind](r.seed), xs = PTS.map(function (p) { return p[0]; }), ys = PTS.map(function (p) { return p[1]; });
  var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
  var pad = 40, s = Math.min((w - pad * 2) / ((x1 - x0) || 1), (h - pad * 2) / ((y1 - y0) || 1));
  var ox = w / 2 - ((x0 + x1) / 2) * s, oy = h / 2 - ((y0 + y1) / 2) * s;
  var P = PTS.map(function (p) { return [p[0] * s + ox, p[1] * s + oy]; });
  var cum = [0], i;
  for (i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  var L = cum[cum.length - 1] || 1;
  function at(f) {
    var dd = f * L, k = 1; while (k < cum.length - 1 && cum[k] < dd) k++;
    var t = (dd - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1);
    return [P[k - 1][0] + (P[k][0] - P[k - 1][0]) * t, P[k - 1][1] + (P[k][1] - P[k - 1][1]) * t];
  }
  function path(pts) { return pts.map(function (p, q) { return (q ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(''); }
  // Relieve: curvas de nivel alrededor de la cima
  var el = r.el, n = el.length, iTop = el.indexOf(r.top), c = at(iTop / (n - 1)), cont = '';
  [18, 36, 58, 82, 110, 142].forEach(function (rr, rI) {
    var d = '';
    for (var a = 0; a <= 48; a++) {
      var th = a / 48 * Math.PI * 2, rad = rr * (1 + 0.16 * Math.sin(3 * th + r.seed + rI) + 0.08 * Math.sin(5 * th + rI));
      d += (a ? 'L' : 'M') + (c[0] + Math.cos(th) * rad * 1.25).toFixed(1) + ' ' + (c[1] + Math.sin(th) * rad).toFixed(1);
    }
    cont += '<path class="contour" d="' + d + 'Z"/>';
  });
  // Carreteras de fondo
  var roads = '', rs = r.seed;
  var rr2 = function () { rs = (rs * 9301 + 49297) % 233280; return rs / 233280; };
  for (var q = 0; q < 6; q++) {
    var v = q % 2, a0 = rr2(), a1 = rr2(), c0 = rr2(), c1 = rr2();
    roads += '<path class="road' + (q === 1 ? ' road--main' : '') + '" d="' + (v
      ? 'M' + (a0 * w) + ' -10C' + (c0 * w) + ' ' + h * 0.35 + ' ' + (c1 * w) + ' ' + h * 0.65 + ' ' + (a1 * w) + ' ' + (h + 10)
      : 'M-10 ' + (a0 * h) + 'C' + w * 0.35 + ' ' + (c0 * h) + ' ' + w * 0.65 + ' ' + (c1 * h) + ' ' + (w + 10) + ' ' + (a1 * h)) + '"/>';
  }
  // Tramos del 4 % o más, con su color
  var stepM = (r.km * 1000) / (n - 1), climbs = '', j = 0;
  while (j < n - 1) {
    var g = gradeClass(((el[j + 1] - el[j]) / stepM) * 100), e = j;
    while (e < n - 1 && gradeClass(((el[e + 1] - el[e]) / stepM) * 100) === g) e++;
    if (g >= 2) {
      var seg = []; for (var z = 0; z <= 16; z++) seg.push(at((j + (e - j) * z / 16) / (n - 1)));
      climbs += '<path class="climb" style="stroke:var(--g' + g + ')" d="' + path(seg) + '"/>';
    }
    j = e;
  }
  // Pueblos: el rótulo en la esquina que menos trazado pisa
  var town = function (p, txt) {
    var tw = txt.length * 7.4, best = null;
    [[14, 4, 'start'], [-14, 4, 'end'], [12, -12, 'start'], [-12, -12, 'end'], [12, 20, 'start'], [-12, 20, 'end']].forEach(function (o) {
      var bx = o[2] === 'start' ? p[0] + o[0] : p[0] + o[0] - tw, by = p[1] + o[1] - 11;
      var hits = P.filter(function (k) { return k[0] > bx - 4 && k[0] < bx + tw + 4 && k[1] > by - 4 && k[1] < by + 15; }).length;
      if (bx < 4 || bx + tw > w - 4) hits += 1000;
      if (bx < 230 && by + 15 > h - 46) hits += 500;               // la atribución, abajo a la izquierda
      if (!best || hits < best.hits) best = { hits: hits, o: o };
    });
    return '<circle class="dot" r="3" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '"/>' +
      '<text class="town" x="' + (p[0] + best.o[0]).toFixed(1) + '" y="' + (p[1] + best.o[1]).toFixed(1) + '" text-anchor="' + best.o[2] + '">' + esc(txt) + '</text>';
  };
  var towns = (r.towns || []).map(function (t) { return town(at(t[0]), t[1]); }).join('');
  var st = P[0], d = path(P);
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  svg.innerHTML = '<rect width="' + w + '" height="' + h + '" fill="var(--map-under)"/><g>' + cont + '</g>' + roads +
    '<path class="halo" d="' + d + '"/><path class="core" d="' + d + '"/>' + climbs + '<path class="thread" d="' + d + '"/>' + towns +
    town(st, 'Casa').replace('class="town"', 'class="town town--home"').replace(/^<circle[^>]*\/>/, '') +
    '<circle class="start" r="6" cx="' + st[0].toFixed(1) + '" cy="' + st[1].toFixed(1) + '"/>';
  svg.setAttribute('aria-label', 'Mapa de ' + r.n + ': ' + FORMA[r.kind] + ' desde Casa' +
    (r.towns && r.towns.length ? ', pasando por ' + r.towns.map(function (t) { return t[1]; }).join(', ') : '') + '. Los tramos de más pendiente van coloreados.');
}
function openMap(routes, i) {
  var r = routes[i], sheet = doc.getElementById('hoja-mapa');
  if (!sheet) return;
  sheet._route = i;
  $('#hoja-mapa-t').textContent = r.n;
  $('#hoja-mapa-sub').textContent = fmt(r.km, 1) + NB + 'km · ' + fmt(r.m) + NB + 'm · ' + r.tipo.toLowerCase() +
    (r.towns && r.towns.length ? ' · por ' + r.towns.map(function (t) { return t[1]; }).join(', ') : '');
  FBT.sheet.open('hoja-mapa');
  drawMap($('#rmap-svg'), r);
  var svg = $('#rmap-prof');
  $('#rmap-legend').innerHTML = legendOf(paintProfile(svg, r));
  $('#rmap-top').textContent = fmt(r.top);
  $('#rmap-axis').innerHTML = '<span>0</span><span>' + fmt(Math.round(r.km / 2)) + '</span><span>' + fmt(Math.round(r.km)) + NB + 'km</span>';
}

function wireResults(wrap, getRoutes, dockBtn) {
  var cur = 0;
  function sync(i) {
    cur = i;
    if (!dockBtn) return;
    var routes = getRoutes();
    $('.dock-tag', dockBtn).textContent = (i + 1) + ' de ' + routes.length;
    dockBtn.setAttribute('aria-label', 'Exportar GPX de ' + routes[i].n + ', ruta ' + (i + 1) + ' de ' + routes.length);
  }
  wrap.addEventListener('slidechange', function (e) { sync(e.detail.index); });
  wrap.addEventListener('click', function (e) {
    var b = e.target.closest('[data-export]');
    if (b) { exportGpx(getRoutes()[+b.dataset.export], +b.dataset.export); return; }
    var m = e.target.closest('[data-map]');
    if (m) openMap(getRoutes(), +m.dataset.map);
  });
  if (dockBtn) dockBtn.addEventListener('click', function () { exportGpx(getRoutes()[cur], cur); });
  var mapExp = doc.getElementById('mapa-export');
  if (mapExp && !mapExp._wired) {
    mapExp._wired = true;
    mapExp.addEventListener('click', function () {
      var i = doc.getElementById('hoja-mapa')._route || 0;
      FBT.sheet.close('hoja-mapa');
      setTimeout(function () { exportGpx(getRoutes()[i], i); }, FBT.reduced() ? 0 : 280);
    });
  }
  FBT.carousel(wrap).refresh();
}
function show(el, on) { if (el) el.hidden = !on; }

/* =====================================================================
   RUTAS
   ===================================================================== */
function rutasPage() {
  GENERIC = STATE === 'nodata';
  var req = { km: 90, m: 1500, salida: 'casa', tipo: 'circular', nueva: true };
  /* climbs: [centro, anchura, peso]. La subida principal cae donde está el puerto o
     el pueblo que da nombre a la ruta (towns), para que perfil y mapa cuenten lo mismo. */
  var BASE = [
    { n: 'Montseny por Collformic', f: [1.027, 1.027], kind: 'lazo-cola', seed: 7, base: 480, nueva: 74,
      climbs: [[0.42, 0.07, 1], [0.13, 0.03, 0.32], [0.66, 0.035, 0.4]], towns: [[0.12, 'Seva'], [0.42, 'Collformic'], [0.62, 'el Brull']] },
    { n: 'Tavertet y el pantano de Sau', f: [0.979, 0.947], kind: 'ocho', seed: 3, base: 420, nueva: 61,
      climbs: [[0.45, 0.05, 1], [0.2, 0.035, 0.55], [0.74, 0.04, 0.75]], towns: [[0.2, 'Roda de Ter'], [0.45, 'Tavertet'], [0.72, 'Vilanova de Sau']] },
    { n: 'Lluçanès por Prats', f: [0.96, 0.88], kind: 'lazo', seed: 11, base: 470, nueva: 48,
      climbs: [[0.5, 0.06, 1], [0.25, 0.04, 0.5], [0.78, 0.035, 0.45]], towns: [[0.25, 'Olost'], [0.5, 'Prats de Lluçanès'], [0.75, 'Sant Bartomeu']] },
    { n: 'Coll de Bracons y la Vall d’en Bas', f: [1.087, 1.207], kind: 'triangulo', seed: 5, base: 450, nueva: 82,
      climbs: [[0.3, 0.08, 1], [0.6, 0.04, 0.35], [0.85, 0.03, 0.3]], towns: [[0.3, 'Coll de Bracons'], [0.55, 'Joanetes'], [0.8, 'Sant Pere de Torelló']] },
    { n: 'Plana de Vic por Tona', f: [1.007, 0.653], kind: 'lazo', seed: 19, base: 470, nueva: 35,
      climbs: [[0.3, 0.045, 0.7], [0.56, 0.05, 0.5], [0.84, 0.04, 0.6]], towns: [[0.3, 'Tona'], [0.6, 'Malla'], [0.85, 'Gurb']] }
  ];
  function build() {
    return BASE.map(function (b) {
      return route({ n: b.n, km: Math.round(req.km * b.f[0] * 10) / 10, m: Math.round(req.m * b.f[1] / 10) * 10, kind: req.tipo === 'ida' ? 'ida' : b.kind,
        tipo: req.tipo === 'ida' ? 'Ida y vuelta' : 'Circular', seed: b.seed, base: b.base, nueva: req.nueva ? b.nueva : Math.round(b.nueva / 2), climbs: b.climbs, towns: b.towns });
    });
  }
  var wrap = $('#r-carrusel'), list = $('.carousel', wrap), dock = $('#r-dock'), dockExp = $('#r-dock-export'), dockGen = $('#r-dock-gen'), dockRetry = $('#r-dock-retry');
  var routes = build();

  /* Receta */
  var SAL = { casa: 'Desde Casa', aqui: 'Desde donde estés', mapa: 'Desde un punto del mapa' };
  var madeAt = '9:40';   // hora de las rutas que se ven (la del ejemplo; al generar, la real)
  function paintReceta() {
    var d = DIF[difOf(req.km, req.m)], made = state === 'results' || state === 'quota' || state === null;
    $('#receta-figs').innerHTML = '<span><b>' + fmt(req.km) + '</b>km</span><span><b>' + fmt(req.m) + '</b>m</span><span>' + bars(difOf(req.km, req.m)) + d[1] + '</span>';
    // La hora de generación va aquí, no en un antetítulo: deja sitio al perfil en la primera pantalla
    $('#receta-meta').textContent = SAL[req.salida] + ', ' + (req.tipo === 'ida' ? 'ida y vuelta' : 'circular') + (req.nueva ? ', carretera nueva' : '') +
      (made ? ' · hoy' + NB + madeAt : '');
  }

  /* Generador: distancia, dificultad y desnivel se mueven juntos */
  var gen = $('#gen'), stKm = FBT.stepper($('#g-km')), stM = FBT.stepper($('#g-m')), segDif = $('#g-dif'), segSal = $('#g-salida'), segTipo = $('#g-tipo');
  var SALH = { casa: 'Tu punto guardado en Ajustes. La IA nunca lo ve.', aqui: 'Usa tu ubicación al generar: el navegador te pedirá permiso.', mapa: 'Al generar, tocas el mapa para elegir el punto de salida.' };
  function pickDif(n) { var b = $('[data-value="' + DIF[n][2] + '"]', segDif); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); }
  function hints() {
    var km = stKm.get(), lo = Math.round(km * 11 / 50) * 50, hi = Math.round(km * 18 / 50) * 50, n = difOf(km, stM.get()), pt = GENERIC ? '' : ' para ti';
    var txt = n === 1 ? 'Suave' + pt + ': hasta <b>' + fmt(lo) + NB + 'm</b>' : n === 2 ? 'Media' + pt + ': de <b>' + fmt(lo) + '</b> a <b>' + fmt(hi) + NB + 'm</b>' : 'Dura' + pt + ': más de <b>' + fmt(hi) + NB + 'm</b>';
    $('#g-m-hint').innerHTML = txt;
  }
  var syncing = false;
  gen.addEventListener('stepchange', function () { syncing = true; pickDif(difOf(stKm.get(), stM.get())); syncing = false; hints(); });
  segDif.addEventListener('segchange', function (e) { if (syncing) return; stM.set(stKm.get() * MPK[e.detail.value], false); hints(); });
  segSal.addEventListener('segchange', function (e) { $('#g-salida-h').textContent = SALH[e.detail.value]; });
  if (GENERIC) {   // sin salidas: ni «tu salida media» ni «para ti»
    show($('#g-km-hint'), false);
    $('#g-dif-l').textContent = 'Dificultad';
    $('#r-res-t').textContent = '5 rutas';
    var iaRow = $('#r-ia a.row');
    iaRow.href = 'ia.html?state=empty';
    $('.row-meta', iaRow).textContent = 'Necesita tus salidas importadas';
  }
  hints();
  function readForm() {
    req.km = stKm.get(); req.m = stM.get();
    req.salida = $('[aria-pressed="true"]', segSal).dataset.value;
    req.tipo = $('[aria-pressed="true"]', segTipo).dataset.value;
    req.nueva = $('#g-nueva').getAttribute('aria-checked') === 'true';
  }

  /* Cuota agotada: no se puede generar; se dice en el propio botón */
  var bGen = $('#g-generar');
  if (STATE === 'quota') {
    bGen.disabled = true;
    bGen.innerHTML = ic('clock') + 'Cuota agotada · vuelve a la 1:00';
  }

  /* Estados */
  var S = { cuota: $('#r-cuota'), receta: $('#r-receta'), inline: $('#r-inline'), carga: $('#r-cargando'), error: $('#r-error'), clave: $('#r-sinclave'), res: $('#r-resultados'), ia: $('#r-ia'), nodata: $('#r-nodata') };
  var lead = $('#r-lead'), kicker = $('#r-kicker'), state = null;
  var KICK = {
    results: 'Generadas hoy a las 9:40', quota: 'Cuota agotada hasta la 1:00', error: 'No se han podido generar',
    loading: 'Generando…', empty: 'Aún no has generado rutas', nokey: 'Falta un paso'
  };
  function setState(s) {
    state = s;
    show(S.nodata, GENERIC && (s === 'empty' || s === 'results'));
    show(S.cuota, s === 'quota');
    show(S.receta, s === 'results' || s === 'quota' || s === 'loading' || s === 'error');
    show(S.inline, s === 'empty');
    show(S.carga, s === 'loading');
    show(S.error, s === 'error');
    show(S.clave, s === 'nokey');
    show(S.res, s === 'results' || s === 'quota');
    show(S.ia, s !== 'nokey' && s !== 'loading');
    show(lead, s === 'empty');
    show(kicker, s !== 'results');   // con rutas, la hora va en la receta
    kicker.innerHTML = (s === 'quota' ? ic('clock') : s === 'error' ? ic('alert') : '') + KICK[s];
    kicker.classList.toggle('page-kicker--warn', s === 'quota');
    kicker.classList.toggle('page-kicker--error', s === 'error');
    show(dock, s === 'results' || s === 'quota' || s === 'empty' || s === 'error');
    dock.classList.toggle('dock--narrow', s === 'results' || s === 'quota');
    show(dockExp, s === 'results' || s === 'quota'); show(dockGen, s === 'empty'); show(dockRetry, s === 'error');
    if (s === 'empty') { S.inline.appendChild(gen); $('#hoja-generar .sheet-foot').hidden = true; }
    else if (gen.parentNode === S.inline) { $('#hoja-generar .sheet-body').appendChild(gen); $('#hoja-generar .sheet-foot').hidden = false; }
    paintReceta();
  }

  /* Generar: progreso por pasos y, al acabar, las rutas. Cancelar devuelve exactamente lo que había. */
  var running = null, before = null;
  function progress(step, p, ready) {
    $$('#gensteps li').forEach(function (li, i) {
      li.dataset.s = i < step ? 'done' : i === step ? 'now' : 'todo';
      if (i === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      var icn = i < step ? 'checkc' : i === step ? 'loader' : 'clock';
      li.querySelector('.ic').outerHTML = ic(icn, i === step ? 'spin' : '');
    });
    $('#genbar').style.setProperty('--p', p);
    $('#genbar').parentNode.setAttribute('aria-valuenow', Math.round(p * 100));
    $('#gen-ready').textContent = ready;
  }
  function generate() {
    if (STATE === 'quota') return;   // el botón ya lo dice y está deshabilitado
    if (state !== 'loading') before = { state: state, req: JSON.parse(JSON.stringify(req)) };
    readForm(); paintReceta();
    if (FBT.sheet && $('#hoja-generar').open) FBT.sheet.close('hoja-generar');
    setState('loading'); scrollTo(0, 0);
    // El botón que se pulsó desaparece: el foco va al título de la generación, que se anuncia
    var lt = $('#r-carga-t'); lt.tabIndex = -1; lt.focus({ preventScroll: true });
    var t = [[0, 0.12, 0], [1, 0.46, 1], [1, 0.7, 3], [2, 0.92, 5]], k = 0;
    clearTimeout(running);
    (function tick() {
      if (k < t.length) { progress(t[k][0], t[k][1], t[k][2]); k++; running = setTimeout(tick, 650); return; }
      var now = new Date(); madeAt = now.getHours() + ':' + ('0' + now.getMinutes()).slice(-2);
      routes = build(); render(list, routes, 'r'); setState('results'); FBT.carousel(wrap).refresh();
      var h = $('#r-res-t'); h.tabIndex = -1; h.focus({ preventScroll: true });
      FBT.toast('5 rutas generadas', { tone: 'good' });
    })();
  }
  bGen.addEventListener('click', generate);
  dockGen.addEventListener('click', generate);
  dockRetry.addEventListener('click', generate);
  $('#r-cancelar').addEventListener('click', function () {
    clearTimeout(running);
    var b = before || { state: 'results', req: req };
    req = b.req; paintReceta();
    setState(b.state === 'loading' ? 'results' : b.state);
    FBT.toast('Generación cancelada', { tone: 'info' });
  });

  paintReceta();
  render(list, routes, 'r');
  wireResults(wrap, function () { return routes; }, dockExp);
  var st = { empty: 'empty', nodata: 'empty', loading: 'loading', error: 'error', nokey: 'nokey', quota: 'quota' }[STATE] || 'results';
  setState(st);
  if (st === 'loading') { before = { state: 'results', req: JSON.parse(JSON.stringify(req)) }; progress(1, 0.46, 2); }
}

/* =====================================================================
   IA: preguntas guiadas, resumen y propuestas
   ===================================================================== */
function iaPage() {
  var STEPS = ['1', '2', '3', 'resumen'];
  var HEAD = {
    '1': ['Paso 1 de 4', '¿Cuánto tiempo tienes?'],
    '2': ['Paso 2 de 4', '¿Qué terreno te apetece?'],
    '3': ['Paso 3 de 4', '¿Cómo vas de piernas?'],
    resumen: ['Paso 4 de 4', 'Tu petición'],
    propuestas: ['Propuestas de la IA', '3 rutas para hoy'],
    loading: ['Rutas con IA', 'Preparando tus rutas…'],
    // En los estados, el título dice lo que pasa; el antetítulo, dónde estás
    error: ['Rutas con IA', 'La IA no ha respondido'], nokey: ['Rutas con IA', 'Falta tu clave de IA'], empty: ['Rutas con IA', 'Primero, tus salidas']
  };
  var KEY = { '1': 'tiempo', '2': 'terreno', '3': 'piernas' };
  /* «Con ganas» = un 5 % más lejos que lo normal (lo dice la opción del paso 3) */
  var H = { '1h30': 1.5, '2h30': 2.5, '3h30': 3.5, '4h': 4.5 }, T = { llano: 6, ondulado: 12, puerto: 15, montana: 22 }, P = { cansado: 0.93, normal: 1, ganas: 1.05 };
  var ans = { tiempo: null, terreno: null, piernas: null };
  var DEMO = { tiempo: '3h30', terreno: 'puerto', piernas: 'ganas' };
  var kick = $('#q-kicker'), title = $('#q-title'), swap = $('.q-swap'), prog = $('#qprog');
  var dock = $('#ia-dock'), bPrev = $('#ia-prev'), bNext = $('#ia-next'), bAsk = $('#ia-pedir'), bExp = $('#ia-export'), bRetry = $('#ia-retry');
  var cur = null;

  /* Explicaciones de la IA: 240 caracteres como mucho (lo limita el esquema del cliente).
     La IA recibe las cifras resumidas de las rutas candidatas (km, desnivel, subidas,
     % de carretera nueva; nunca coordenadas) y las cita. Los tiempos salen de hours():
     3 h 30 «con ganas» y «un puerto» piden de 90 a 105 km y de 1.350 a 1.700 m. */
  function why(r, txt) { r.why = txt.replace('{t}', function () { var t = hm(r.h); return t[0] + NB + 'h' + NB + t[1]; }).replace('{margen}', function () { return Math.round((3.5 - r.h) * 60) + NB + 'min'; }); return r; }
  var ROUTES = [
    why(route({ n: 'Montseny por Collformic', km: 95.4, m: 1480, kind: 'lazo-cola', seed: 7, base: 480, nueva: 74,
      climbs: [[0.42, 0.07, 1], [0.13, 0.03, 0.32], [0.66, 0.035, 0.4], [0.85, 0.03, 0.36]],
      towns: [[0.12, 'Seva'], [0.42, 'Collformic'], [0.62, 'el Brull']] }),
      'Una subida larga, como pediste: <b>9,6' + NB + 'km al 6,2' + NB + '%</b>. A tu VAM de 780' + NB + 'm/h son unos 46' + NB + 'min, y el resto es rodable. Llegas en <b>{t}</b>.'),
    why(route({ n: 'Tavertet y el pantano de Sau', km: 91.2, m: 1420, kind: 'ocho', seed: 3, base: 420, nueva: 61,
      climbs: [[0.24, 0.035, 1], [0.5, 0.04, 0.95], [0.76, 0.035, 0.9]],
      towns: [[0.2, 'Roda de Ter'], [0.45, 'Tavertet'], [0.72, 'Vilanova de Sau']] }),
      'La más regular: el desnivel se reparte en <b>tres subidas de 3 a 5' + NB + 'km</b> al 5' + NB + '%. Te deja <b>{margen} de margen</b> sobre tus 3' + NB + 'h' + NB + '30.'),
    why(route({ n: 'Lluçanès por Prats', km: 96.0, m: 1390, kind: 'ida', tipo: 'Ida y vuelta', seed: 11, base: 470, nueva: 81,
      climbs: [[0.2, 0.03, 0.3], [0.5, 0.06, 1], [0.8, 0.03, 0.3]],
      towns: [[0.25, 'Olost'], [0.5, 'Prats de Lluçanès']] }),
      'La más nueva para ti: <b>el 81' + NB + '%</b> de la carretera no la has rodado nunca. Ida y vuelta por el mismo valle, con el puerto a mitad.')
  ];

  function chosen(step) { var b = $('#paso-' + step + ' [aria-checked="true"]'); return b ? b : null; }
  function paintSummary() {
    ['1', '2', '3'].forEach(function (s) {
      var b = chosen(s), row = $('#sum-' + s);
      $('.row-title', row).textContent = b ? $('.opt-t', b).textContent : 'Sin responder';
    });
    // Mismo modelo que las propuestas: el rango las contiene (de abajo, redondeando hacia fuera)
    var h = H[ans.tiempo] || 3.5, mpk = T[ans.terreno] || 12, f = P[ans.piernas] || 1;
    var km = h * speed(mpk) * f, m = km * mpk;
    $('#ask-km').textContent = fmt(Math.floor(km * 0.9 / 5) * 5) + ' a ' + fmt(Math.ceil(km * 1.02 / 5) * 5);
    $('#ask-m').textContent = fmt(Math.floor(m * 0.9 / 50) * 50) + ' a ' + fmt(Math.ceil(m * 1.08 / 50) * 50);
  }
  /* Pie: en las preguntas, tocar una respuesta ya avanza; «Siguiente» solo aparece
     al volver a un paso ya respondido. Si no queda nada que mostrar, no hay pie. */
  function syncDock(step) {
    var q = STEPS.indexOf(step) > -1 && step !== 'resumen';
    var prev = q && step !== '1', next = q && !!ans[KEY[step]];
    show(bPrev, prev); show(bNext, next);
    show(bAsk, step === 'resumen');
    show(bExp, step === 'propuestas');
    show(bRetry, step === 'error');
    show(dock, prev || next || step === 'resumen' || step === 'propuestas' || step === 'error');
    dock.classList.toggle('dock--narrow', step === 'propuestas');
    doc.body.toggleAttribute('data-flow', q || step === 'resumen');
  }
  /* Historial: cada pregunta, el resumen y las propuestas son una entrada, para que el
     gesto atrás de Android vuelva al paso anterior y no saque de la IA. state.prev guarda
     el paso de la entrada anterior: la flecha de la cabecera usa history.back() si es
     el paso anterior y, si no (se entró directo a ?paso=3), navega a él. */
  var ORDER = STEPS.concat(['propuestas']);
  function urlFor(step) {
    var q = new URLSearchParams(location.search);
    q.delete('state'); q.delete('estado'); q.set('paso', step);
    return '?' + q.toString();
  }
  function go(step, dir, focus, fromHistory) {
    var prevStep = cur; cur = step;
    // La espera de la IA también es una entrada (atrás la cancela y vuelve al resumen);
    // al llegar las propuestas, las sustituye: atrás desde ellas lleva al resumen.
    var tracked = ORDER.indexOf(step) > -1 || step === 'loading';
    if (tracked && prevStep !== step && !fromHistory && history.pushState) {
      try {
        var url = step === 'loading' ? location.search : urlFor(step);
        if (prevStep === null) history.replaceState({ paso: step, prev: null }, '', url);
        else if (prevStep === 'loading' && history.state && history.state.paso === 'loading') history.replaceState({ paso: step, prev: history.state.prev }, '', url);
        else history.pushState({ paso: step, prev: ORDER.indexOf(prevStep) > -1 ? prevStep : null }, '', url);
      } catch (e) { /* file:// en algunos navegadores: sin historial, la página sigue */ }
    }
    syncBack(step);
    STEPS.concat(['propuestas']).forEach(function (s) { show($('#paso-' + s), s === step); });
    show($('#ia-receta'), step === 'propuestas');
    ['loading', 'error', 'nokey', 'empty'].forEach(function (s) { show($('#ia-' + s), s === step); });
    var h = HEAD[step]; kick.textContent = h[0]; title.textContent = h[1];
    var qi = STEPS.indexOf(step);
    show(prog, qi > -1);
    $$('i', prog).forEach(function (seg, j) { seg.toggleAttribute('data-on', j <= qi); });
    prog.setAttribute('aria-valuenow', qi + 1);
    prog.setAttribute('aria-valuetext', 'Paso ' + (qi + 1) + ' de 4');
    if (step === 'resumen') paintSummary();
    syncDock(step);
    if (prevStep !== null && !FBT.reduced()) {
      var panel = $('#paso-' + step) || $('#ia-' + step);
      if (panel && panel.animate) panel.animate([{ opacity: 0, transform: 'translateX(' + (dir || 1) * 24 + 'px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
      if (swap.animate) swap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    }
    if (prevStep !== null) { scrollTo(0, 0); if (focus !== false) { title.tabIndex = -1; title.focus({ preventScroll: true }); } }
    if (step === 'propuestas') {
      var t = ['1', '2', '3'].map(function (s) { var b = chosen(s); return b ? $('.opt-t', b).textContent : ''; });
      var rc = $('#ia-receta-t');
      rc.textContent = t[0];
      $('#ia-receta-m').textContent = t[1] + ', ' + t[2].toLowerCase();
      rc.closest('.receta').setAttribute('aria-label', 'Tus respuestas: ' + t.join(', ') + '. Cambiar respuestas');
      FBT.carousel($('#ia-carrusel')).refresh();
      fitWhy($('#ia-carrusel'));
    }
  }

  /* Respuestas: radios con flechas; tocar una avanza sola */
  var advanceT = null;
  $$('.opts[role="radiogroup"]').forEach(function (g) {
    var step = g.dataset.step, opts = $$('.opt', g);
    function pick(o, advance) {
      opts.forEach(function (x) { var on = x === o; x.setAttribute('aria-checked', on ? 'true' : 'false'); x.tabIndex = on ? 0 : -1; });
      ans[KEY[step]] = o.dataset.value;
      try { sessionStorage.setItem('fbt-ia-ans', JSON.stringify(ans)); } catch (e) { /* sin almacenamiento: solo se pierden al recargar */ }
      clearTimeout(advanceT);
      if (advance) advanceT = setTimeout(function () { next(); }, FBT.reduced() ? 120 : 240);
      else if (cur === step) syncDock(step);   // con teclado (o al volver) sí aparece «Siguiente»
    }
    opts.forEach(function (o, i) { o.tabIndex = i === 0 ? 0 : -1; o.addEventListener('click', function () { pick(o, true); }); });
    g.addEventListener('keydown', function (e) {
      var i = opts.indexOf(doc.activeElement); if (i < 0) return;
      var k = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
      if (!k) return;
      var n = opts[(i + k + opts.length) % opts.length]; n.focus(); pick(n, false); e.preventDefault();
    });
    g._pick = pick; g._opts = opts;
  });
  function preset(step) { var g = $('#paso-' + step + ' .opts'), o = $('[data-value="' + DEMO[KEY[step]] + '"]', g); g._pick(o, false); }
  function next() { var i = STEPS.indexOf(cur); if (i > -1 && i < STEPS.length - 1 && ans[KEY[cur]]) go(STEPS[i + 1], 1); }
  /* Un paso atrás: si la entrada anterior del historial es ese paso, se vuelve a ella
     (así atrás y la flecha no se pisan); si no, se navega al paso anterior */
  function back() {
    var i = STEPS.indexOf(cur); if (i < 1) return;
    var p = STEPS[i - 1];
    if (history.state && history.state.paso === cur && history.state.prev === p) history.back();
    else go(p, -1);
  }
  bNext.addEventListener('click', next);
  bPrev.addEventListener('click', back);
  /* Flecha de la cabecera: en los pasos 2 a 4, «Paso anterior»; en el 1 y fuera de las preguntas, a Rutas */
  var bBack = $('#ia-back');
  function syncBack(step) {
    var inner = STEPS.indexOf(step) > 0;
    bBack.setAttribute('aria-label', inner ? 'Paso anterior' : 'Volver a Rutas');
    bBack.toggleAttribute('data-step-back', inner);
  }
  bBack.addEventListener('click', function (e) { if (STEPS.indexOf(cur) > 0) { e.preventDefault(); back(); } });
  window.addEventListener('popstate', function (e) {
    var p = e.state && e.state.paso;
    if (p === 'loading') p = 'resumen';   // adelante hasta una espera ya acabada: se vuelve a pedir desde el resumen
    if (!p || ORDER.indexOf(p) < 0) return;
    clearTimeout(wait); clearTimeout(advanceT);   // atrás durante la espera de la IA: se cancela
    go(p, ORDER.indexOf(p) < ORDER.indexOf(cur) ? -1 : 1, undefined, true);
  });
  $$('[data-goto]').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.goto, -1); }); });

  /* Pedir: unos segundos de espera y las propuestas */
  var wait = null;
  function ask() {
    go('loading', 1);
    var steps = $$('#ia-steps li'), k = 0;
    clearTimeout(wait);
    (function tick() {
      steps.forEach(function (li, i) {
        li.dataset.s = i < k ? 'done' : i === k ? 'now' : 'todo';
        if (i === k) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
        li.querySelector('.ic').outerHTML = ic(i < k ? 'checkc' : i === k ? 'loader' : 'clock', i === k ? 'spin' : '');
      });
      if (k++ < steps.length) { wait = setTimeout(tick, 700); return; }
      go('propuestas', 1); FBT.toast('3 rutas propuestas', { tone: 'good' });
    })();
  }
  bAsk.addEventListener('click', ask);
  bRetry.addEventListener('click', ask);
  $('#ia-cancelar').addEventListener('click', function () {
    clearTimeout(wait);
    if (history.state && history.state.paso === 'loading' && history.state.prev === 'resumen') history.back();   // como el gesto atrás
    else go('resumen', -1);
  });

  render($('#ia-carrusel .carousel'), ROUTES, 'ia');
  wireResults($('#ia-carrusel'), function () { return ROUTES; }, bExp);

  /* Arranque: estado o paso por URL. Las respuestas de esta sesión se recuperan
     (volver con «adelante» o recargar no las pierde); lo que falte para llegar al
     paso pedido se rellena con las del ejemplo. */
  var paso = Q.get('paso') || '1', saved = null;
  try { saved = JSON.parse(sessionStorage.getItem('fbt-ia-ans') || 'null'); } catch (e) { saved = null; }
  ['1', '2', '3'].forEach(function (s) {
    var g = $('#paso-' + s + ' .opts'), v = saved && saved[KEY[s]], o = v && $('[data-value="' + v + '"]', g);
    if (o) g._pick(o, false);
    else if (STATE || STEPS.indexOf(paso) > STEPS.indexOf(s) || paso === 'propuestas') preset(s);
  });
  var first = STATE && HEAD[STATE] ? STATE : (HEAD[paso] ? paso : '1');
  if (STATE === 'loading') { go('loading'); }
  else go(first);
}

if (doc.body.dataset.page === 'rutas') rutasPage();
if (doc.body.dataset.page === 'ia') iaPage();
})();
