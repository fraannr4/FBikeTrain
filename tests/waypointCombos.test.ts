import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { LlmError } from '../src/ai/llm';
import { buildWaypointMessages } from '../src/ai/prompts';
import { toStrictJsonSchema, WaypointCombosSchema } from '../src/ai/schema';
import { handleSharedAi } from '../src/ai/shared/service';
import { createSharedWaypointPlanner } from '../src/ai/sharedClient';
import { combineWaypoints, MAX_AI_WAYPOINTS, toAiWaypoints, validateAiCombos, type AiCombo, type SharedWaypointPlanner } from '../src/ai/waypointCombos';
import type { LatLng } from '../src/domain/types';
import type { HistoryWaypoint } from '../src/routes/historyWaypoints';
import type { OsmWaypoint } from '../src/routes/sources/waypoints';
import { codeCombos, toWaypoints, waypointBand, type EngineTarget, type Waypoint } from '../src/routes/waypointEngine';

// Inicio sintético en el mar, como el resto de fixtures: no es el de nadie.
const START: LatLng = { lat: 41, lng: 2.5 };
const M_LAT = 111_320;
const M_LNG = M_LAT * Math.cos((START.lat * Math.PI) / 180);
const at = (km: number, deg: number): LatLng => {
  const a = (deg * Math.PI) / 180;
  return { lat: START.lat + (Math.cos(a) * km * 1000) / M_LAT, lng: START.lng + (Math.sin(a) * km * 1000) / M_LNG };
};
const TARGET: EngineTarget = { distanceKm: 60, elevGainM: 800 };
const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/llm/${name}`, 'utf8')) as { choices: { message: { content: string } }[] };
const fixtureOutput = (name: string): unknown => JSON.parse(fixture(name).choices[0].message.content);

function osm(id: string, kind: OsmWaypoint['kind'], name: string, km: number, deg: number, interes: OsmWaypoint['interes'], extra: Partial<OsmWaypoint> = {}): OsmWaypoint {
  const p = at(km, deg);
  return { id, kind, name, lat: p.lat, lng: p.lng, ele: kind === 'pueblo' ? null : 712.4, distanceM: km * 1000, interes, ...extra };
}
function habitual(id: string, km: number, deg: number): HistoryWaypoint {
  const p = at(km, deg);
  return { id, kind: 'habitual', name: 'Subida habitual 1', lat: p.lat, lng: p.lng, ele: 300, distanceM: km * 1000, approach: at(km - 1, deg), departure: at(km + 1, deg + 3) };
}

const RAW: (OsmWaypoint | HistoryWaypoint)[] = [
  osm('osm-pass-1', 'puerto', 'Coll Sintético', 12, 30, 3),
  osm('osm-peak-2', 'cima', 'Cima Norte', 14, 70, 2, { deadEnd: true }),
  osm('osm-pass-3', 'puerto', 'Puerto Sur', 13, 180, 2),
  habitual('hist-climb-1', 11, 120),
  osm('osm-place-4', 'pueblo', 'Casa Vella', 12, 270, 0),
];
const WAYPOINTS: Waypoint[] = toWaypoints(START, RAW, waypointBand(TARGET.distanceKm));
const decimals4 = (n: number) => n.toFixed(4);

describe('toAiWaypoints: a la IA solo le llegan nombres y cifras', () => {
  it('no envía coordenadas del inicio ni de los puntos, ni «Casa», ni la entrada y salida del historial', () => {
    const { forAi } = toAiWaypoints(WAYPOINTS);
    const json = JSON.stringify(forAi);
    for (const p of [START, ...RAW, ...RAW.flatMap((r) => (r.kind === 'habitual' ? [r.approach!, r.departure!] : []))]) {
      expect(json).not.toContain(decimals4(p.lat));
      expect(json).not.toContain(decimals4(p.lng));
    }
    expect(json).not.toMatch(/\d\.\d{4}/);
    expect(json).not.toMatch(/casa/i);
    expect(json).not.toMatch(/approach|departure|lat|lng|osm-|hist-/);
    for (const w of forAi) expect(Object.keys(w).sort()).toEqual(['cotaM', 'direccion', 'distanciaKm', 'id', 'interes', 'nombre', 'tipo']);
  });

  it('da ids w1..wN, cifras redondeadas y el mapa de vuelta al punto original', () => {
    const { forAi, byAiId } = toAiWaypoints(WAYPOINTS);
    expect(forAi.map((w) => w.id)).toEqual(['w1', 'w2', 'w3', 'w4', 'w5']);
    const coll = forAi.find((w) => w.nombre === 'Coll Sintético')!;
    expect(coll).toEqual({ id: coll.id, tipo: 'puerto', nombre: 'Coll Sintético', cotaM: 712, distanciaKm: 12, direccion: 'noreste', interes: 3 });
    expect(byAiId.get(coll.id)!.id).toBe('osm-pass-1');
    const habitualAi = forAi.find((w) => w.tipo === 'habitual')!;
    expect(habitualAi.interes).toBe(2);
    expect(byAiId.get(habitualAi.id)!.id).toBe('hist-climb-1');
  });

  it(`envía como mucho ${MAX_AI_WAYPOINTS} puntos, los de más interés, con nombres de 60 caracteres como máximo`, () => {
    const many = Array.from({ length: 30 }, (_, i) => osm(`osm-place-${i + 10}`, 'pueblo', `${'Pueblo largo '.repeat(8)}${i}`, 15, i * 12, (i === 29 ? 3 : 0) as OsmWaypoint['interes']));
    const { forAi, byAiId } = toAiWaypoints(toWaypoints(START, many, waypointBand(60)));
    expect(forAi).toHaveLength(24);
    expect(forAi.every((w) => w.nombre.length <= 60)).toBe(true);
    expect([...byAiId.values()].some((w) => w.id === 'osm-place-39')).toBe(true);
  });
});

describe('validateAiCombos', () => {
  const { forAi, byAiId } = toAiWaypoints(WAYPOINTS);
  const idOf = (nombre: string) => forAi.find((w) => w.nombre === nombre)!.id;
  const coll = idOf('Coll Sintético'), cima = idOf('Cima Norte'), sur = idOf('Puerto Sur');

  it('descarta ids no enviados, más de 3 puntos e ids repetidos, y conserva la válida', () => {
    const raw: AiCombo[] = [
      { puntos: [coll, 'w99'], direccion: 'noreste', titulo: 'Inventada' },
      { puntos: ['w1', 'w2', 'w3', 'w4'], direccion: 'este', titulo: 'Cuatro' },
      { puntos: [coll, coll], direccion: 'noreste', titulo: 'Repetida' },
      { puntos: [coll, cima], direccion: 'noreste', titulo: 'Coll y cima' },
    ];
    const combos = validateAiCombos(raw, byAiId);
    expect(combos).toEqual([{ id: 'osm-pass-1+osm-peak-2', waypointIds: ['osm-pass-1', 'osm-peak-2'], direccion: 'noreste', source: 'ia', titulo: 'Coll y cima' }]);
  });

  it('la dirección la calcula el código con los rumbos, no la IA', () => {
    const [combo] = validateAiCombos([{ puntos: [sur], direccion: 'norte', titulo: 'Al sur' }], byAiId);
    expect(combo.direccion).toBe('sur');
  });

  it('ordena los puntos en el sentido de giro para que la vuelta no se cruce', () => {
    const [combo] = validateAiCombos([{ puntos: [cima, coll], direccion: 'noreste', titulo: 'Al revés' }], byAiId);
    expect(combo.waypointIds).toEqual(['osm-pass-1', 'osm-peak-2']);
  });

  it('quita un título con coordenadas y no repite el mismo conjunto de puntos', () => {
    const combos = validateAiCombos([
      { puntos: [coll], direccion: 'noreste', titulo: 'Coll 41.1234, 2.5678' },
      { puntos: [coll], direccion: 'noreste', titulo: 'Otra vez' },
    ], byAiId);
    expect(combos).toHaveLength(1);
    expect(combos[0].titulo).toBeUndefined();
  });
});

describe('combineWaypoints', () => {
  const sameSet = (a: string[], b: string[]) => [...a].sort().join('|') === [...b].sort().join('|');

  it('sin IA común usa solo las combinaciones del código', async () => {
    const out = await combineWaypoints(START, WAYPOINTS, TARGET, null);
    expect(out).toEqual({ combos: codeCombos(START, WAYPOINTS, TARGET), usedAi: false });
  });

  it('si la IA lanza (429), devuelve las del código sin reintentar', async () => {
    const combine = vi.fn<SharedWaypointPlanner['combine']>().mockRejectedValue(new LlmError('rate_limit', 'límite', 60));
    const out = await combineWaypoints(START, WAYPOINTS, TARGET, { combine });
    expect(out).toEqual({ combos: codeCombos(START, WAYPOINTS, TARGET), usedAi: false });
    expect(combine).toHaveBeenCalledTimes(1);
  });

  it('pone primero las 2 válidas de la IA y después las del código que no repiten sus puntos', async () => {
    const combine = vi.fn<SharedWaypointPlanner['combine']>().mockResolvedValue(fixtureOutput('waypoints-ok.json') as { combinaciones: AiCombo[] });
    const out = await combineWaypoints(START, WAYPOINTS, TARGET, { combine });
    expect(out.usedAi).toBe(true);
    expect(out.combos.slice(0, 2).map((c) => c.source)).toEqual(['ia', 'ia']);
    expect(out.combos.slice(0, 2).map((c) => c.waypointIds)).toEqual([['osm-pass-1', 'osm-peak-2'], ['osm-pass-3']]);
    const expectedCode = codeCombos(START, WAYPOINTS, TARGET).filter((c) => !out.combos.slice(0, 2).some((ia) => sameSet(ia.waypointIds, c.waypointIds)));
    expect(out.combos.slice(2)).toEqual(expectedCode);
    const [objetivo, puntos] = combine.mock.calls[0];
    expect(objetivo).toEqual({ distanciaKm: 60, desnivelM: 800 });
    expect(puntos).toEqual(toAiWaypoints(WAYPOINTS).forAi);
  });

  it('reintenta una vez si el JSON no es válido y después sigue con el código', async () => {
    const invalid = new LlmError('invalid_json', 'no vale');
    const twice = vi.fn<SharedWaypointPlanner['combine']>().mockRejectedValue(invalid);
    expect(await combineWaypoints(START, WAYPOINTS, TARGET, { combine: twice })).toEqual({ combos: codeCombos(START, WAYPOINTS, TARGET), usedAi: false });
    expect(twice).toHaveBeenCalledTimes(2);

    const once = vi.fn<SharedWaypointPlanner['combine']>().mockRejectedValueOnce(invalid).mockResolvedValue(fixtureOutput('waypoints-ok.json') as { combinaciones: AiCombo[] });
    const out = await combineWaypoints(START, WAYPOINTS, TARGET, { combine: once });
    expect(once).toHaveBeenCalledTimes(2);
    expect(out.usedAi).toBe(true);
  });

  it('si ninguna combinación de la IA es válida, usa las del código sin aviso', async () => {
    const combine = vi.fn<SharedWaypointPlanner['combine']>().mockResolvedValue({ combinaciones: [{ puntos: ['w77'], direccion: 'este', titulo: 'Inventada' }] });
    expect(await combineWaypoints(START, WAYPOINTS, TARGET, { combine })).toEqual({ combos: codeCombos(START, WAYPOINTS, TARGET), usedAi: false });
  });

  it('sin puntos no llama a la IA', async () => {
    const combine = vi.fn<SharedWaypointPlanner['combine']>();
    expect(await combineWaypoints(START, [], TARGET, { combine })).toEqual({ combos: [], usedAi: false });
    expect(combine).not.toHaveBeenCalled();
  });

  it('una cancelación no se convierte en las combinaciones del código', async () => {
    const controller = new AbortController();
    const combine = vi.fn<SharedWaypointPlanner['combine']>().mockImplementation(async () => { controller.abort(); throw new DOMException('Cancelado', 'AbortError'); });
    await expect(combineWaypoints(START, WAYPOINTS, TARGET, { combine }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('createSharedWaypointPlanner con el servicio común', () => {
  const server = (outputs: unknown[], quota = vi.fn().mockResolvedValue({ allowed: true, retryAfterS: 0 })) => {
    const complete = vi.fn();
    outputs.forEach((o) => complete.mockResolvedValueOnce(o));
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => handleSharedAi(new Request('https://example.invalid/ai-routes', init), {
      enabled: true, allowedOrigins: [], authenticate: async () => 'user-1', consumeQuota: quota, complete,
      validateOutput: (_input, output) => WaypointCombosSchema.safeParse(output).success,
    }));
    return { fetchImpl, complete, quota };
  };

  it('envía solo el objetivo y los puntos, cuenta contra la cuota y valida la respuesta', async () => {
    const { fetchImpl, quota } = server([fixtureOutput('waypoints-ok.json')]);
    const { forAi } = toAiWaypoints(WAYPOINTS);
    const planner = createSharedWaypointPlanner(async () => 'jwt', fetchImpl);
    expect(await planner.combine({ distanciaKm: 60, desnivelM: 800 }, forAi)).toEqual(fixtureOutput('waypoints-ok.json'));
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]!.body))).toEqual({ operation: 'waypoints', objetivo: { distanciaKm: 60, desnivelM: 800 }, puntos: forAi });
    expect(quota).toHaveBeenCalledTimes(1);
  });

  it('una respuesta fuera de esquema llega como JSON no válido, se reintenta y la segunda vale', async () => {
    const { fetchImpl, quota } = server([fixtureOutput('waypoints-bad-schema.json'), fixtureOutput('waypoints-ok.json')]);
    const planner = createSharedWaypointPlanner(async () => 'jwt', fetchImpl);
    const out = await combineWaypoints(START, WAYPOINTS, TARGET, planner);
    expect(out.usedAi).toBe(true);
    expect(out.combos[0].source).toBe('ia');
    expect(quota).toHaveBeenCalledTimes(2);
  });

  it('el límite de la IA común (429) pasa a las combinaciones del código', async () => {
    const { fetchImpl, complete } = server([], vi.fn().mockResolvedValue({ allowed: false, retryAfterS: 120 }));
    const planner = createSharedWaypointPlanner(async () => 'jwt', fetchImpl);
    await expect(planner.combine({ distanciaKm: 60, desnivelM: null }, toAiWaypoints(WAYPOINTS).forAi)).rejects.toMatchObject({ kind: 'rate_limit', retryAfterS: 120 });
    expect(await combineWaypoints(START, WAYPOINTS, TARGET, planner)).toEqual({ combos: codeCombos(START, WAYPOINTS, TARGET), usedAi: false });
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('prompt de combinaciones', () => {
  it('el mensaje del usuario lleva solo el objetivo y los puntos', () => {
    const { forAi } = toAiWaypoints(WAYPOINTS);
    const [system, user] = buildWaypointMessages({ distanciaKm: 60, desnivelM: null }, forAi);
    expect(system.role).toBe('system');
    expect(system.content).toMatch(/No trazas rutas/);
    expect(system.content).toMatch(/Solo usa ids de la lista/);
    expect(JSON.parse(user.content)).toEqual({ objetivo: { distanciaKm: 60, desnivelM: null }, puntos: forAi });
  });
});

describe('WaypointCombosSchema (salida del servicio)', () => {
  const combo = (over: Record<string, unknown> = {}) => ({ puntos: ['w1', 'w2'], direccion: 'noreste', titulo: 'Vuelta', ...over });

  it('acepta la respuesta guardada y genera un esquema estricto para el proveedor', () => {
    expect(WaypointCombosSchema.safeParse(fixtureOutput('waypoints-ok.json')).success).toBe(true);
    const json = toStrictJsonSchema(WaypointCombosSchema) as { additionalProperties: boolean; required: string[] };
    expect(json.additionalProperties).toBe(false);
    expect(json.required).toEqual(['combinaciones']);
  });

  it.each([
    ['4 puntos', { combinaciones: [combo({ puntos: ['w1', 'w2', 'w3', 'w4'] })] }],
    ['ids repetidos', { combinaciones: [combo({ puntos: ['w1', 'w1'] })] }],
    ['ningún punto', { combinaciones: [combo({ puntos: [] })] }],
    ['11 combinaciones', { combinaciones: Array.from({ length: 11 }, () => combo()) }],
    ['ninguna combinación', { combinaciones: [] }],
    ['un título de 61 caracteres', { combinaciones: [combo({ titulo: 'x'.repeat(61) })] }],
    ['una dirección libre', { combinaciones: [combo({ direccion: 'arriba' })] }],
    ['campos extra', { combinaciones: [combo({ lat: 41 })] }],
  ])('rechaza %s', (_name, output) => {
    expect(WaypointCombosSchema.safeParse(output).success).toBe(false);
  });
});
