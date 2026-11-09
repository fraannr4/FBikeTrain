import { db } from '../src/db/db';
import { listClimbEfforts } from '../src/db/repo';
import type { ClimbEffort } from '../src/domain/types';

// Esfuerzos sintéticos: solo importan `activityId` y `id`.
function effort(id: string, activityId: string): ClimbEffort {
  const p = { lat: 40.4168, lng: -3.7038 };
  return {
    id,
    activityId,
    activityStart: 0,
    startIdx: 0,
    endIdx: 10,
    start: p,
    end: p,
    startDistM: 0,
    lengthM: 2000,
    gainM: 120,
    avgGradePct: 6,
    timeS: 600,
    avgSpeedMs: 3.3,
    vamMh: 720,
  };
}

describe('listClimbEfforts', () => {
  beforeEach(() => db.climbEfforts.clear());

  it('reads only the efforts of the given rides', async () => {
    await db.climbEfforts.bulkPut([effort('a-1', 'a'), effort('a-2', 'a'), effort('b-1', 'b'), effort('c-1', 'c')]);
    const ids = (await listClimbEfforts(['a', 'c'])).map((e) => e.id).sort();
    expect(ids).toEqual(['a-1', 'a-2', 'c-1']);
    expect(await listClimbEfforts()).toHaveLength(4);
  });
});
