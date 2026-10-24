import { test, expect } from './fixtures';

test.describe('mobile layout', () => {
  test('navigation drawer and bottom-sheet panels replace the desktop sidebars', async ({
    page,
    consoleErrors,
  }) => {
    void consoleErrors;
    await page.goto('#/explore');
    await expect(page.getByText('PCA · 2D')).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Experiment controls' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Controls' }).click();
    await expect(page.getByRole('dialog').getByText('Active dataset')).toBeVisible();
    await page.getByRole('button', { name: 'Close panel' }).click();
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    await page
      .getByRole('navigation', { name: 'Primary mobile' })
      .getByRole('link', { name: 'Inside the Mathematics' })
      .click();
    await expect(page.getByRole('heading', { name: 'Inside the Mathematics' })).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const width = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
  });
});
