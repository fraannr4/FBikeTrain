import { db } from '../src/db/db';
import { getOrsUsage, recordOrsCall } from '../src/routes/orsUsage';

const H = 3600_000;
const T0 = Date.parse('2026-11-06T08:00:00Z');

describe('orsUsage', () => {
  beforeEach(async () => {
    await db.meta.clear();
  });

  it('starts at zero', async () => {
    expect((await getOrsUsage(T0)).count).toBe(0);
  });

  it('counts calls in 24h window', async () => {
    await recordOrsCall(T0);
    await recordOrsCall(T0 + 1 * H);
    await recordOrsCall(T0 + 23 * H);
    expect(await getOrsUsage(T0 + 23 * H)).toEqual({ count: 3, windowStart: T0 });
  });

  it('resets after 24h from first call', async () => {
    await recordOrsCall(T0);
    await recordOrsCall(T0 + 10 * H);
    expect((await getOrsUsage(T0 + 24 * H)).count).toBe(0);
    await recordOrsCall(T0 + 25 * H);
    expect(await getOrsUsage(T0 + 25 * H)).toEqual({ count: 1, windowStart: T0 + 25 * H });
  });
});
