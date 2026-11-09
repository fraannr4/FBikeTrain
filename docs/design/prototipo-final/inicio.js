/* FBikeTrain, Inicio: datos sintéticos y dibujo de cada pieza. */
(function () {
'use strict';
var F = window.FBT, nf = F.nf, hm = F.hm, tok = F.tok, hexA = F.hexA, el = F.el, rng = F.rng, pathOf = F.pathOf;
var reduced = F.reduced, FASE = F.FASE;
var params = new URLSearchParams(location.search);
var EMPTY = params.get('estado') === 'vacio';
var root = document.documentElement;
var $ = function (s) { return document.querySelector(s); };

/* ---------- Variantes: fase 1 y sin salidas ---------- */
if (FASE === 1) {
  $('#home').classList.add('f1');
  $('.imp').hidden = false;
  document.querySelectorAll('.home > [data-f]').forEach(function (n) { n.style.display = 'none'; });
  $('.home').style.gridTemplateAreas = '';
}
if (EMPTY) {
  document.querySelectorAll('.home > :not(.hero)').forEach(function (n) { n.style.display = 'none'; });
  $('#kpis').style.display = 'none';
  $('#summit').style.display = 'none';
  $('#hero-sub').innerHTML = 'Importa tu archivo de Strava y verás aquí tu progresión, medida contra tu propio nivel.';
  $('#hero-copy').insertAdjacentHTML('beforeend', '<a class="btn btn-primary btn-lg press" href="importar.html" style="margin-top:18px">' + F.ic('upload', 'ic-sm') + 'Importar salidas</a>');
  $('#empty-howto').hidden = false;
  $('.hero').classList.add('hero-empty');
  $('.home').style.gridTemplateAreas = '"hero"';
  $('.home').style.gridTemplateColumns = 'minmax(0, 1fr)';
}

/* ---------- Perfiles: tu última salida y la ruta propuesta ---------- */
var LAST = F.makeProfile([[0,40],[6,70],[12,110],[15,140],[21,330],[27,470],[29,440],[34,210],[38,190],[42,420],[46,640],[47.5,800],[49,880],[52,1012],[55,860],[60,520],[64,190],[66,170],[68.5,330],[69.4,450],[70,520],[73,430],[78,210],[83,90],[87.6,40]], 87.6, 7);
var ROUTE = F.makeProfile([[0,210],[8,260],[14,420],[22,780],[26,1050],[29,1120],[33,900],[40,560],[46,480],[52,610],[58,980],[61,1180],[63,1240],[67,1010],[74,720],[80,520],[88,330],[96,210]], 96, 19);
/* Sin salidas: una cresta fija, no un dato */
var FIXED = F.makeProfile([[0,200],[20,420],[35,380],[55,760],[62,700],[80,420],[100,260]], 100, 3);

/* =====================================================================
   SceneSvg: el paisaje es el momento emocional de Inicio.
   A sangre detrás de todo el hero (saludo incluido), de atrás adelante:
   cielo, estrellas (oscuro), luna o sol tras la cima, cuatro crestas con
   perspectiva atmosférica (más claras y con más bruma cuanto más lejos),
   la cresta de tu última salida con su línea de luz y, en su ladera,
   la carretera en zigzag: una curva de herradura por cada subida.
   ===================================================================== */
var hero = $('.hero'), land = $('#land'), summitEl = $('#summit');
function midpoint(seed, n, rough) {
  var R = rng(seed), N = 1 << n, v = new Array(N + 1).fill(0);
  v[0] = R(); v[N] = R();
  for (var step = N, amp = 1; step > 1; step >>= 1, amp *= rough) {
    var h = step >> 1;
    for (var i = h; i < N; i += step) v[i] = (v[i - h] + v[i + h]) / 2 + (R() - 0.5) * amp;
  }
  var mn = Math.min.apply(null, v), mx = Math.max.apply(null, v);
  return v.map(function (x) { return (x - mn) / (mx - mn); });
}
function textBox(node, hr) {
  // Cajas de las líneas de texto reales (no la caja del bloque) y su unión.
  var x1 = 0, y1 = 0, lines = [], tw = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), tn;
  while ((tn = tw.nextNode())) {
    if (!tn.textContent.trim() || !tn.parentElement.offsetParent) continue;
    var r = document.createRange(); r.selectNodeContents(tn);
    Array.prototype.forEach.call(r.getClientRects(), function (c) {
      if (!c.width) return;
      lines.push({ l: c.left - hr.left, r: c.right - hr.left, t: c.top - hr.top, b: c.bottom - hr.top });
      x1 = Math.max(x1, c.right - hr.left); y1 = Math.max(y1, c.bottom - hr.top);
    });
  }
  return { right: x1, bottom: y1, lines: lines };
}
// Cuatro crestas procedimentales (sin dato): semillas fijas, el mismo dibujo en cada carga.
var RIDGES = [midpoint(11, 8, 0.58), midpoint(23, 8, 0.55), midpoint(37, 8, 0.52), midpoint(51, 8, 0.5)];
function sampleArr(a, l) { l = Math.max(0, Math.min(1, l)); var f = l * (a.length - 1), i = Math.floor(f), t = f - i; return a[i] + ((a[Math.min(a.length - 1, i + 1)]) - a[i]) * t; }

/* Subidas del perfil: de un mínimo a un máximo con más de `minGain` m de ganancia. */
function climbs(prof, minGain) {
  var out = [], lo = prof[0], hi = prof[0];
  for (var i = 1; i < prof.length; i++) {
    var p = prof[i];
    if (p[1] > hi[1]) hi = p;
    var dropped = hi[1] - p[1] > minGain;
    if (dropped || i === prof.length - 1) {
      if (hi[1] - lo[1] > minGain) out.push({ km0: lo[0], km1: hi[0], gain: hi[1] - lo[1] });
      lo = p; hi = p;
    } else if (p[1] < lo[1] && hi[1] - lo[1] <= minGain) { lo = p; hi = p; }
  }
  return out;
}

/* Carretera: de abajo a la cima, una pierna por subida (la última llega a la cima).
   La altura de cada pierna es proporcional a la ganancia de su subida y su anchura
   lateral, a su longitud. Ancho y amplitud menguan con la altura: perspectiva. */
function roadPoints(prof, sx, sy, baseY, width, maxAmp) {
  var cs = climbs(prof, 110); if (!cs.length) cs = [{ km0: 0, km1: 1, gain: 1 }];
  var gain = cs.reduce(function (a, c) { return a + c.gain; }, 0);
  var dist = Math.max.apply(null, cs.map(function (c) { return c.km1 - c.km0; }));
  var pts = [], y = baseY, dir = cs.length % 2 ? 1 : -1, x = sx - dir * maxAmp * 0.5;
  cs.forEach(function (c, k) {
    var rise = (baseY - sy) * c.gain / gain, last = k === cs.length - 1;
    var y1 = y - rise, t1 = (baseY - y1) / (baseY - sy);
    var amp = maxAmp * (0.45 + 0.55 * (c.km1 - c.km0) / dist) * (1 - 0.8 * t1);
    var x1 = last ? sx : sx + dir * amp * 0.5;
    for (var u = k ? 1 : 0, N = 28; u <= N; u++) {
      var e = u / N, ee = (1 - Math.cos(Math.PI * e)) / 2;
      pts.push([x + (x1 - x) * ee, y - rise * e]);
    }
    x = x1; y = y1; dir = -dir;
  });
  return pts.map(function (p) { var t = Math.min(1, Math.max(0, (baseY - p[1]) / (baseY - sy))); return [p[0], p[1], Math.max(1.2, width * Math.pow(1 - t, 1.4))]; });
}
function ribbon(pts) {
  var L = [], R = [];
  pts.forEach(function (p, i) {
    var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1;
    var nx = -dy / n, ny = dx / n, h = p[2] / 2;
    L.push([p[0] + nx * h, p[1] + ny * h]); R.push([p[0] - nx * h, p[1] - ny * h]);
  });
  return pathOf(L.concat(R.reverse()), true);
}

function buildHero() {
  var W = Math.round(hero.clientWidth), H = Math.round(hero.clientHeight); if (!W || !H) return;
  land.setAttribute('viewBox', '0 0 ' + W + ' ' + H); land.textContent = '';
  var mobile = W < 700, hr = hero.getBoundingClientRect();
  var tb = textBox($('#hero-copy'), hr);
  var kp = $('#kpis'), kpOn = !!kp.offsetParent && kp.style.display !== 'none';
  var kTop = kpOn ? kp.getBoundingClientRect().top - hr.top : H;
  var tool = $('.hero-top .acts').getBoundingClientRect();
  var textBottom = tb.bottom, textRight = tb.right;
  var base = kpOn ? (mobile ? kTop + 44 : kTop + 56) : H;
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  var defs = el('defs', {}, land);
  function lin(id, y0, y1, stops) {
    var g = el('linearGradient', { id: id, x1: 0, y1: y0, x2: 0, y2: y1, gradientUnits: 'userSpaceOnUse' }, defs);
    stops.forEach(function (s) { el('stop', { offset: s[0], style: 'stop-color:var(' + s[1] + ');stop-opacity:' + (s[2] == null ? 1 : s[2]) }, g); });
    return 'url(#' + id + ')';
  }
  function rad(id, cx, cy, r, stops) {
    var g = el('radialGradient', { id: id, cx: cx, cy: cy, r: r, gradientUnits: 'userSpaceOnUse' }, defs);
    stops.forEach(function (s) { el('stop', { offset: s[0], style: 'stop-color:var(' + s[1] + ');stop-opacity:' + s[2] }, g); });
    return 'url(#' + id + ')';
  }
  var step = 3;
  // Techo de cada cresta: a la izquierda baja, para el saludo; a la derecha, libre.
  var env = function (x) { return mobile ? 1 : F.smoothstep(textRight - 60, textRight + 260, x); };
  var nearHi = mobile ? textBottom + 70 : Math.max(H * 0.2, tool.bottom - hr.top + 16) + (W < 1080 ? 30 : 0);
  var nearFloor = mobile ? base - 26 : base - 40;
  var nearLeft = mobile ? nearFloor - 40 : Math.min(nearFloor - 30, textBottom + 40);

  // La cresta de tu última salida se calcula primero: la luna va detrás de su cima.
  var prof = EMPTY ? FIXED : LAST, total = prof[prof.length - 1][0], emin = Infinity, emax = -Infinity;
  prof.forEach(function (p) { emin = Math.min(emin, p[1]); emax = Math.max(emax, p[1]); });
  var fr = [], peak = null, win = mobile ? 8 : 4;
  for (var x2 = -2; x2 <= W + step; x2 += step) {
    var km = Math.max(0, Math.min(total, x2 / W * total)), i = Math.round(km / 0.2), sm = 0, n = 0;
    for (var kk = -win; kk <= win; kk++) { var q = prof[i + kk]; if (q) { sm += q[1]; n++; } }
    var e = (sm / n - emin) / (emax - emin), top = lerp(nearLeft, nearHi, env(x2));
    var y = nearFloor - (0.08 + 0.92 * e) * (nearFloor - top);
    fr.push([x2, y]); if (!peak || y < peak[1]) peak = [x2, y];
  }

  // 1. Cielo: del cénit al horizonte, que cae al pie de las crestas.
  var horizon = mobile ? base - 30 : base - 60;
  el('rect', { width: W, height: H, fill: lin('sky', 0, horizon, [[0, '--sky-0'], [0.34, '--sky-1'], [0.6, '--sky-2'], [0.82, '--sky-3'], [1, '--sky-4']]) }, land);

  // 2. Estrellas, solo en oscuro (--stars vale 0 en claro): fijas y más densas arriba.
  var sg = el('g', { style: 'opacity:var(--stars)' }, land), R = rng(77), nS = Math.round(W * H / 3800);
  for (var s = 0; s < nS; s++) {
    var sy0 = Math.pow(R(), 1.6) * horizon * 0.82, big = R() > 0.93;
    el('circle', { cx: (R() * W).toFixed(1), cy: sy0.toFixed(1), r: (big ? 1.25 : 0.5 + R() * 0.45).toFixed(2), fill: 'var(--star)', 'fill-opacity': (big ? 0.9 : 0.22 + R() * 0.5).toFixed(2) }, sg);
  }

  // 3. Luna (oscuro) o sol (claro) en el horizonte, detrás de la cima.
  var orbR = mobile ? 22 : 30, orbY = peak[1] + orbR * 0.2;
  el('rect', { width: W, height: H, fill: rad('glow', peak[0], orbY, Math.max(W * 0.45, 300), [[0, '--orb-glow', 0.5], [0.3, '--haze', 0.3], [1, '--haze', 0]]) }, land);
  el('circle', { cx: peak[0], cy: orbY, r: orbR * 2.4, fill: rad('orbh', peak[0], orbY, orbR * 2.4, [[0.4, '--orb', 0.45], [1, '--orb', 0]]) }, land);
  el('circle', { cx: peak[0], cy: orbY, r: orbR, fill: 'var(--orb)' }, land);

  // 4. Cuatro crestas lejanas: cuanto más cerca, más bajas, más oscuras y con menos bruma.
  var LAYERS = [
    { tok: '--ridge-1', hi: 0.12, lo: 0.50, amp: 0.9, mist: 0.6 },
    { tok: '--ridge-2', hi: 0.22, lo: 0.60, amp: 0.85, mist: 0.45 },
    { tok: '--ridge-3', hi: 0.34, lo: 0.70, amp: 0.78, mist: 0.32 },
    { tok: '--ridge-4', hi: 0.46, lo: 0.80, amp: 0.7, mist: 0.2 }
  ];
  var leftRoof = mobile ? 0 : textBottom - 40;
  LAYERS.forEach(function (Ly, k) {
    var pts = [], sumY = 0;
    for (var x = 0; x <= W + step; x += step) {
      var free = mobile ? textBottom + 6 + k * 16 : H * Ly.hi;
      var cap = mobile ? free : lerp(Math.max(free, leftRoof + k * 18), free, env(x));
      var floor = lerp(cap, base, Ly.lo);
      var y = floor - Ly.amp * sampleArr(RIDGES[k], x / W) * (floor - cap);
      pts.push([x, y]); sumY += y;
    }
    var avg = sumY / pts.length;
    el('path', { d: pathOf(pts) + 'L' + (W + step) + ' ' + H + 'L0 ' + H + 'Z', fill: 'var(' + Ly.tok + ')' }, land);
    el('path', { d: pathOf(pts), fill: 'none', stroke: 'var(--ridge-line)', 'stroke-opacity': (0.08 + k * 0.03).toFixed(2), 'stroke-width': 1 }, land);
    // Bruma al pie: aclara la base de la cresta y la separa de la siguiente.
    var m0 = avg - 6, m1 = Math.min(H, avg + (base - avg) * 0.85);
    el('rect', { x: 0, y: m0, width: W, height: Math.max(0, H - m0), fill: lin('mist' + k, m0, m1, [[0, '--mist', 0], [1, '--mist', Ly.mist]]) }, land);
  });

  // 5. Cresta cercana: tu última salida, con curvas de nivel grabadas.
  var fd = pathOf(fr);
  el('path', { d: fd + 'L' + W + ' ' + H + 'L-2 ' + H + 'Z', fill: lin('nearfill', peak[1], H, [[0, '--ridge-near'], [0.78, '--ridge-near'], [1, '--surface']]) }, land);
  var hatch = el('g', {}, land);
  for (var k2 = 1; k2 <= 7; k2++) {
    el('path', { d: pathOf(fr.map(function (p) { return [p[0], p[1] + k2 * 9 + Math.sin(p[0] / (52 + k2 * 7)) * k2]; })), fill: 'none', stroke: 'var(--ridge-line)', 'stroke-opacity': (0.1 - k2 * 0.011).toFixed(3), 'stroke-width': 1 }, hatch);
  }

  // 6. La carretera en zigzag por la ladera, del pie hasta la cima.
  var roadBase = mobile ? H - 6 : Math.min(H + 4, base + 20);
  var rp = roadPoints(prof, peak[0], peak[1] + 5, roadBase, mobile ? 20 : 30, mobile ? Math.min(170, W * 0.42) : Math.min(300, W * 0.22));
  var rg = el('g', { class: 'road' }, land);
  el('path', { d: ribbon(rp.map(function (p) { return [p[0], p[1], p[2] + 2.6]; })), fill: 'var(--road-edge)' }, rg);
  el('path', { d: ribbon(rp), fill: 'var(--road)' }, rg);
  var dash = rp.filter(function (p) { return p[2] > 8; });
  if (dash.length > 2) el('path', { d: pathOf(dash), fill: 'none', stroke: 'var(--road-dash)', 'stroke-width': 1.4, 'stroke-dasharray': '8 8', 'stroke-opacity': 0.9, 'stroke-linecap': 'round' }, rg);

  // Línea de luz de la cresta: halo, núcleo e hilo. Se dibuja una vez al cargar.
  var cls = EMPTY ? 'still' : 'draw';
  el('path', { class: cls, pathLength: 1, d: fd, fill: 'none', stroke: 'var(--ridge-line)', style: 'stroke-opacity:calc(var(--glow) * .5)', 'stroke-width': 9, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, land);
  el('path', { class: cls, pathLength: 1, d: fd, fill: 'none', stroke: 'var(--ridge-line)', 'stroke-width': EMPTY ? 1.6 : 2.2, 'stroke-opacity': EMPTY ? 0.75 : 1, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, land);
  if (!EMPTY) el('path', { class: 'draw', pathLength: 1, d: fd, fill: 'none', stroke: '#fff', style: 'stroke-opacity:calc(var(--thread) * .9)', 'stroke-width': 0.8, 'stroke-linejoin': 'round' }, land);

  // Velo tras el saludo: garantiza el contraste del texto sobre las crestas lejanas.
  var vx = mobile ? W * 0.3 : Math.max(tb.right * 0.42, 160), vy = mobile ? textBottom * 0.5 : Math.max(textBottom, 120) * 0.5;
  el('rect', { width: W, height: H, fill: rad('scrim', vx, vy, mobile ? W * 0.9 : Math.max(tb.right, 260) * 0.92, [[0, '--hero-scrim', 0.95], [0.55, '--hero-scrim', 0.55], [1, '--hero-scrim', 0]]) }, land);

  // Vértice geodésico en la cima: el rótulo flota en el cielo sin tapar texto ni barra.
  if (EMPTY) return;
  summitEl.style.display = '';
  var pk = prof.reduce(function (a, b) { return b[1] > a[1] ? b : a; });
  summitEl.querySelector('.lbl b').textContent = nf(pk[1]) + ' m';
  summitEl.querySelector('.lbl span').textContent = 'cima de tu última salida, km ' + nf(pk[0]);
  var gap = orbR + 6; summitEl.querySelector('.lead').style.width = gap + 'px';
  var sw = summitEl.offsetWidth, shh = summitEl.offsetHeight, vgHalf = 8;
  var tl = tool.left - hr.left, tbt = tool.bottom - hr.top;
  var topY = peak[1] - 9 - shh / 2;
  var left = { side: 'left', x: peak[0] + vgHalf - sw, y: topY };
  var right = { side: 'right', x: peak[0] - vgHalf, y: topY };
  function clash(c) {
    var x0 = c.x, x1 = c.x + sw, y0 = c.y, y1 = c.y + shh;
    var hitTool = !mobile && x1 > tl - 8 && y0 < tbt + 8;
    var hitText = tb.lines.some(function (ln) { return x0 < ln.r + 14 && x1 > ln.l && y0 < ln.b + 6 && y1 > ln.t - 6; });
    return hitTool || hitText || x0 < 8 || x1 > W - 8 || y0 < 6;
  }
  var pick = mobile ? (peak[0] > W / 2 ? left : right) : (!clash(left) ? left : right);
  summitEl.setAttribute('data-side', pick.side);
  summitEl.style.flexDirection = pick.side === 'left' ? 'row' : 'row-reverse';
  summitEl.style.left = Math.round(Math.max(8, Math.min(W - sw - 8, pick.x))) + 'px';
  summitEl.style.top = Math.round(pick.y) + 'px';
}

/* ---------- Sparkline de cada KPI: 8 semanas y tu media en discontinua ---------- */
var SPARK = {
  dist: [148, 172, 160, 205, 188, 176, 191, 214],
  elev: [2100, 2650, 2380, 3100, 2900, 2760, 2950, 3480],
  time: [5.9, 6.6, 6.2, 7.7, 7.1, 6.8, 7.4, 8.1],
  speed: [25.1, 26.0, 25.8, 26.6, 26.5, 25.9, 27.1, 26.5]
};
var ACC = { dist: '--acc-dist', elev: '--acc-elev', time: '--acc-time', speed: '--acc-speed' };
function renderSpark(svg) {
  var key = svg.getAttribute('data-spark'), v = SPARK[key], W = svg.clientWidth || 200, H = svg.clientHeight || 34;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.textContent = '';
  var mn = Math.min.apply(null, v), mx = Math.max.apply(null, v), pad = 5;
  var Y = function (y) { return pad + (1 - (y - mn) / (mx - mn || 1)) * (H - pad * 2); };
  var pts = v.map(function (y, i) { return [4 + i / (v.length - 1) * (W - 10), Y(y)]; });
  var d = F.smoothPath(pts), mean = v.slice(3, 7).reduce(function (a, b) { return a + b; }, 0) / 4;
  var id = F.gid('sp'), lg = el('linearGradient', { id: id, x1: 0, x2: 0, y1: 0, y2: 1 }, el('defs', {}, svg));
  el('stop', { offset: 0, style: 'stop-color:var(' + ACC[key] + ');stop-opacity:.32' }, lg);
  el('stop', { offset: 1, style: 'stop-color:var(' + ACC[key] + ');stop-opacity:0' }, lg);
  el('path', { d: d + 'L' + pts[pts.length - 1][0] + ' ' + H + 'L' + pts[0][0] + ' ' + H + 'Z', fill: 'url(#' + id + ')' }, svg);
  el('line', { x1: 0, x2: W, y1: Y(mean), y2: Y(mean), stroke: 'var(--ink-3)', 'stroke-width': 1, 'stroke-dasharray': '3 3', 'stroke-opacity': 0.75 }, svg);
  el('path', { d: d, fill: 'none', stroke: 'var(' + ACC[key] + ')', style: 'stroke-opacity:calc(var(--glow) * .5)', 'stroke-width': 5, 'stroke-linecap': 'round' }, svg);
  el('path', { d: d, fill: 'none', stroke: 'var(' + ACC[key] + ')', 'stroke-width': 1.8, 'stroke-linecap': 'round' }, svg);
  var L = pts[pts.length - 1];
  el('circle', { cx: L[0], cy: L[1], r: 3.4, fill: 'var(--surface)', stroke: 'var(' + ACC[key] + ')', 'stroke-width': 2 }, svg);
}

/* =====================================================================
   PerformanceCard: últimos 30 días sobre tu rango de 12 meses.
   Barra de 4 px en el acento (tu rango, de la salida más baja a la más
   alta), marca de 14 px en tu media con su etiqueta en línea y punto de
   12 px en los últimos 30 días. Todo con 3:1 sobre la tarjeta.
   ===================================================================== */
var STATS = [
  { acc: '--acc-speed', ic: 'gauge', l: 'Velocidad media', v: '27,2', u: 'km/h', d: '+0,8 km/h', up: true, min: 24.1, max: 27.6, mean: 26.1, now: 27.2, dec: 1 },
  { acc: '--acc-elev', ic: 'mountain', l: 'Desnivel por salida', v: '870', u: 'm', d: '+6 %', up: true, min: 540, max: 960, mean: 820, now: 870, dec: 0 },
  { acc: '--acc-time', ic: 'rotate', l: 'Cadencia media', v: '86', u: 'rpm', note: 'en 5 de 13 salidas', min: 79, max: 89, mean: 84, now: 86, dec: 0 },
  { acc: '--acc-dist', ic: 'milestone', l: 'Salida más larga', v: '112', u: 'km', note: 'el 18 de octubre', min: 72, max: 124, mean: 96, now: 112, dec: 0 }
];
function renderStats() {
  var ul = $('#stats');
  ul.innerHTML = STATS.map(function (s) {
    var pc = function (x) { return Math.max(0, Math.min(100, (x - s.min) / (s.max - s.min) * 100)); };
    var mp = pc(s.mean), np = pc(s.now), f = function (x) { return nf(x, s.dec); };
    var d = s.d ? '<span class="stat-d up">' + F.ic('up') + s.d + '<span class="sr-only"> sobre tu media</span></span>' : '<span class="stat-d">' + s.note + '</span>';
    // La etiqueta de la media se ancla a su marca; los extremos se ocultan si chocan con ella.
    var anchor = mp < 22 ? 'start' : mp > 78 ? 'end' : 'mid';
    return '<li class="stat" style="--acc:var(' + s.acc + ')">' +
      '<span class="stat-ic">' + F.ic(s.ic) + '</span>' +
      '<span class="stat-txt"><span class="stat-l">' + s.l + '</span>' + d + '</span>' +
      '<span class="stat-v"><span class="fig">' + s.v + '</span><span class="u">' + s.u + '</span></span>' +
      '<span class="rbar" role="img" aria-label="Tu rango de 12 meses va de ' + f(s.min) + ' a ' + f(s.max) + ' ' + s.u + '; tu media, ' + f(s.mean) + '; los últimos 30 días, ' + s.v + '">' +
        '<i class="tr"></i><i class="mean" style="left:' + mp.toFixed(1) + '%"></i><i class="now" style="left:' + np.toFixed(1) + '%"></i></span>' +
      '<span class="rlab" aria-hidden="true">' +
        (mp >= 22 ? '<span class="lo">' + f(s.min) + '</span>' : '') +
        '<span class="m ' + anchor + '" style="left:' + mp.toFixed(1) + '%">media ' + f(s.mean) + ' ' + s.u + '</span>' +
        (mp <= 78 ? '<span class="hi">' + f(s.max) + '</span>' : '') +
      '</span>' +
    '</li>';
  }).join('');
}

/* =====================================================================
   F3 en adelante: GoalRing con tu objetivo. Las cifras del centro son
   HTML en px encima del SVG: no encogen con el anillo.
   F1: «Tu semana», una barra frente a tu semana media (aún no hay objetivos).
   ===================================================================== */
var GOAL = { pct: 0.27, exp: 0.2, c1: '27', c2: '214 de 800 km', t: 'Noviembre: 800 km',
  aria: 'Objetivo de noviembre: 214 de 800 km, 27 %. El ritmo esperado hoy es el 20 %: vas 7 puntos por delante. Quedan 24 días.',
  lines: [['ahead', 'trend', 'Vas 7 puntos por delante del ritmo'], ['pace', null, 'Ritmo esperado hoy: 20 %'], ['', 'calendar', 'Quedan 24 días']] };
var WEEK = { done: 214, mean: 191, pace: 191 * 5 / 7, daysLeft: 2 };
function renderRing() {
  var svg = $('#ring'), c = 100, R = 76, sw = 12;
  svg.textContent = '';
  F.topo(svg, 21, c, c, 3, 11);
  var g = el('g', {}, svg);
  [89, 96].forEach(function (rr, k) {
    var pts = []; for (var i = 0; i <= 90; i++) { var t = i / 90 * Math.PI * 2, w = rr * (1 + 0.022 * Math.sin(3 * t + k) + 0.014 * Math.sin(5 * t + 2 * k)); pts.push([c + Math.cos(t) * w, c + Math.sin(t) * w]); }
    el('path', { class: 'topo', d: pathOf(pts, true) }, g);
  });
  el('circle', { class: 'track', cx: c, cy: c, r: R, fill: 'none', 'stroke-width': sw }, svg);
  var arc = el('circle', { class: 'arc', cx: c, cy: c, r: R, fill: 'none', 'stroke-width': sw, 'stroke-linecap': 'round', pathLength: 100, transform: 'rotate(-90 ' + c + ' ' + c + ')' }, svg);
  arc.style.strokeDasharray = (Math.min(1, GOAL.pct) * 100) + ' 100';
  var a = GOAL.exp * Math.PI * 2 - Math.PI / 2;
  el('line', { class: 'notch', x1: c + Math.cos(a) * (R - 11), y1: c + Math.sin(a) * (R - 11), x2: c + Math.cos(a) * (R + 11), y2: c + Math.sin(a) * (R + 11) }, svg);
  var rc = $('#ring-c');
  rc.innerHTML = '<span class="c1"><span class="fig fig-i">' + GOAL.c1 + '</span><span class="u">%</span></span><span class="c2">' + GOAL.c2 + '</span>';
  rc.setAttribute('aria-label', GOAL.aria); rc.setAttribute('role', 'img');
  $('#goal-t').textContent = GOAL.t;
  $('#goal-lines').innerHTML = GOAL.lines.map(function (l) {
    return '<li class="' + l[0] + '">' + (l[1] ? F.ic(l[1]) : '<span class="notch-key" aria-hidden="true"><i></i></span>') + l[2] + '</li>';
  }).join('');
}
function renderWeek() {
  var card = $('#obj'), max = Math.max(WEEK.done, WEEK.mean) * 1.12, pc = function (x) { return (x / max * 100).toFixed(1) + '%'; };
  var over = WEEK.done >= WEEK.mean, diff = Math.round((WEEK.done - WEEK.mean) / WEEK.mean * 100);
  card.classList.add('week');
  $('#h-obj').textContent = 'Tu semana';
  card.querySelector('.card-h').style.setProperty('--ic', 'var(--acc-dist)');
  card.querySelector('.card-h > .ic use').setAttribute('href', '#i-bike');
  var edit = card.querySelector('.card-h .end'); if (edit) edit.remove();
  $('#goal-body').outerHTML =
    '<p class="card-sub">Distancia de esta semana frente a tu semana media</p>' +
    '<div class="wk">' +
      '<p class="wk-fig"><span class="fig fig-i">' + nf(WEEK.done) + '</span><span class="u">km</span></p>' +
      '<p class="wk-of">de una semana media de <b>' + nf(WEEK.mean) + ' km</b></p>' +
      '<div class="wk-bar" role="img" aria-label="Esta semana llevas ' + nf(WEEK.done) + ' km. Tu semana media es de ' + nf(WEEK.mean) + ' km y a estas alturas sueles llevar ' + nf(WEEK.pace) + ' km. Quedan ' + WEEK.daysLeft + ' días.">' +
        '<i class="tr"></i><i class="fill' + (over ? ' over' : '') + '" style="width:' + pc(WEEK.done) + '"></i>' +
        '<i class="pace" style="left:' + pc(WEEK.pace) + '"></i><i class="mean" style="left:' + pc(WEEK.mean) + '"></i>' +
      '</div>' +
      '<div class="wk-lab" aria-hidden="true"><span class="p" style="left:' + pc(WEEK.pace) + '">a estas alturas, ' + nf(WEEK.pace) + '</span><span class="m" style="left:' + pc(WEEK.mean) + '">media ' + nf(WEEK.mean) + '</span></div>' +
      '<ul class="goal-lines">' +
        '<li class="' + (over ? 'ahead' : '') + '">' + F.ic(over ? 'trend' : 'activity') + (over ? 'Un ' + nf(diff) + ' % por encima de tu semana media' : 'Un ' + nf(-diff) + ' % por debajo de tu semana media') + '</li>' +
        '<li>' + F.ic('calendar') + 'Quedan ' + WEEK.daysLeft + ' días de semana</li>' +
      '</ul>' +
    '</div>';
}

/* =====================================================================
   ProgressChart (ECharts 5, renderizador SVG)
   ===================================================================== */
var MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
var MES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// Salidas diarias sintéticas de nov 2024 a nov 2026 que suman estos totales mensuales.
var CUR = [212, 248, 395, 470, 612, 680, 702, 655, 701, 688, 590, 724];
var PREV = [168, 205, 330, 398, 540, 610, 640, 572, 610, 590, 515, 610];
var DAYS = [];
(function () {
  var r = rng(42);
  function month(y, m, target, trend) {
    var dim = new Date(y, m + 1, 0).getDate(), n = Math.max(4, Math.round(target / 62)), picks = [];
    while (picks.length < n) { var d = 1 + Math.floor(r() * dim); if (picks.indexOf(d) < 0) picks.push(d); }
    picks.sort(function (a, b) { return a - b; });
    var w = picks.map(function () { return 0.7 + r() * 0.6; }), sw = w.reduce(function (a, b) { return a + b; }, 0);
    picks.forEach(function (d, i) {
      var km = target * w[i] / sw, sp = 24.2 + trend * 2.6 + (r() - 0.5) * 1.6, el2 = km * (13 + r() * 6);
      DAYS.push({ t: new Date(y, m, d).getTime(), km: km, elev: el2, speed: sp, h: km / sp });
    });
  }
  for (var i = 0; i < 12; i++) month(2024 + (i >= 2 ? 1 : 0), (10 + i) % 12, PREV[i], i / 24);
  for (var j = 0; j < 12; j++) month(2025 + (j >= 2 ? 1 : 0), (10 + j) % 12, CUR[j], (12 + j) / 24);
  [[2, 61], [3, 64], [5, 87.6]].forEach(function (x) { DAYS.push({ t: new Date(2026, 10, x[0]).getTime(), km: x[1], elev: x[1] * 17, speed: 26.6, h: x[1] / 26.6 }); });
})();
function agg(from, to) {
  var a = { km: 0, elev: 0, h: 0, n: 0 };
  DAYS.forEach(function (d) { if (d.t >= from && d.t < to) { a.km += d.km; a.elev += d.elev; a.h += d.h; a.n++; } });
  a.speed = a.h ? a.km / a.h : null; return a;
}
function pick(a, m) { return m === 'dist' ? Math.round(a.km) : m === 'elev' ? Math.round(a.elev) : m === 'time' ? +a.h.toFixed(2) : (a.speed == null ? null : +a.speed.toFixed(1)); }
var DAY = 864e5;
function seriesFor(range, metric) {
  var labels = [], full = [], cur = [], prev = [];
  if (range === '12m') {
    for (var i = 0; i < 12; i++) {
      var y = 2025 + (i >= 2 ? 1 : 0), m = (10 + i) % 12;
      labels.push(MES[m]); full.push(MES_L[m] + ' de ' + y);
      cur.push(pick(agg(new Date(y, m, 1).getTime(), new Date(y, m + 1, 1).getTime()), metric));
      prev.push(pick(agg(new Date(y - 1, m, 1).getTime(), new Date(y - 1, m + 1, 1).getTime()), metric));
    }
    return { labels: labels, full: full, cur: cur, prev: prev };
  }
  if (range === '6m' || range === '3m') {
    var n = range === '6m' ? 26 : 13, end = new Date(2026, 10, 2).getTime(); // lunes 2 nov: semanas completas
    for (var w = n; w >= 1; w--) {
      var s = end - w * 7 * DAY, d = new Date(s);
      labels.push(d.getDate() + ' ' + MES[d.getMonth()]); full.push('semana del ' + d.getDate() + ' de ' + MES_L[d.getMonth()]);
      cur.push(pick(agg(s, s + 7 * DAY), metric)); prev.push(pick(agg(s - n * 7 * DAY, s - n * 7 * DAY + 7 * DAY), metric));
    }
    return { labels: labels, full: full, cur: cur, prev: prev };
  }
  var e30 = new Date(2026, 10, 6).getTime(), c = { km: 0, elev: 0, h: 0 }, p = { km: 0, elev: 0, h: 0 };
  for (var k = 30; k >= 1; k--) {
    var t = e30 - k * DAY, dd = new Date(t), a = agg(t, t + DAY), b = agg(t - 30 * DAY, t - 29 * DAY);
    c.km += a.km; c.elev += a.elev; c.h += a.h; p.km += b.km; p.elev += b.elev; p.h += b.h;
    labels.push(dd.getDate() + ' ' + MES[dd.getMonth()]); full.push(dd.getDate() + ' de ' + MES_L[dd.getMonth()]);
    cur.push(pick({ km: c.km, elev: c.elev, h: c.h, speed: c.h ? c.km / c.h : null }, metric));
    prev.push(pick({ km: p.km, elev: p.elev, h: p.h, speed: p.h ? p.km / p.h : null }, metric));
  }
  return { labels: labels, full: full, cur: cur, prev: prev, cumulative: true };
}
var METRIC = {
  dist: { name: 'Distancia', acc: '--acc-dist', fmt: function (v) { return nf(v) + ' km'; }, ax: function (v) { return nf(v); } },
  elev: { name: 'Desnivel', acc: '--acc-elev', fmt: function (v) { return nf(v) + ' m'; }, ax: function (v) { return nf(v); } },
  time: { name: 'Tiempo en movimiento', acc: '--acc-time', fmt: function (v) { return hm(v); }, ax: function (v) { return nf(v) + ' h'; } },
  speed: { name: 'Velocidad media', acc: '--acc-speed', fmt: function (v) { return nf(v, 1) + ' km/h'; }, ax: function (v) { return nf(v); } }
};
var RANGES = {
  '12m': ['12 meses', 'Los 12 anteriores', 'en 12 meses', 'en los 12 anteriores', 'Meses completos. Noviembre va en tus cifras de la semana.', 'últimos 12 meses', '12 meses anteriores'],
  '6m': ['26 semanas', 'Las 26 anteriores', 'en 26 semanas', 'en las 26 anteriores', 'Semanas completas, de lunes a domingo.', 'últimas 26 semanas', '26 semanas anteriores'],
  '3m': ['13 semanas', 'Las 13 anteriores', 'en 13 semanas', 'en las 13 anteriores', 'Semanas completas, de lunes a domingo.', 'últimas 13 semanas', '13 semanas anteriores'],
  '30d': ['30 días', 'Los 30 anteriores', 'en 30 días', 'en los 30 anteriores', 'Acumulado día a día frente a los 30 días anteriores.', 'últimos 30 días', '30 días anteriores']
};
var state = { range: '12m', metric: 'dist' }, chart = null, chartEl = $('#chart'), firstDraw = true;
function sum(a) { return a.reduce(function (x, y) { return x + (y || 0); }, 0); }
function meanOf(a) { var b = a.filter(function (v) { return v != null; }); return sum(b) / b.length; }
function progOption(S) {
  var M = METRIC[state.metric], acc = tok(M.acc), ink = tok('--ink'), ink2 = tok('--ink-2'), ink3 = tok('--ink-3');
  var line = tok('--line'), lineS = tok('--line-strong'), surf = tok('--surface'), surf2 = tok('--surface-2'), good = tok('--good');
  var glow = parseFloat(tok('--glow')) > 0, font = getComputedStyle(document.body).fontFamily, fig = "'Barlow Semi Condensed', 'Barlow', sans-serif";
  var vals = S.cur, li = vals.length - 1; while (vals[li] == null) li--;
  var narrow = chartEl.clientWidth < 480, isSpeed = state.metric === 'speed';
  var all = vals.concat(S.prev).filter(function (v) { return v != null; });
  var mn = isSpeed ? Math.floor(Math.min.apply(null, all) - 1) : 0;
  var anim = !reduced && firstDraw;
  var interval = state.range === '30d' ? (narrow ? 9 : 4) : state.range === '6m' ? (narrow ? 6 : 3) : state.range === '3m' ? (narrow ? 3 : 1) : (narrow ? 1 : 0);
  return {
    animation: !reduced, animationDuration: anim ? 900 : 300, animationEasing: 'cubicOut', animationDurationUpdate: reduced ? 0 : 280,
    textStyle: { fontFamily: font },
    grid: { left: 4, right: 16, top: 50, bottom: 2, containLabel: true },
    tooltip: {
      trigger: 'axis', backgroundColor: surf2, borderColor: lineS, borderWidth: 1, padding: [10, 12],
      textStyle: { color: ink, fontFamily: font, fontSize: 13 }, extraCssText: 'border-radius:12px;box-shadow:0 14px 34px -14px rgba(0,0,0,.55)',
      axisPointer: { type: 'line', lineStyle: { color: lineS, width: 1 } },
      formatter: function (p) {
        var i = p[0].dataIndex, c = S.cur[i], pv = S.prev[i], dp = c != null && pv ? (c - pv) / pv * 100 : null;
        return '<div style="color:' + ink2 + ';font-size:12.5px;margin-bottom:4px">' + S.full[i] + '</div>' +
          '<div style="display:flex;align-items:center;gap:8px"><i style="width:14px;border-top:2.5px solid ' + acc + '"></i>Actual<b style="margin-left:auto;padding-left:16px;font:700 15px ' + fig + '">' + (c == null ? 'sin salidas' : M.fmt(c)) + '</b></div>' +
          '<div style="display:flex;align-items:center;gap:8px;color:' + ink2 + ';margin-top:2px"><i style="width:14px;border-top:2px dashed ' + ink3 + '"></i>Periodo anterior<b style="margin-left:auto;padding-left:16px;font:600 14px ' + fig + '">' + (pv == null ? 'sin salidas' : M.fmt(pv)) + '</b></div>' +
          (dp == null ? '' : '<div style="margin-top:6px;font-weight:600;font-size:12.5px;color:' + (dp >= 0 ? good : ink2) + '">' + (dp >= 0 ? '+' : '') + nf(dp) + ' % frente al periodo anterior</div>') +
          '<div style="margin-top:8px;padding-top:6px;border-top:1px solid ' + line + ';color:' + ink3 + ';font-size:12px;max-width:220px;white-space:normal">' + RANGES[state.range][4] + '</div>';
      }
    },
    xAxis: {
      type: 'category', data: S.labels, boundaryGap: false,
      axisLine: { lineStyle: { color: line } }, axisTick: { show: false },
      axisLabel: { color: ink3, fontSize: 12, fontFamily: font, margin: 10, interval: interval }
    },
    yAxis: { type: 'value', min: mn, splitNumber: 3, axisLabel: { color: ink3, fontSize: 12, fontFamily: font, formatter: M.ax }, splitLine: { lineStyle: { color: line } } },
    series: [
      {
        name: 'Periodo anterior', type: 'line', data: S.prev, smooth: 0.35, smoothMonotone: 'x', connectNulls: true, symbol: 'none', silent: true, z: 1,
        lineStyle: { width: 1.6, color: ink3, type: [5, 4], opacity: 0.9 }
      },
      {
        name: 'Actual', type: 'line', data: vals, smooth: 0.35, smoothMonotone: 'x', connectNulls: true, z: 3,
        showSymbol: false, symbol: 'circle', symbolSize: 8,
        lineStyle: { width: 2.8, color: acc, shadowBlur: glow ? 14 : 0, shadowColor: hexA(acc, 0.8), cap: 'round' },
        itemStyle: { color: acc, borderColor: surf, borderWidth: 2 },
        areaStyle: { origin: 'start', color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: hexA(acc, glow ? 0.34 : 0.2) }, { offset: 1, color: hexA(acc, 0) }] } },
        markLine: { silent: true, symbol: 'none', animation: false, data: [[{ coord: [li, mn], lineStyle: { type: [2, 3], color: hexA(acc, 0.6), width: 1 }, label: { show: false } }, { coord: [li, vals[li]] }]] },
        markPoint: {
          animation: !reduced, animationDelay: anim ? 900 : 0, animationDuration: 260,
          data: [{
            coord: [li, vals[li]], symbol: 'circle', symbolSize: 14,
            itemStyle: { color: surf, borderColor: acc, borderWidth: 3, shadowBlur: glow ? 14 : 0, shadowColor: acc },
            label: {
              show: true, position: 'top', distance: 14, align: 'right', offset: [12, 0], formatter: M.fmt(vals[li]),
              backgroundColor: surf2, borderColor: acc, borderWidth: 1.5, borderRadius: 10, padding: [6, 10, 5],
              color: ink, fontFamily: fig, fontSize: 18, fontWeight: 700, fontStyle: 'italic'
            }
          }]
        }
      }
    ]
  };
}
function drawChart() {
  if (!window.echarts || EMPTY) return;
  if (!chart) chart = echarts.init(chartEl, null, { renderer: 'svg' });
  var S = seriesFor(state.range, state.metric), M = METRIC[state.metric], R = RANGES[state.range];
  chart.setOption(progOption(S), true);
  firstDraw = false;
  var isAvg = state.metric === 'speed';
  var c = S.cumulative ? S.cur[S.cur.length - 1] : isAvg ? meanOf(S.cur) : sum(S.cur);
  var p = S.cumulative ? S.prev[S.prev.length - 1] : isAvg ? meanOf(S.prev) : sum(S.prev);
  var dp = Math.round((c - p) / p * 100);
  var verb = isAvg ? 'de media ' + R[2] : R[2];
  var sumTxt = M.fmt(c) + ' ' + verb + ', ' + (dp >= 0 ? 'un ' + nf(dp) + ' % más' : 'un ' + nf(-dp) + ' % menos') + ' que ' + R[3] + '.';
  $('#prog-sum').innerHTML = '<b>' + M.name + '.</b> ' + sumTxt;
  $('#lg-cur').textContent = R[0]; $('#lg-prev').textContent = R[1];
  chartEl.setAttribute('aria-label', M.name + ', ' + R[5] + ' frente a ' + R[6] + '. ' + sumTxt + ' ' + R[4]);
  var t = $('#chart-table');
  t.innerHTML = '<caption>' + M.name + ': ' + R[5] + ' y ' + R[6] + '. ' + R[4] + '</caption><thead><tr><th scope="col">Periodo</th><th scope="col">Actual</th><th scope="col">Anterior</th></tr></thead><tbody>' +
    S.labels.map(function (l, i) { return '<tr><th scope="row" style="font-weight:500;color:inherit">' + S.full[i] + '</th><td>' + (S.cur[i] == null ? 'sin salidas' : M.fmt(S.cur[i])) + '</td><td>' + (S.prev[i] == null ? 'sin salidas' : M.fmt(S.prev[i])) + '</td></tr>'; }).join('') + '</tbody>';
}
document.querySelectorAll('[data-range]').forEach(function (b, i) {
  b.addEventListener('click', function () {
    state.range = b.dataset.range;
    document.querySelectorAll('[data-range]').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
    $('.ranges .ind').style.transform = 'translateX(' + (i * 100) + '%)';
    drawChart();
  });
});
// Las KPI del hero eligen la métrica de la gráfica: no hay pastillas aparte.
document.querySelectorAll('.kpi[data-metric]').forEach(function (b) {
  b.addEventListener('click', function () {
    state.metric = b.dataset.metric;
    document.querySelectorAll('.kpi[data-metric]').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
    $('#prog-h').style.setProperty('--ic', 'var(' + METRIC[state.metric].acc + ')');
    $('#legend').style.setProperty('--acc', 'var(' + METRIC[state.metric].acc + ')');
    drawChart();
  });
});
$('#tbl-btn').addEventListener('click', function () {
  var open = this.getAttribute('aria-expanded') !== 'true';
  this.setAttribute('aria-expanded', String(open)); $('#tbl').hidden = !open;
  this.querySelector('span').textContent = open ? 'Ocultar tabla' : 'Ver como tabla';
});

/* =====================================================================
   RideMapCard: CyclOSM, filtro oscuro como token, trazado de tres capas
   ===================================================================== */
var map;
function track() {
  // Track sintético (no es real): la misma forma «montseny» que su miniatura en Historial,
  // pasada a grados. En longitud se estira 1/cos(41,7°) para que no salga aplastada.
  return F.shapeDense('montseny').pts.map(function (p) { return [41.745 - p[1] * 0.18, 1.91 + p[0] * 0.24]; });
}
function drawUnder() {
  // Textura de carreteras y curvas de nivel bajo las teselas: el mapa nunca es un rectángulo vacío.
  var s = $('#map-under'), W = s.clientWidth || 440, H = s.clientHeight || 196, r = rng(9);
  s.setAttribute('viewBox', '0 0 ' + W + ' ' + H); s.textContent = '';
  F.topo(s, 12, W * 0.66, H * 0.42, 9, Math.max(W, H) / 12);
  for (var k = 0; k < 9; k++) {
    var y0 = r() * H, pts = [], amp = 10 + r() * 30, ph = r() * 6, fr = 0.006 + r() * 0.01;
    for (var x = -10; x <= W + 10; x += 8) pts.push([x, y0 + Math.sin(x * fr + ph) * amp + Math.sin(x * fr * 3.1 + ph) * amp * 0.25]);
    el('path', { class: 'rd' + (k < 3 ? ' main' : ''), d: F.smoothPath(pts), 'stroke-width': k < 3 ? 2 : 1 }, s);
  }
}
function initMap() {
  if (!window.L || EMPTY) return;
  map = L.map('map', { zoomControl: false, zoomSnap: 0.25, scrollWheelZoom: false, dragging: !L.Browser.mobile, tap: false,
    zoomAnimation: !reduced, fadeAnimation: !reduced, markerZoomAnimation: !reduced, attributionControl: true });
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', {
    subdomains: 'abc', maxZoom: 18,
    attribution: '<a href="https://www.cyclosm.org">CyclOSM</a> | © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  // Capa de tinte azul noche sobre las teselas (multiplica; en claro es blanco y no cambia nada)
  map.createPane('tint').style.zIndex = 250;
  L.DomUtil.create('div', 'map-tint', map.getPane('tint'));
  var t = track();
  L.polyline(t, { className: 'trk-halo', interactive: false, lineJoin: 'round' }).addTo(map);
  L.polyline(t, { className: 'trk-core', interactive: false, lineJoin: 'round' }).addTo(map);
  L.polyline(t, { className: 'trk-thread', interactive: false, lineJoin: 'round' }).addTo(map);
  L.circleMarker(t[0], { radius: 6, weight: 2.5, color: '#FFFFFF', fillColor: tok('--good'), fillOpacity: 1, interactive: false }).addTo(map);
  var small = innerWidth < 900;
  map.fitBounds(L.latLngBounds(t), { paddingTopLeft: [small ? 24 : 150, 16], paddingBottomRight: [small ? 24 : 54, 16] });
  $('#zin').onclick = function () { map.zoomIn(); };
  $('#zout').onclick = function () { map.zoomOut(); };
  $('#fs').onclick = function () {
    var w = $('#map-wrap');
    if (document.fullscreenElement) document.exitFullscreen(); else if (w.requestFullscreen) w.requestFullscreen();
  };
  document.addEventListener('fullscreenchange', function () { setTimeout(function () { map.invalidateSize(); }, 60); });
}

/* ---------- Arranque: un único momento orquestado ---------- */
function renderAll() {
  buildHero();
  if (EMPTY) return;
  document.querySelectorAll('.spark').forEach(renderSpark);
  drawUnder();
  F.renderProfile(document.querySelector('[data-prof="last"]'), LAST, { axis: true, peak: true });
  if (FASE >= 4) F.renderProfile(document.querySelector('[data-prof="route"]'), ROUTE, { peak: true });
}
if (!EMPTY) {
  F.renderLegend(document.querySelector('[data-prof="last"] [data-legend]'), LAST);
  F.renderLegend(document.querySelector('[data-prof="route"] [data-legend]'), ROUTE);
  renderStats(); if (FASE >= 3) renderRing(); else renderWeek();
}
F.onTheme(function () { drawChart(); if (map) map.invalidateSize(); });
var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
ready.then(function () {
  renderAll();
  drawChart();
  initMap();
  requestAnimationFrame(function () {
    document.body.classList.add('ready');
    summitEl.classList.add('on');   // el fundido espera al trazo por CSS (transition-delay)
    setTimeout(function () { document.body.setAttribute('data-settled', ''); }, reduced ? 0 : 900);
  });
  var pending = 0, lastW = 0;
  new ResizeObserver(function () {
    var w = $('#home').clientWidth; if (w === lastW) return; lastW = w;
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(function () { renderAll(); if (chart) chart.resize(); if (map) map.invalidateSize(); });
  }).observe($('#home'));
});
})();
