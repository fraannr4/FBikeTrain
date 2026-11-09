import { test as base } from '@playwright/test';
export { expect, type Page } from '@playwright/test';

export const TEST_USER_ID = '00000000-0000-0000-0000-000000000011';
export const TEST_DATABASE = `ciclismo-user-${TEST_USER_ID}`;
export const AUTH_KEY = 'sb-btmsakyhkxrndvscmxqs-auth-token';
export const TEST_USER = { id: TEST_USER_ID, aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const jwtPart = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
export const TEST_SESSION = { access_token: `${jwtPart({ alg: 'HS256', typ: 'JWT' })}.${jwtPart({ sub: TEST_USER_ID, exp: 4102444800, role: 'authenticated' })}.synthetic`, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: TEST_USER };

/** Solo fixtures de pruebas: sesión sintética y ninguna llamada a la nube real. */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('https://*.supabase.co/**', route => route.abort());
    await page.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_KEY, session: TEST_SESSION });
    await use(page);
  },
});
