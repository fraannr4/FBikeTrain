import type { LatLng } from '../domain/types';

/**
 * Cómo pega el viento en una vuelta. Función pura sobre la geometría: por cada tramo, componente de cara =
 * velocidad × cos(rumbo − dirección de la que sopla el viento), ponderada por su longitud. Positivo es de cara
 * y negativo, a favor. La IA no interviene: las cifras salen de aquí.
 */

/** Por debajo de esta velocidad (km/h) el viento no condiciona la elección de ruta. */
export const CALM_KMH = 10;
/** Un tramo es de cara o a favor si el viento queda a menos de 60 grados de su eje (cos >= 0,5). */
const AXIS_COS = 0.5;
/** Una mitad es «de cara» o «a favor» si su media supera esta fracción de la velocidad. */
const HALF_FRACTION = 0.25;

export type WindEffect = {
  speedKmh: number;
  /** Grados de los que sopla el viento (0 norte, 90 este). */
  fromDeg: number;
  calm: boolean;
  /** Componente media de cara en km/h de cada mitad del recorrido: positivo de cara, negativo a favor. */
  halves: { first: number; second: number };
  /** Fracción de los km de cada tipo; suma 1 (o 0 si no hay tramos). */
  share: { head: number; tail: number; cross: number };
};

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const RAD = Math.PI / 180;

/** Punto cardinal en español: 0 N, 90 E, 180 S, 270 O. */
export function cardinal(deg: number): string {
  return CARDINALS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export function windEffect(points: LatLng[], fromDeg: number, speedKmh: number): WindEffect {
  const segs: { len: number; c: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * RAD);
    const dy = b.lat - a.lat;
    const len = Math.hypot(dx, dy) * 111_320;
    if (len > 0) segs.push({ len, c: Math.cos(Math.atan2(dx, dy) - fromDeg * RAD) });
  }
  const total = segs.reduce((s, x) => s + x.len, 0);
  const sum = { first: 0, second: 0 };
  const len = { first: 0, second: 0 };
  const km = { head: 0, tail: 0, cross: 0 };
  let done = 0;
  for (const { len: l, c } of segs) {
    // Un tramo que cruza la mitad reparte su longitud entre las dos.
    const inFirst = Math.max(0, Math.min(l, total / 2 - done));
    const inSecond = l - inFirst;
    sum.first += inFirst * c * speedKmh;
    len.first += inFirst;
    sum.second += inSecond * c * speedKmh;
    len.second += inSecond;
    km[c >= AXIS_COS ? 'head' : c <= -AXIS_COS ? 'tail' : 'cross'] += l;
    done += l;
  }
  const share = total > 0 ? { head: km.head / total, tail: km.tail / total, cross: km.cross / total } : { head: 0, tail: 0, cross: 0 };
  return {
    speedKmh,
    fromDeg,
    calm: speedKmh < CALM_KMH,
    halves: { first: len.first > 0 ? sum.first / len.first : 0, second: len.second > 0 ? sum.second / len.second : 0 },
    share,
  };
}

type Kind = 'head' | 'tail' | 'side';

function kindOf(mean: number, speedKmh: number): Kind {
  if (mean >= speedKmh * HALF_FRACTION) return 'head';
  if (mean <= -speedKmh * HALF_FRACTION) return 'tail';
  return 'side';
}

const OUT: Record<Exclude<Kind, 'side'>, string> = { head: 'de cara a la ida', tail: 'a favor a la ida' };
const BACK: Record<Exclude<Kind, 'side'>, string> = { head: 'de cara al volver', tail: 'a favor al volver' };
const WHOLE: Record<Kind, string> = { head: 'Viento de cara en la vuelta', tail: 'Viento a favor en la vuelta', side: 'Viento de lado en la vuelta' };
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Frase corta para la tarjeta: «De cara a la ida y a favor al volver (18 km/h del NO)». */
export function windSummary(e: WindEffect): string {
  const tag = `${Math.round(e.speedKmh)} km/h del ${cardinal(e.fromDeg)}`;
  if (e.calm) return `Viento flojo (${tag})`;
  const first = kindOf(e.halves.first, e.speedKmh);
  const second = kindOf(e.halves.second, e.speedKmh);
  if (first === second) return `${WHOLE[first]} (${tag})`;
  if (first === 'side') return `${upper(BACK[second as 'head' | 'tail'])} (${tag})`;
  if (second === 'side') return `${upper(OUT[first])} (${tag})`;
  return `${upper(OUT[first])} y ${BACK[second]} (${tag})`;
}
