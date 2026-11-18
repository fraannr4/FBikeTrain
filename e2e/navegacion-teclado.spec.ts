import { test, expect } from './accountFixture';

test.setTimeout(60_000);

test('al cambiar de pestaña con el teclado, el foco pasa al contenido y el título nombra la pantalla', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const menu = page.getByRole('navigation', { name: 'Menú principal' });
  await expect(page).toHaveTitle('Inicio · FBikeTrain');
  await menu.getByRole('link', { name: 'Historial' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Historial' })).toBeVisible();
  await expect(page).toHaveTitle('Historial · FBikeTrain');
  await expect(page.locator('main#contenido')).toBeFocused();
  // El siguiente Tab entra en la pantalla nueva, no en la pestaña vecina.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.querySelector('main')!.contains(document.activeElement))).toBe(true);
});

test('una dirección desconocida lo dice y lleva a Inicio; el enlace antiguo de objetivos sigue vivo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('#/no-existe');
  await expect(page.getByRole('heading', { level: 1, name: 'Pantalla no encontrada' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Ir a Inicio' }).click();
  await expect(page).toHaveTitle('Inicio · FBikeTrain');
  await page.goto('#/objetivos');
  await expect(page).toHaveURL(/#\/plan\/objetivos$/);
});
