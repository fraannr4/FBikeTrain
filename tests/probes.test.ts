import { probeLlm, probeOrs } from '../src/settings/probes';

const llm = { baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k', model: '' };

function mockFetch(impl: () => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('probes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('401 gives unauthorized', async () => {
    mockFetch(async () => new Response('no', { status: 401 }));
    expect(await probeOrs('k')).toMatchObject({ ok: false, reason: 'unauthorized' });
    expect(await probeLlm(llm)).toMatchObject({ ok: false, reason: 'unauthorized' });
  });

  it('network TypeError gives network', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await probeOrs('k')).toMatchObject({ ok: false, reason: 'network' });
    expect(await probeLlm(llm)).toMatchObject({ ok: false, reason: 'network' });
  });

  it('200 gives ok', async () => {
    const request = mockFetch(async () => new Response('{}', { status: 200 }));
    expect(await probeOrs('k')).toEqual({ ok: true });
    expect((request.mock.calls[0] as unknown as [string])[0]).toBe('https://api.heigit.org/openrouteservice/v2/directions/cycling-road');
    expect(await probeLlm(llm)).toEqual({ ok: true });
  });

  it('llm probe calls GET <baseUrl>/models with bearer key', async () => {
    const fn = mockFetch(async () => new Response('{}', { status: 200 }));
    await probeLlm({ ...llm, baseUrl: 'https://api.groq.com/openai/v1/' });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/models');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer k');
  });

  it('other status gives other with the status in detail', async () => {
    mockFetch(async () => new Response('fallo', { status: 500 }));
    const r = await probeOrs('k');
    expect(r).toMatchObject({ ok: false, reason: 'other' });
    expect(r.ok ? '' : r.detail).toContain('500');
  });
});
