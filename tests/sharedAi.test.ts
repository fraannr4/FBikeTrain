import { handleSharedAi, SharedAiRateLimit, sharedAiRequestSchema, type SharedAiDependencies } from '../src/ai/shared/service';

const summary = { fuente: 'declarado', semanas: null, salidas: 0, salidasPorSemana: 0, distanciaMediaKm: 45, desnivelMedioM: 600, tiempoMedioMin: 120, velocidadMediaKmh: 23, distanciaMaxKm: 45, desnivelMaxM: 600, vamMediaMh: null, subidaMasLarga: null };
const week = { operation: 'workouts', summary, objetivo: { diasHasta: 14, distanciaKm: 92.4, desnivelM: 1650 }, ocupados: [0], disponibles: [1, 2, 5], notas: '' };
const request = (body: unknown = week, token = 'test-session') => new Request('https://example.invalid/ai-routes', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: 'https://example.test' }, body: JSON.stringify(body) });
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
    { ...week, model: 'arbitrary' },
    { ...week, url: 'https://example.test' },
    { ...week, summary: { ...summary, home: { lat: 41, lng: 2 } } },
    { ...week, notas: 'dos\nlíneas' },
    { ...week, notas: 'x'.repeat(501) },
    { ...week, objetivo: { ...week.objetivo, distanciaKm: -1 } },
    { ...week, disponibles: [7] },
  ])('rechaza entradas no permitidas y notas que no son texto plano o pasan de 500 caracteres', async body => {
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

describe('IA compartida: solo queda la semana con IA', () => {
  const referencias = [{ id: 'ref1', nombre: 'Vuelta sintética', fuente: 'osm', distanciaKm: 40, desnivelM: null }];
  it.each([
    ['plan', { operation: 'plan', summary, answers: { focus: 'mixto', minutes: 120, explore: 'descubrir', notes: '' }, maxDistanciaKm: 50, referencias }],
    ['explain', { operation: 'explain', summary, facts: [{ id: 'r1', titulo: 'Ruta', distanciaKm: 40, desnivelM: 300, tiempoEstimadoMin: 90, carreteraNuevaPct: 50, dificultad: 'Media', sobreReferenciaPct: 10, dimension: 'distancia', pendienteMaxima: 'del 4 al 7 %', limitadoPorTiempo: false }] }],
    ['splice', { operation: 'splice', facts: [{ id: 'c1', distanciaKm: 20, desnivelM: 120, viasPrincipalesPct: 4, conectorKm: 1.5, solapeKm: 0.3, retrocesoKm: 0, alternativa: false }] }],
    ['waypoints', { operation: 'waypoints', objetivo: { distanciaKm: 60, desnivelM: 800 }, puntos: [{ id: 'w1', tipo: 'puerto', nombre: 'Collado sintético', cotaM: 650, distanciaKm: 14.2, direccion: 'noreste', interes: 2 }] }],
  ])('la operación %s ya no existe: 400 sin consumir cuota', async (_name, body) => {
    const deps = mock();
    expect((await handleSharedAi(request(body), deps)).status).toBe(400);
    expect(deps.consumeQuota).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it('workouts sigue pasando y llega al proveedor con sus cifras', async () => {
    const deps = mock();
    expect((await handleSharedAi(request(), deps)).status).toBe(200);
    expect(deps.complete).toHaveBeenCalledWith(expect.objectContaining({ operation: 'workouts', objetivo: week.objetivo }), expect.any(AbortSignal));
    expect(sharedAiRequestSchema.safeParse({ ...week, objetivo: null }).success).toBe(true);
  });
});
