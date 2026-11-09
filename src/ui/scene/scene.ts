// Paisaje procedimental del hero (design-system.md, «Hero con SceneSvg»). Funciones puras:
// SceneSvg solo pinta lo que devuelven. La cresta cercana y la carretera salen del perfil
// de tu última salida; el resto (crestas lejanas, estrellas) es decorado con semilla fija.
import { reduceProfile, type ProfilePoint } from '../profile';
import { rng } from '../topo';

/** Generador pseudoaleatorio con semilla. */
export const mulberry32 = rng;

type Pt = [number, number];
type Box = { right: number; bottom: number };

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0 || 1));
  return t * t * (3 - 2 * t);
}

/** `M x y L x y …` con un decimal. */
export function pathOf(pts: Pt[], close = false): string {
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f1(x)} ${f1(y)}`).join('') + (close ? 'Z' : '');
}

/** Ruido 1D por desplazamiento del punto medio, normalizado a [0, 1]. */
function midpoint(seed: number, n: number, rough: number): number[] {
  const r = mulberry32(seed);
  const N = 1 << n;
  const v = new Array<number>(N + 1).fill(0);
  v[0] = r();
  v[N] = r();
  for (let step = N, amp = 1; step > 1; step >>= 1, amp *= rough) {
    const h = step >> 1;
    for (let i = h; i < N; i += step) v[i] = (v[i - h] + v[i + h]) / 2 + (r() - 0.5) * amp;
  }
  const mn = Math.min(...v);
  const span = Math.max(...v) - mn || 1;
  return v.map((x) => (x - mn) / span);
}

function sample(a: number[], t: number): number {
  const l = clamp01(t) * (a.length - 1);
  const i = Math.floor(l);
  const j = Math.min(a.length - 1, i + 1);
  return a[i] + (a[j] - a[i]) * (l - i);
}

// ---------------------------------------------------------------------------
// Crestas lejanas
// ---------------------------------------------------------------------------

/** De la más lejana a la más cercana: techo relativo, pie, amplitud y bruma. */
const LAYERS = [
  { cap: 0, lo: 0.5, amp: 0.9, mist: 0.6, rough: 0.58 },
  { cap: 0.16, lo: 0.6, amp: 0.85, mist: 0.45, rough: 0.55 },
  { cap: 0.34, lo: 0.7, amp: 0.78, mist: 0.32, rough: 0.52 },
  { cap: 0.52, lo: 0.8, amp: 0.7, mist: 0.2, rough: 0.5 },
];

export type RidgeLayer = {
  /** Relleno de la cresta hasta el pie del hero. */
  d: string;
  /** Solo el perfil, para el filo de luz. */
  line: string;
  /** Donde empieza su bruma (la media de la cresta). Crece hacia delante. */
  mistTop: number;
  mistBottom: number;
  mist: number;
};

/**
 * Cuatro crestas de fondo, de la más lejana a la más cercana: cada una más baja que la de
 * detrás (perspectiva atmosférica). Con `textBox`, bajan a la izquierda para dejar sitio
 * al saludo; `top` fija su techo (en el móvil, justo bajo el texto).
 */
export function ridgeLayers(
  width: number,
  height: number,
  horizon: number,
  seed: number,
  opts: { top?: number; textBox?: Box } = {},
): RidgeLayer[] {
  const top0 = opts.top ?? height * 0.12;
  const span = Math.max(0, horizon - top0);
  const tb = opts.textBox;
  const env = tb ? (x: number) => smoothstep(tb.right - 60, tb.right + 260, x) : () => 1;
  const leftRoof = tb ? tb.bottom - 40 : -Infinity;
  const step = Math.max(3, width / 320);
  const out: RidgeLayer[] = [];
  let prevAvg = -Infinity;

  LAYERS.forEach((L, k) => {
    const noise = midpoint(seed * 7 + k * 101, 8, L.rough);
    const free = top0 + span * L.cap;
    const pts: Pt[] = [];
    for (let x = 0; x <= width + step; x += step) {
      const cap = lerp(Math.max(free, leftRoof + k * 18), free, env(x));
      const floor = lerp(cap, horizon, L.lo);
      pts.push([x, floor - L.amp * sample(noise, x / (width || 1)) * (floor - cap)]);
    }
    let avg = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    // Garantía de la perspectiva: si el ruido la deja por encima de la de detrás, se baja.
    const minAvg = prevAvg + 8;
    if (avg < minAvg) {
      const dy = minAvg - avg;
      for (const p of pts) p[1] += dy;
      avg = minAvg;
    }
    prevAvg = avg;
    const line = pathOf(pts);
    const mistTop = avg - 6;
    out.push({
      d: `${line}L${f1(width + step)} ${f1(height)}L0 ${f1(height)}Z`,
      line,
      mistTop,
      mistBottom: Math.max(mistTop + 1, Math.min(height, avg + (horizon - avg) * 0.85)),
      mist: L.mist,
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Subidas y carretera
// ---------------------------------------------------------------------------

export type Climb = { from: number; to: number; gainM: number };

/** Tramos de subida continua (de un mínimo a un máximo) con al menos `minGainM` de desnivel. */
export function climbs(profile: ProfilePoint[], minGainM = 80): Climb[] {
  const out: Climb[] = [];
  if (profile.length < 2) return out;
  let lo = profile[0];
  let hi = profile[0];
  for (let i = 1; i < profile.length; i++) {
    const p = profile[i];
    if (p.ele > hi.ele) hi = p;
    const dropped = hi.ele - p.ele > minGainM;
    if (dropped || i === profile.length - 1) {
      if (hi.ele - lo.ele > minGainM) out.push({ from: lo.dM, to: hi.dM, gainM: hi.ele - lo.ele });
      lo = p;
      hi = p;
    } else if (p.ele < lo.ele && hi.ele - lo.ele <= minGainM) {
      lo = p;
      hi = p;
    }
  }
  return out;
}

export type RoadPoint = { x: number; y: number; w: number };

/**
 * La carretera en primer plano, de abajo a la cima. Un tramo de aproximación y una pierna
 * por subida: cada pierna termina en una curva de herradura y la última llega a la cima.
 * La altura de cada pierna es proporcional al desnivel de su subida y su anchura lateral,
 * a su longitud. Amplitud y ancho (`w`) menguan con la altura: perspectiva.
 */
export function roadPoints(
  profile: ProfilePoint[],
  box: { width: number; baseY: number; summit: { x: number; y: number }; maxAmp: number },
): RoadPoint[] {
  const { width, baseY, summit, maxAmp } = box;
  let cs = climbs(profile);
  if (cs.length === 0) cs = [{ from: 0, to: 1, gainM: 1 }];
  const n = cs.length;
  const R = Math.max(1, baseY - summit.y);
  const totalGain = cs.reduce((s, c) => s + c.gainM, 0) || 1;
  const lens = cs.map((c) => Math.max(0, c.to - c.from));
  const maxLen = Math.max(...lens) || 1;

  // Pierna 0: aproximación. Pierna j (1..n): la subida j − 1.
  const rises = [0.12 * R, ...cs.map((c) => (0.88 * R * c.gainM) / totalGain)];
  const legLen = [lens[0], ...lens];
  const half = (len: number, y: number) => {
    const t = clamp01((baseY - y) / R);
    return 0.5 * maxAmp * (0.45 + (0.55 * len) / maxLen) * (1 - 0.8 * t);
  };
  // El lado de cada herradura alterna; la última queda a la derecha de la cima.
  const side = (j: number) => ((n - 1 - j) % 2 === 0 ? 1 : -1);

  const pts: Pt[] = [];
  let y = baseY;
  let x = summit.x - side(0) * half(legLen[0], baseY);
  const STEPS = 28;
  for (let j = 0; j <= n; j++) {
    const y1 = y - rises[j];
    const x1 = j === n ? summit.x : summit.x + side(j) * half(legLen[j], y1);
    for (let u = j === 0 ? 0 : 1; u <= STEPS; u++) {
      const e = u / STEPS;
      const ee = (1 - Math.cos(Math.PI * e)) / 2;
      pts.push([x + (x1 - x) * ee, y - rises[j] * e]);
    }
    x = x1;
    y = y1;
  }
  pts[pts.length - 1] = [summit.x, summit.y];

  return pts.map(([px, py]) => {
    const t = clamp01((baseY - py) / R);
    return { x: px, y: py, w: Math.max(1.2, width * Math.pow(1 - t, 1.4)) };
  });
}

/** Cinta rellena alrededor de la carretera, con el ancho de cada punto. */
export function ribbon(pts: RoadPoint[], extra = 0): string {
  const L: Pt[] = [];
  const Rr: Pt[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const h = (p.w + extra) / 2;
    L.push([p.x + nx * h, p.y + ny * h]);
    Rr.push([p.x - nx * h, p.y - ny * h]);
  });
  return pathOf(L.concat(Rr.reverse()), true);
}

// ---------------------------------------------------------------------------
// Cresta cercana: tu última salida
// ---------------------------------------------------------------------------

export type NearRidge = {
  fill: string;
  line: string;
  contours: string[];
  /** Vértices de la línea, para que el rótulo de la cima no la pise. */
  points: [number, number][];
  summit: { x: number; y: number; ele: number; dM: number };
};

/**
 * La cresta de tu última salida: el perfil reducido a 240 vértices como mucho y
 * suavizado (sin tocar la cima), con 10 curvas de nivel. `roof(x)`, si se da, sustituye a
 * `top` como techo en cada x (en escritorio, más bajo bajo el saludo).
 */
export function nearRidge(
  profile: ProfilePoint[],
  box: { width: number; height: number; top: number; bottom: number; roof?: (x: number) => number },
): NearRidge {
  const { width, height, top, bottom, roof } = box;
  let pts = reduceProfile(profile, 240);
  if (pts.length === 0) pts = [{ dM: 0, ele: 0 }];
  if (pts.length === 1) pts = [pts[0], { dM: pts[0].dM + 1, ele: pts[0].ele }];

  let iTop = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i].ele > pts[iTop].ele) iTop = i;
  const emin = Math.min(...pts.map((p) => p.ele));
  const eSpan = pts[iTop].ele - emin || 1;
  const d0 = pts[0].dM;
  const dSpan = pts[pts.length - 1].dM - d0 || 1;

  // Media móvil de 5 puntos; la cima conserva su altitud para que el rótulo caiga en la línea.
  const smooth = pts.map((p, i) => {
    if (i === iTop) return p.ele;
    let s = 0;
    let c = 0;
    for (let k = -2; k <= 2; k++) {
      const q = pts[i + k];
      if (q) {
        s += q.ele;
        c++;
      }
    }
    return s / c;
  });

  const line: Pt[] = pts.map((p, i) => {
    const x = ((p.dM - d0) / dSpan) * width;
    const roofY = roof ? roof(x) : top;
    const e = (smooth[i] - emin) / eSpan;
    return [x, bottom - (0.08 + 0.92 * e) * (bottom - roofY)];
  });

  const contours: string[] = [];
  for (let k = 1; k <= 10; k++) {
    const wob = 52 + k * 7;
    contours.push(pathOf(line.map(([x, y]) => [x, Math.min(height, y + k * 9 + Math.sin(x / wob) * k * 0.7)])));
  }

  const lineD = pathOf(line);
  return {
    fill: `${lineD}L${f1(width)} ${f1(height)}L0 ${f1(height)}Z`,
    line: lineD,
    contours,
    points: line,
    summit: { x: line[iTop][0], y: line[iTop][1], ele: pts[iTop].ele, dM: pts[iTop].dM },
  };
}

// ---------------------------------------------------------------------------
// Rótulo de la cima
// ---------------------------------------------------------------------------

type Rect = { x: number; y: number; w: number; h: number };

/** Del centro del vértice al texto del rótulo: medio vértice (8), la guía (20) y aire (6). */
export const SUMMIT_GAP = 34;

export type SummitPlace = {
  /** Esquina superior izquierda del texto del rótulo (el vértice va aparte, en la cima). */
  x: number;
  y: number;
  /** A qué lado de la cima queda el texto; `up`, encima y sin guía. */
  side: 'left' | 'right' | 'up';
  /** `false`: no cabe en ningún sitio sin pisar nada; el hero deja solo el vértice. */
  fits: boolean;
  /** Cabe solo en su versión estrecha (el texto en dos líneas). */
  narrow?: boolean;
};

/**
 * Coloca el texto del rótulo de la cima (`label`, sin el vértice) a su derecha, con la guía, y si
 * choca con algo de `avoid` (el saludo, la barra superior, la cresta) o se sale del hero, a su
 * izquierda; luego, a cada lado pero más alto; luego encima de la cima, centrado y desplazándose
 * a un lado y a otro sin alejarse de ella. Si no cabe y hay versión estrecha (`narrow`, el texto
 * en dos líneas), prueba con ella. Si tampoco, `fits: false`. El vértice siempre está en la cima.
 */
export function placeSummitLabel(
  summit: { x: number; y: number },
  label: { w: number; h: number },
  avoid: Rect[],
  width: number,
  narrow?: { w: number; h: number },
): SummitPlace {
  const wide = placeLabel(summit, label, avoid, width);
  if (wide.fits || !narrow) return wide;
  const thin = placeLabel(summit, narrow, avoid, width);
  return thin.fits ? { ...thin, narrow: true } : wide;
}

function placeLabel(
  summit: { x: number; y: number },
  label: { w: number; h: number },
  avoid: Rect[],
  width: number,
  gap = SUMMIT_GAP,
): SummitPlace {
  const mid = summit.y - 9; // centro del vértice
  const y = Math.max(6, mid - label.h / 2);
  const clash = (c: { x: number; y: number }) =>
    c.x < 8 ||
    c.x + label.w > width - 8 ||
    avoid.some((r) => c.x < r.x + r.w + 8 && c.x + label.w > r.x - 8 && c.y < r.y + r.h + 6 && c.y + label.h > r.y - 6);
  const right: SummitPlace = { x: summit.x + gap, y, side: 'right', fits: true };
  const left: SummitPlace = { x: summit.x - gap - label.w, y, side: 'left', fits: true };
  if (!clash(right)) return right;
  if (!clash(left)) return left;
  // Un poco más alto, con la guía a la altura de su pie: libra la cresta de al lado.
  const high = Math.max(6, mid + 4 - label.h);
  for (const c of [{ ...right, y: high }, { ...left, y: high }]) if (!clash(c)) return c;
  // Encima: el pie del texto, 6 px sobre la punta del vértice (8 px por encima de su centro).
  const upY = summit.y - 9 - 8 - 6 - label.h;
  if (upY >= 6) {
    const center = summit.x - label.w / 2;
    const reach = label.w / 2 + 16; // el texto sigue tocando la vertical de la cima, o casi
    for (let d = 0; d <= reach; d += 8)
      for (const x of d === 0 ? [center] : [center + d, center - d])
        if (!clash({ x, y: upY })) return { x, y: upY, side: 'up', fits: true };
  }
  const pick = summit.x > width / 2 ? left : right;
  return { ...pick, x: Math.max(8, Math.min(width - label.w - 8, pick.x)), fits: false };
}

// ---------------------------------------------------------------------------
// Decorado sin datos
// ---------------------------------------------------------------------------

/** Cresta fija para el estado vacío y las salidas sin altitud: no es un dato. */
export const DECOR_PROFILE: ProfilePoint[] = (() => {
  const nodes: Pt[] = [
    [0, 200],
    [20, 420],
    [35, 380],
    [55, 760],
    [62, 700],
    [80, 420],
    [100, 260],
  ];
  const out: ProfilePoint[] = [];
  for (let k = 0; k < nodes.length - 1; k++) {
    const [d0, e0] = nodes[k];
    const [d1, e1] = nodes[k + 1];
    for (let d = d0; d < d1; d += 1) out.push({ dM: d * 1000, ele: lerp(e0, e1, smoothstep(d0, d1, d)) });
  }
  out.push({ dM: 100_000, ele: 260 });
  return out;
})();

// ---------------------------------------------------------------------------
// Composición completa
// ---------------------------------------------------------------------------

export type SceneInput = {
  profile: ProfilePoint[];
  width: number;
  height: number;
  /** Esquina inferior derecha del texto del saludo, relativa al hero. */
  textBox: Box;
  /** Donde se apoya el paisaje: la parte alta de las KPI. Sin KPI, el pie del hero. */
  groundY?: number;
  /** Pie de la barra superior: la cresta no sube por encima. */
  topbarBottom?: number;
};

export type Scene = {
  horizon: number;
  mobile: boolean;
  stars: { x: number; y: number; r: number; o: number }[];
  orb: { x: number; y: number; r: number; glowR: number };
  layers: RidgeLayer[];
  near: NearRidge;
  road: { edge: string; body: string; dash: string | null };
  scrim: { x: number; y: number; r: number };
};

/** Todo el paisaje para un hero de `width` × `height`. */
export function sceneLayout({ profile, width: W, height: H, textBox: tb, groundY, topbarBottom = 0 }: SceneInput): Scene {
  const mobile = W < 700;
  const base = groundY === undefined ? H : groundY + (mobile ? 44 : 56);
  const horizon = mobile ? base - 30 : base - 60;
  const env = (x: number) => (mobile ? 1 : smoothstep(tb.right - 60, tb.right + 260, x));

  // La cresta cercana va primero: la luna o el sol se pone detrás de su cima. En el móvil la cima
  // baja con el hueco entre la frase y las KPI (como en el prototipo, una franja corta): a media
  // altura, para que el rótulo quepa encima sin tocar la frase.
  const land = (groundY ?? H) - tb.bottom;
  const nearHi = mobile
    ? tb.bottom + Math.min(70, Math.max(12, land * 0.6))
    : Math.max(H * 0.2, topbarBottom + 16) + (W < 1080 ? 30 : 0);
  const nearFloor = mobile ? base - 26 : base - 40;
  const nearLeft = mobile ? nearFloor - 40 : Math.min(nearFloor - 30, tb.bottom + 40);
  const near = nearRidge(profile, {
    width: W,
    height: H,
    top: nearHi,
    bottom: nearFloor,
    roof: (x) => lerp(nearLeft, nearHi, env(x)),
  });

  const r = mulberry32(77);
  const stars: Scene['stars'] = [];
  const nStars = Math.round((W * H) / 3800);
  for (let s = 0; s < nStars; s++) {
    const y = Math.pow(r(), 1.6) * horizon * 0.82;
    const big = r() > 0.93;
    stars.push({ x: r() * W, y, r: big ? 1.25 : 0.5 + r() * 0.45, o: big ? 0.9 : 0.22 + r() * 0.5 });
  }

  const orbR = mobile ? 22 : 30;
  const layers = ridgeLayers(W, H, horizon, 11, mobile ? { top: tb.bottom + 6 } : { textBox: tb });

  const roadBase = mobile ? H - 6 : Math.min(H + 4, base + 20);
  const rp = roadPoints(profile, {
    width: mobile ? 20 : 30,
    baseY: roadBase,
    summit: { x: near.summit.x, y: near.summit.y + 5 },
    maxAmp: mobile ? Math.min(170, W * 0.42) : Math.min(300, W * 0.22),
  });
  const dashPts = rp.filter((p) => p.w > 8).map((p): Pt => [p.x, p.y]);

  return {
    horizon,
    mobile,
    stars,
    orb: { x: near.summit.x, y: near.summit.y + orbR * 0.2, r: orbR, glowR: Math.max(W * 0.45, 300) },
    layers,
    near,
    road: { edge: ribbon(rp, 2.6), body: ribbon(rp), dash: dashPts.length > 2 ? pathOf(dashPts) : null },
    scrim: mobile
      ? { x: W * 0.3, y: tb.bottom * 0.5, r: W * 0.9 }
      : { x: Math.max(tb.right * 0.42, 160), y: Math.max(tb.bottom, 120) * 0.5, r: Math.max(tb.right, 260) * 0.92 },
  };
}
