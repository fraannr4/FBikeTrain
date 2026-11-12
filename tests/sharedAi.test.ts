import { handleSharedAi, SharedAiRateLimit, sharedAiRequestSchema, type SharedAiDependencies } from '../src/ai/shared/service';

const summary = { fuente: 'declarado', semanas: null, salidas: 0, salidasPorSemana: 0, distanciaMediaKm: 45, desnivelMedioM: 600, tiempoMedioMin: 120, velocidadMediaKmh: 23, distanciaMaxKm: 45, desnivelMaxM: 600, vamMediaMh: null, subidaMasLarga: null };
const plan = { operation: 'plan', summary, answers: { focus: 'mixto', minutes: 120, explore: 'descubrir', notes: '' }, maxDistanciaKm: 50 };
const request = (body: unknown = plan, token = 'test-session') => new Request('https://example.invalid/ai-routes', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: 'https://example.test' }, body: JSON.stringify(body) });
const mock = (): SharedAiDependencies => ({
  enabled: true, allowedOrigins: ['https://example.test'],
  authenticate: vi.fn().mockResolvedValue('00000000-0000-0000-0000-000000000001'),
  consumeQuota: vi.fn().mockResolvedValue({ allowed: true, retryAfterS: 0 }),
  complete: vi.fn().mockResolvedValue({ opciones: [] }),
  validateOutput: vi.fn().mockReturnValue(true),
});

describe('IA compartida: límites y privacidad', () => {
  it('exige sesión y valida antes de consumir cuota o llamar al proveedor', async () => {
    const deps = mock();
    (deps.authenticate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect((await handleSharedAi(request(), deps)).status).toBe(401);
    expect(deps.consumeQuota).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
  });
  it.each([
    { ...plan, model: 'arbitrary' },
    { ...plan, url: 'https://example.test' },
    { ...plan, summary: { ...summary, home: { lat: 41, lng: 2 } } },
    { ...plan, answers: { ...plan.answers, notes: 'Calle privada 7' } },
    { ...plan, maxDistanciaKm: Infinity },
  ])('rechaza entradas no permitidas y notas libres', async body => {
    const deps = mock();
    expect((await handleSharedAi(request(body), deps)).status).toBe(400);
    expect(deps.consumeQuota).not.toHaveBeenCalled();
  });
  it('falla cerrado si el servicio no está configurado', async () => {
    const deps = { ...mock(), enabled: false };
    expect((await handleSharedAi(request(), deps)).status).toBe(503);
    expect(deps.complete).not.toHaveBeenCalled();
  });
  it('no permite consumo al agotar la cuota y comunica el tiempo', async () => {
    const deps = mock();
    (deps.consumeQuota as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: false, retryAfterS: 60 });
    const response = await handleSharedAi(request(), deps);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect((await response.json()).retryAfterS).toBe(60);
    expect(deps.complete).not.toHaveBeenCalled();
  });
  it('consume antes de llamar al proveedor y devuelve el objeto validado', async () => {
    const deps = mock();
    const order: string[] = [];
    deps.consumeQuota = async () => { order.push('quota'); return { allowed: true, retryAfterS: 0 }; };
    deps.complete = async () => { order.push('provider'); return { opciones: [] }; };
    const response = await handleSharedAi(request(), deps);
    expect(response.status).toBe(200);
    expect(order).toEqual(['quota', 'provider']);
    expect(await response.json()).toEqual({ data: { opciones: [] } });
  });
  it('no devuelve errores crudos ni secretos del proveedor', async () => {
    const deps = mock();
    (deps.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('secret-provider-key'));
    const response = await handleSharedAi(request(), deps);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('secret-provider-key');
  });
  it('solo devuelve respuestas que cumplen el esquema de la operación', async () => {
    const deps = mock(); deps.validateOutput = () => false;
    expect((await handleSharedAi(request(), deps)).status).toBe(502);
  });
  it('traduce también el límite del proveedor sin exponer su respuesta', async () => {
    const deps = mock();
    deps.complete = async () => { throw new SharedAiRateLimit(90); };
    const response = await handleSharedAi(request(), deps);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('90');
  });
  it('elimina títulos libres antes de explicar rutas y rechaza campos GPS', async () => {
    const deps = mock();
    const fact = { id: 'r1', titulo: 'Calle privada', distanciaKm: 40, desnivelM: 300, tiempoEstimadoMin: 90, carreteraNuevaPct: 50, dificultad: 'Media', sobreReferenciaPct: 10, dimension: 'distancia', pendienteMaxima: 'del 4 al 7 %', limitadoPorTiempo: false };
    expect((await handleSharedAi(request({ operation: 'explain', summary, facts: [fact] }), deps)).status).toBe(200);
    expect(deps.complete).toHaveBeenCalledWith(expect.objectContaining({ facts: [expect.objectContaining({ titulo: 'Ruta 1' })] }), expect.any(AbortSignal));
    expect((await handleSharedAi(request({ operation: 'explain', summary, facts: [{ ...fact, coordinates: [1, 2] }] }), mock())).status).toBe(400);
  });
  it('acepta hasta 6 referencias con sus cifras y las pasa al proveedor', async () => {
    const deps = mock();
    const referencias = Array.from({ length: 6 }, (_, i) => ({ id: `ref${i + 1}`, nombre: `Vuelta sintética ${i + 1}`, fuente: 'osm', distanciaKm: 40 + i, desnivelM: i === 0 ? null : 500 }));
    expect((await handleSharedAi(request({ ...plan, referencias }), deps)).status).toBe(200);
    expect(deps.complete).toHaveBeenCalledWith(expect.objectContaining({ referencias }), expect.any(AbortSignal));
  });
  it('acepta referencias de biblioteca y puertos sin datos de ubicación', async () => {
    const deps = mock();
    const referencias = [{ id: 'ref1', nombre: 'Ruta sintética', fuente: 'biblioteca', distanciaKm: 70, desnivelM: 500 }];
    const puertos = [{ id: 'pass1', nombre: 'Collado sintético', cotaM: 650, distanciaKm: 22 }, { id: 'pass2', nombre: 'Subida conocida', cotaM: null, distanciaKm: 18 }];
    expect((await handleSharedAi(request({ ...plan, referencias, puertos }), deps)).status).toBe(200);
    expect(deps.complete).toHaveBeenCalledWith(expect.objectContaining({ referencias, puertos }), expect.any(AbortSignal));
  });
  it('acepta referencias de Ride with GPS con distancia al inicio y dirección, nunca coordenadas', async () => {
    const deps = mock();
    const referencias = [{ id: 'ref1', nombre: 'Vuelta sintética', fuente: 'rwgps', distanciaKm: 61.2, desnivelM: 700, aInicioKm: 1.4, direccion: 'noreste' }];
    expect((await handleSharedAi(request({ ...plan, referencias }), deps)).status).toBe(200);
    expect(deps.complete).toHaveBeenCalledWith(expect.objectContaining({ referencias }), expect.any(AbortSignal));
    expect((await handleSharedAi(request({ ...plan, referencias: [{ ...referencias[0], direccion: 'Calle Mayor 1' }] }), mock())).status).toBe(400);
  });
  it.each([
    [{ id: 'pass1', nombre: 'Collado', cotaM: 650, distanciaKm: 22, lat: 41 }],
    [{ id: 'pass1', nombre: 'Collado', cotaM: 650, distanciaKm: 41 }],
    [{ id: 'pass1', nombre: 'Collado', cotaM: 12001, distanciaKm: 22 }],
    [{ id: 'pass7', nombre: 'Collado', cotaM: 650, distanciaKm: 22 }],
    [1, 2].map(() => ({ id: 'pass1', nombre: 'Collado', cotaM: 650, distanciaKm: 22 })),
  ])('rechaza puertos inválidos antes de consumir cuota', async (...puertos) => {
    const deps = mock();
    expect((await handleSharedAi(request({ ...plan, puertos }), deps)).status).toBe(400);
    expect(deps.consumeQuota).not.toHaveBeenCalled();
  });
  it.each([
    ['campos extra', [{ id: 'ref1', nombre: 'Vuelta', fuente: 'osm', distanciaKm: 40, desnivelM: null, url: 'https://www.openstreetmap.org/relation/1' }]],
    ['coordenadas', [{ id: 'ref1', nombre: 'Vuelta', fuente: 'osm', distanciaKm: 40, desnivelM: null, lat: 41, lon: 2 }]],
    ['más de 6', Array.from({ length: 7 }, (_, i) => ({ id: `ref${i + 1}`, nombre: 'Vuelta', fuente: 'osm', distanciaKm: 40, desnivelM: null }))],
    ['ids repetidos', [1, 2].map(() => ({ id: 'ref1', nombre: 'Vuelta', fuente: 'osm', distanciaKm: 40, desnivelM: null }))],
  ])('rechaza referencias con %s', async (_name, referencias) => {
    const deps = mock();
    expect((await handleSharedAi(request({ ...plan, referencias }), deps)).status).toBe(400);
    expect(deps.consumeQuota).not.toHaveBeenCalled();
  });
  it('rechaza origen y payload demasiado grande', async () => {
    const deps = mock(); deps.allowedOrigins = ['https://other.test'];
    expect((await handleSharedAi(request(), deps)).status).toBe(403);
    const huge = request({ data: 'a'.repeat(25_000) });
    expect((await handleSharedAi(huge, mock())).status).toBe(413);
  });
  it('limita la espera del proveedor y cancela su señal', async () => {
    vi.useFakeTimers();
    try {
      const deps = mock();
      deps.complete = (_, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
      const pending = handleSharedAi(request(), deps);
      await vi.advanceTimersByTimeAsync(20_001);
      const response = await pending;
      expect(response.status).toBe(504);
      expect((await response.json()).error.code).toBe('timeout');
    } finally { vi.useRealTimers(); }
  });
  it('cancela antes de admitir la operación sin consumir cuota', async () => {
    const deps = mock();
    const aborted = request();
    // jsdom y Request de Node tienen marcas AbortSignal distintas: simular el estado ya abortado.
    Object.defineProperty(aborted.signal, 'aborted', { value: true });
    expect((await handleSharedAi(aborted, deps)).status).toBe(499);
    expect(deps.consumeQuota).not.toHaveBeenCalled();
  });
});

describe('IA compartida: objetivo del usuario', () => {
  const evento = { tipo: 'evento', diasHasta: 5, distanciaKm: 120, desnivelM: 1500 };
  const volumen = { tipo: 'volumen', diasRestantes: 9, distanciaRestanteKm: 0, desnivelRestanteM: null };
  const splice = { operation: 'splice', facts: [{ id: 'c1', distanciaKm: 20, desnivelM: 120, viasPrincipalesPct: 4, conectorKm: 1.5, solapeKm: 0.3, retrocesoKm: 0, alternativa: false }] };

  it.each([
    ['plan con evento', { ...plan, objetivo: evento }],
    ['plan con volumen', { ...plan, objetivo: volumen }],
    ['plan sin objetivo', { ...plan, objetivo: null }],
    ['splice con evento', { ...splice, objetivo: evento }],
    ['splice con volumen', { ...splice, objetivo: volumen }],
  ])('acepta el objetivo en %s', (_name, body) => {
    expect(sharedAiRequestSchema.safeParse(body).success).toBe(true);
  });

  it('el objetivo llega al proveedor con sus cifras', async () => {
    const deps = mock();
    expect((await handleSharedAi(request({ ...plan, objetivo: evento }), deps)).status).toBe(200);
    expect(deps.complete).toHaveBeenCalledWith(expect.objectContaining({ objetivo: evento }), expect.any(AbortSignal));
  });

  it.each([
    ['campos extra', { tipo: 'evento', diasHasta: 5, extra: 1 }],
    ['días negativos', { tipo: 'evento', diasHasta: -1, distanciaKm: 120, desnivelM: 1500 }],
    ['nombre', { ...evento, titulo: 'Marcha' }],
    ['tipo desconocido', { tipo: 'semana', diasHasta: 5 }],
    ['restantes negativos', { ...volumen, distanciaRestanteKm: -1 }],
  ])('rechaza un objetivo con %s en plan y splice', (_name, objetivo) => {
    expect(sharedAiRequestSchema.safeParse({ ...plan, objetivo }).success).toBe(false);
    expect(sharedAiRequestSchema.safeParse({ ...splice, objetivo }).success).toBe(false);
  });
});
