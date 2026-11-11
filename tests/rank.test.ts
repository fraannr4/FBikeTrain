import type { UserReference } from '../src/metrics/reference';
import { rankForTarget, type RankCard } from '../src/routes/rank';

// Datos sintéticos: ids y nombres inventados. Las tarjetas llevan campos extra para comprobar que se conservan.
type WikilocCard = RankCard & { nombre: string; dificultad: string | null; autor: string | null; url: string };
const card = (over: Partial<WikilocCard> = {}): WikilocCard => ({
  id: '1001', nombre: 'Vuelta sintética', km: 75, desnivelM: 900, dificultad: 'moderado', autor: 'Autor de prueba',
  url: 'https://es.wikiloc.com/rutas-ciclismo/vuelta-sintetica-1001', ...over,
});
const REF: UserReference = {
  source: 'history', weeks: 8, rides: 10, ridesPerWeek: 1.25, avgDistanceM: 75_000, avgElevGainM: 800,
  avgMovingTimeS: 10_000, avgSpeedMs: 7, longestDistanceM: 120_000, maxElevGainM: 1800,
};

describe('rankForTarget', () => {
  it('admite de 0,5× a 1,6× la distancia pedida y explica cada descarte', () => {
    const cards = [
      card({ id: '1', km: 37 }), card({ id: '2', km: 37.5 }), card({ id: '3', km: 120 }), card({ id: '4', km: 121 }),
    ];
    const { ranked, discarded } = rankForTarget(cards, { distanceKm: 75 }, null);
    expect(ranked.map(r => r.card.id).sort()).toEqual(['2', '3']);
    expect(discarded).toEqual([
      { card: cards[0], motivo: 'Demasiado corta: 37 km frente a 75 km pedidos (mínimo 38 km).' },
      { card: cards[3], motivo: 'Demasiado larga: 121 km frente a 75 km pedidos (máximo 120 km).' },
    ]);
  });
  it('ordena por cercanía relativa a la distancia y dice si se recorta o se alarga', () => {
    const cards = [card({ id: '1', km: 106.44 }), card({ id: '2', km: 73 }), card({ id: '3', km: 50 }), card({ id: '4', km: 80 })];
    const { ranked } = rankForTarget(cards, { distanceKm: 75 }, null);
    expect(ranked.map(r => r.card.id)).toEqual(['2', '4', '3', '1']);
    expect(ranked.map(r => r.ajuste)).toEqual(['encaja', 'encaja', 'alargar', 'recortar']);
    expect(ranked[0].motivo).toBe('Encaja: 73 km frente a 75 km pedidos.');
    expect(ranked[2].motivo).toBe('Se alarga de 50 km a 75 km.');
    expect(ranked[3].motivo).toBe('Se recorta de 106 km a 75 km.');
  });
  it('recorta por encima de +8 % y alarga por debajo de −20 %, como la adaptación', () => {
    const { ranked } = rankForTarget([card({ id: '1', km: 81 }), card({ id: '2', km: 81.1 }), card({ id: '3', km: 60 }), card({ id: '4', km: 59.9 })], { distanceKm: 75 }, null);
    const ajuste = Object.fromEntries(ranked.map(r => [r.card.id, r.ajuste]));
    expect(ajuste).toEqual({ 1: 'encaja', 2: 'recortar', 3: 'encaja', 4: 'alargar' });
  });
  it('si se pide desnivel, también ordena por él y nunca descarta por desnivel', () => {
    const cards = [
      card({ id: '1', km: 75, desnivelM: 2400 }),
      card({ id: '2', km: 78, desnivelM: 1000 }),
      card({ id: '3', km: 76, desnivelM: null }),
    ];
    const { ranked, discarded } = rankForTarget(cards, { distanceKm: 75, elevGainM: 1000 }, null);
    expect(discarded).toEqual([]);
    expect(ranked.map(r => r.card.id)).toEqual(['2', '3', '1']);
    expect(ranked[0].motivo).toBe('Encaja: 78 km frente a 75 km pedidos. Desnivel: 1000 m frente a 1000 m pedidos.');
    expect(ranked[1].motivo).toBe('Encaja: 76 km frente a 75 km pedidos. Desnivel sin dato.');
  });
  it('sin desnivel pedido, el desnivel no cambia el orden', () => {
    const { ranked } = rankForTarget([card({ id: '1', km: 76, desnivelM: 3000 }), card({ id: '2', km: 78, desnivelM: 100 })], { distanceKm: 75 }, null);
    expect(ranked.map(r => r.card.id)).toEqual(['1', '2']);
  });
  it('el nivel solo pone la etiqueta y desempata: nunca descarta', () => {
    const cards = [
      card({ id: '1', km: 70, desnivelM: 3000 }), // Dura para la referencia
      card({ id: '2', km: 80, desnivelM: 800 }), // Media
      card({ id: '3', km: 116, desnivelM: 2000 }), // Dura y larga, pero dentro del margen
    ];
    const { ranked, discarded } = rankForTarget(cards, { distanceKm: 75 }, REF);
    expect(discarded).toEqual([]);
    // 1 y 2 están igual de cerca (5 km); desempata la Media.
    expect(ranked.map(r => r.card.id)).toEqual(['2', '1', '3']);
    expect(ranked.map(r => r.etiqueta)).toEqual(['Media', 'Dura', 'Dura']);
  });
  it('sin referencia no hay etiqueta y el empate se resuelve por id', () => {
    const { ranked } = rankForTarget([card({ id: '2', km: 80 }), card({ id: '1', km: 70 })], { distanceKm: 75 }, null);
    expect(ranked.map(r => [r.card.id, r.etiqueta])).toEqual([['1', null], ['2', null]]);
  });
  it('no modifica la lista recibida', () => {
    const cards = [card({ id: '1', km: 100 }), card({ id: '2', km: 75 })];
    const copy = structuredClone(cards);
    rankForTarget(cards, { distanceKm: 75 }, REF);
    expect(cards).toEqual(copy);
  });
  it('rechaza una distancia pedida no válida', () => {
    expect(() => rankForTarget([card()], { distanceKm: 0 }, null)).toThrow();
    expect(() => rankForTarget([card()], { distanceKm: Number.NaN }, null)).toThrow();
    expect(() => rankForTarget([card()], { distanceKm: 75, elevGainM: -1 }, null)).toThrow();
  });
});
