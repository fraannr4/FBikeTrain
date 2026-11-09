import type { ProfilePoint } from '../profile';

/** Clase de pendiente 0-5, la escala del libro de ruta (tokens `--g0`...`--g5`). */
export type GradeClass = 0 | 1 | 2 | 3 | 4 | 5;

/** Rótulo de cada clase, en el orden de la escala. */
export const GRADE_LABELS = ['Llano o bajada', '1–4 %', '4–7 %', '7–10 %', '10–16 %', '16 % o más'] as const;

/** Menos del 1 % y bajadas, 0; 1-4 %, 1; 4-7 %, 2; 7-10 %, 3; 10-16 %, 4; 16 % o más, 5. */
export function gradeClass(pct: number): GradeClass {
  if (!Number.isFinite(pct) || pct < 1) return 0;
  if (pct < 4) return 1;
  if (pct < 7) return 2;
  if (pct < 10) return 3;
  if (pct < 16) return 4;
  return 5;
}

/** Tramo mínimo con el que se mide la pendiente (m): por debajo, el ruido del GPS manda. */
const MIN_BIN_M = 100;
/** Tramos como mucho: un perfil de 72 px no necesita más. */
const MAX_BINS = 120;

/** Altitud interpolada a cada distancia de `marks` (ascendentes) sobre el perfil ordenado. */
function sampleAt(p: ProfilePoint[], marks: number[]): number[] {
  const out: number[] = [];
  let j = 0;
  for (const m of marks) {
    while (j < p.length - 2 && p[j + 1].dM < m) j++;
    const a = p[j];
    const b = p[j + 1];
    const span = b.dM - a.dM;
    const f = span > 0 ? Math.min(1, Math.max(0, (m - a.dM) / span)) : 0;
    out.push(a.ele + (b.ele - a.ele) * f);
  }
  return out;
}

/** Perfil remuestreado en tramos iguales: distancias, altitudes y la clase de cada tramo. */
function resample(profile: ProfilePoint[]): { marks: number[]; ele: number[]; cls: GradeClass[] } | null {
  const p = profile.filter((q) => Number.isFinite(q.dM) && Number.isFinite(q.ele));
  if (p.length < 2) return null;
  const sorted = p[0].dM <= p[p.length - 1].dM ? p : [...p].reverse();
  const from = sorted[0].dM;
  const total = sorted[sorted.length - 1].dM - from;
  if (!(total > 0)) return null;
  const bins = Math.max(1, Math.min(MAX_BINS, Math.floor(total / MIN_BIN_M)));
  const marks = Array.from({ length: bins + 1 }, (_, i) => from + (total * i) / bins);
  const ele = sampleAt(sorted, marks);
  const step = total / bins;
  const cls = ele.slice(1).map((e, i) => gradeClass(((e - ele[i]) / step) * 100));
  return { marks, ele, cls };
}

/** La clase más dura del perfil; `null` sin perfil. */
export function hardestGrade(profile: ProfilePoint[]): GradeClass | null {
  const r = resample(profile);
  if (!r) return null;
  return r.cls.reduce<GradeClass>((max, c) => (c > max ? c : max), 0);
}

export type ProfileBands = {
  /** Un polígono por tramo seguido de la misma clase, cerrado contra la base. */
  polygons: { cls: GradeClass; points: string }[];
  /** Línea del perfil, para el borde. */
  edge: string;
  /** Clases presentes, ordenadas: la leyenda solo enseña estas. */
  present: GradeClass[];
};

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

/**
 * Geometría del perfil coloreado por pendiente en una caja de `width` × `height`, como FBT.profile:
 * la base queda un 12 % del desnivel por debajo del mínimo para que el llano no pegue con el borde.
 * `null` si no hay al menos dos puntos separados por alguna distancia.
 */
export function profileBands(profile: ProfilePoint[], box: { width: number; height: number }): ProfileBands | null {
  const r = resample(profile);
  if (!r) return null;
  const { width: W, height: H } = box;
  const max = Math.max(...r.ele);
  const min = Math.min(...r.ele);
  const lo = min - (max - min) * 0.12;
  const span = max - lo || 1;
  const n = r.ele.length;
  const X = (i: number) => (i / (n - 1)) * W;
  const Y = (v: number) => H - ((v - lo) / span) * (H - 4);

  const polygons: ProfileBands['polygons'] = [];
  const present = new Set<GradeClass>();
  let i = 0;
  while (i < n - 1) {
    const c = r.cls[i];
    let j = i;
    while (j < n - 1 && r.cls[j] === c) j++;
    const pts: string[] = [`${f1(X(i))},${H}`];
    for (let k = i; k <= j; k++) pts.push(`${f1(X(k))},${f1(Y(r.ele[k]))}`);
    pts.push(`${f1(X(j))},${H}`);
    polygons.push({ cls: c, points: pts.join(' ') });
    present.add(c);
    i = j;
  }
  const edge = r.ele.map((v, k) => `${k ? 'L' : 'M'}${f1(X(k))} ${f1(Y(v))}`).join('');
  return { polygons, edge, present: [...present].sort((a, b) => a - b) };
}
