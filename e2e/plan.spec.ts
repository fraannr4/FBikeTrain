import { expect, test, type Page } from '@playwright/test';
import { MOBILE, NOW } from './seed';

// Plan en el móvil: entrenos del calendario y objetivos. Se crea, se ve y se borra.

test.use({ viewport: MOBILE, hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('plan creates a workout, shows it and deletes it', async ({ page }) => {
  await page.goto('#/plan');
  await expect(page.getByText('Aún no has planificado nada')).toBeVisible();
  await page.getByRole('button', { name: 'Planificar' }).first().click();

  const sheet = page.getByRole('dialog', { name: 'Planificar entreno' });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Nombre').fill('Rodaje 🚴 по холмам');
  await sheet.getByRole('button', { name: 'Guardar entreno' }).click();

  const card = page.getByRole('article', { name: 'Rodaje 🚴 по холмам' });
  await expect(card).toBeVisible();
  expect(await noOverflow(page)).toBe(true);

  await card.getByRole('button', { name: /^Editar / }).click();
  await page.getByRole('button', { name: 'Borrar entreno' }).click();
  await expect(page.getByRole('article', { name: /Rodaje/ })).toHaveCount(0);
  await expect(page.getByText('Aún no has planificado nada')).toBeVisible();
});

test('plan creates an event goal, shows it and deletes it', async ({ page }) => {
  await page.goto('#/plan/objetivos');
  await page.getByRole('button', { name: /Una marcha o evento/ }).click();

  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Nombre').fill('Marcha Cicloturista del Pantano');
  await sheet.getByLabel('Fecha').fill('2026-12-20');
  await sheet.getByLabel('Distancia').fill('90');
  await sheet.getByRole('button', { name: 'Crear objetivo' }).click();

  await expect(page.locator('.ev-name', { hasText: 'Marcha Cicloturista del Pantano' })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);

  await page.getByRole('button', { name: 'Editar Marcha Cicloturista del Pantano' }).click();
  await page.getByRole('button', { name: 'Borrar objetivo' }).click();
  await expect(page.locator('.ev-name')).toHaveCount(0);
});
