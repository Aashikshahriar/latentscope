import { test as base, expect, type Page } from '@playwright/test';

/** Fails a test when the page logs errors (ignoring known third-party deprecation warnings). */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await use(errors);
    expect(errors, 'browser console errors').toEqual([]);
  },
});

export { expect };

/** Opens the explorer and waits for the default demo dataset and its initial PCA projection. */
export async function openExplorer(page: Page): Promise<void> {
  await page.goto('#/explore');
  await expect(page.getByRole('heading', { level: 1, name: 'Handwritten digits (8×8)' })).toBeVisible();
  await expect(page.getByText('PCA · 2D')).toBeVisible();
}

export async function selectAlgorithm(page: Page, name: 'PCA' | 't-SNE' | 'UMAP'): Promise<void> {
  await page.getByRole('radiogroup', { name: 'Algorithm' }).getByRole('radio', { name, exact: true }).click();
}
