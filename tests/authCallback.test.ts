import { callbackUrl, consumeAuthCallback } from '../src/auth/callback';

describe('callback de cuentas en GitHub Pages', () => {
  it('conserva el prefijo de Pages y elimina hashes y búsquedas', () => {
    expect(callbackUrl('https://example.test/FBikeTrain/?code=old#/plan')).toBe('https://example.test/FBikeTrain/');
    expect(callbackUrl('https://example.test/FBikeTrain/#/plan', true)).toBe('https://example.test/FBikeTrain/?auth=recovery');
  });
  it('canjea el código una sola vez y elimina el código antes de mostrar rutas', async () => {
    const exchange = vi.fn().mockResolvedValue({ error: null });
    const replace = vi.fn();
    await consumeAuthCallback('https://example.test/FBikeTrain/?auth=recovery&code=one#/plan', exchange, replace);
    expect(exchange).toHaveBeenCalledWith('one');
    expect(replace).toHaveBeenCalledWith('/FBikeTrain/?auth=recovery#/plan');
  });
  it('limpia el código también si el proveedor rechaza el canje', async () => {
    const replace = vi.fn();
    await expect(consumeAuthCallback('https://example.test/?code=expired', vi.fn().mockResolvedValue({ error: new Error('expired') }), replace)).rejects.toThrow();
    expect(replace).toHaveBeenCalledWith('/');
  });
  it('rechaza y limpia errores del proveedor sin mostrarlos literalmente', async () => {
    const replace = vi.fn();
    await expect(consumeAuthCallback('https://example.test/?error=access_denied&error_description=private', vi.fn(), replace)).rejects.toThrow('No se pudo completar');
    expect(replace).toHaveBeenCalledWith('/');
  });
});
