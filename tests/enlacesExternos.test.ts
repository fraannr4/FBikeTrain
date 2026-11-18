const sources = import.meta.glob<string>('../src/**/*.tsx', { query: '?raw', import: 'default', eager: true });

/** Un enlace que abre otra pestaña lo dice al lector de pantalla. */
describe('enlaces externos', () => {
  it('cada enlace con target="_blank" avisa de que se abre en otra pestaña', () => {
    const missing: string[] = [];
    let total = 0;
    for (const [file, code] of Object.entries(sources)) {
      let from = code.indexOf('target="_blank"');
      while (from !== -1) {
        total++;
        const end = code.indexOf('</a>', from);
        const link = code.slice(from, end === -1 ? from + 600 : end);
        if (!link.includes('se abre en otra pestaña')) missing.push(`${file}: ${link.slice(0, 120).replace(/\s+/g, ' ')}`);
        from = code.indexOf('target="_blank"', from + 1);
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});
