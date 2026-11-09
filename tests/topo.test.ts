import { topoPaths } from '../src/ui/topo';

describe('topoPaths', () => {
  it('draws one closed path per ring, always the same for a seed', () => {
    const a = topoPaths(4, 112, 92, 8, 11);
    expect(a).toHaveLength(8);
    expect(a.every((d) => d.startsWith('M') && d.endsWith('Z'))).toBe(true);
    expect(topoPaths(4, 112, 92, 8, 11)).toEqual(a);
    expect(topoPaths(5, 112, 92, 8, 11)).not.toEqual(a);
  });
});
