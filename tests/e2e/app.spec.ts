import { readFileSync } from 'node:fs';
import { test, expect, openExplorer, selectAlgorithm } from './fixtures';

test.describe('landing page', () => {
  test('presents the product and launches the explorer', async ({ page, consoleErrors }) => {
    void consoleErrors;
    await page.goto('');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Explore the Geometry');
    await expect(page.getByText('Interactive 3D visualization')).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible();
    await page.getByRole('button', { name: 'Launch Explorer' }).first().click();
    await expect(page).toHaveURL(/#\/explore$/);
    await expect(page.getByText('PCA · 2D')).toBeVisible();
  });

  test('direct deep links and refresh work with hash routing', async ({ page, consoleErrors }) => {
    void consoleErrors;
    await page.goto('#/learn/umap');
    await expect(page.getByRole('heading', { name: 'Inside the Mathematics' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Nearest-neighbour discovery' })).toBeVisible();
    await page.goto('#/does-not-exist');
    await expect(page.getByText('This page does not exist')).toBeVisible();
  });
});

test.describe('explorer', () => {
  test('loads a demo, computes PCA in a worker and reports exact metrics', async ({
    page,
    consoleErrors,
  }) => {
    void consoleErrors;
    await openExplorer(page);
    await expect(page.getByRole('img', { name: /2D projection of Handwritten digits/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Trustworthiness/ })).toBeVisible();
    await expect(page.getByText('exact').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Quality metrics' }).click();
    await expect(page.getByText('Scree plot and cumulative explained variance')).toBeVisible();
  });

  test('runs t-SNE with live progress and then UMAP in 3D', async ({ page, consoleErrors }) => {
    void consoleErrors;
    await openExplorer(page);
    await selectAlgorithm(page, 't-SNE');
    const iterations = page.getByLabel('Iterations');
    await iterations.fill('300');
    await iterations.press('Enter');
    await page.getByRole('button', { name: 'Run t-SNE' }).click();
    await expect(page.getByRole('progressbar', { name: 'Projection progress' })).toBeVisible();
    await expect(page.getByText('t-SNE · 2D')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/t-SNE preserves local neighbourhoods only/)).toBeVisible();

    await selectAlgorithm(page, 'UMAP');
    await page.getByRole('radio', { name: '3D projection' }).click();
    await page.getByRole('button', { name: 'Run UMAP' }).click();
    await expect(page.getByText('UMAP · 3D')).toBeVisible({ timeout: 90_000 });
    const canvas = page.getByRole('img', { name: /3D projection/ });
    const box = (await canvas.boundingBox())!;
    // Rotate the camera by dragging, then reset with the keyboard shortcut.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    await canvas.focus();
    await page.keyboard.press('r');
    await expect(canvas).toBeVisible();
  });

  test('inspects an observation from the accessible data table and selects neighbours', async ({
    page,
    consoleErrors,
  }) => {
    void consoleErrors;
    await openExplorer(page);
    await page.getByRole('tab', { name: 'Data table' }).click();
    await page.getByRole('row', { name: /digit_0001/ }).click();
    const inspector = page.getByRole('complementary', { name: 'Scientific inspector' });
    await expect(inspector.getByText('digit_0001', { exact: true })).toBeVisible();
    await expect(inspector.getByText(/Nearest neighbours — feature space/)).toBeVisible();
    await expect(inspector.getByRole('img', { name: /rendered as a 8×8 image/ })).toBeVisible();
    await inspector.getByRole('button', { name: 'Select point and its feature-space neighbours' }).click();
    await expect(page.getByText('11 selected')).toBeVisible();
  });

  test('lasso-free rectangle selection selects points and syncs the inspector', async ({
    page,
    consoleErrors,
  }) => {
    void consoleErrors;
    await openExplorer(page);
    await page.getByRole('button', { name: 'Rectangle selection' }).click();
    const canvas = page.getByRole('img', { name: /2D projection/ });
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByText(/\d+ selected/).first()).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Selection/ }).or(page.getByText(/^Selection \(/)),
    ).toBeVisible();
  });
});

test.describe('algorithm comparison', () => {
  test('computes PCA, t-SNE and UMAP side by side with metrics', async ({ page, consoleErrors }) => {
    void consoleErrors;
    await openExplorer(page);
    await selectAlgorithm(page, 't-SNE');
    await page.getByLabel('Iterations').fill('300');
    await page.getByLabel('Iterations').press('Enter');
    await page.getByRole('link', { name: 'Compare algorithms' }).first().click();
    await page.getByRole('button', { name: /Compute .*t-SNE/ }).click();
    for (const name of ['PCA projection', 't-SNE projection', 'UMAP projection']) {
      await expect(page.getByRole('region', { name }).getByRole('img')).toBeVisible({ timeout: 90_000 });
    }
    await expect(page.getByRole('cell', { name: 'Trustworthiness' })).toBeVisible();
  });
});

test.describe('data import, export and sessions', () => {
  test('imports a CSV, projects it and exports CSV, SVG and a session that restores', async ({
    page,
    consoleErrors,
  }) => {
    void consoleErrors;
    await openExplorer(page);
    const rows = Array.from(
      { length: 60 },
      (_, i) => `obs_${i},${i < 30 ? 'a' : 'b'},${(i < 30 ? 0 : 5) + Math.sin(i)},${Math.cos(i)},${i % 7}`,
    );
    const csv = `id,group,x1,x2,x3\n${rows.join('\n')}\n`;
    await page.getByRole('button', { name: 'Import' }).first().click();
    await page
      .getByLabel('Choose a dataset file')
      .setInputFiles({ name: 'tiny.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.getByText('First row contains column names')).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Validate data' }).click();
    await expect(page.getByText('Observation identifiers')).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Import dataset' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'tiny' })).toBeVisible();
    await expect(page.getByText('PCA · 2D')).toBeVisible();

    await page.getByRole('button', { name: 'Export figure and data' }).click();
    const svgDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export SVG' }).click();
    const svg = await svgDownload;
    expect(svg.suggestedFilename()).toMatch(/tiny_pca_2d\.svg$/);
    expect(readFileSync((await svg.path())!, 'utf8')).toContain('<metadata>');

    await page.getByRole('tab', { name: 'Coordinates' }).click();
    await page.getByRole('checkbox', { name: /group/ }).check();
    const csvDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download CSV' }).click();
    const csvText = readFileSync((await (await csvDownload).path())!, 'utf8');
    expect(csvText.split('\n')[0]).toBe('sample_id,component_1,component_2,group');
    expect(csvText.trim().split('\n')).toHaveLength(61);

    await page.getByRole('tab', { name: 'Session' }).click();
    const sessionDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download session' }).click();
    const sessionPath = (await (await sessionDownload).path())!;
    await page.getByLabel('Choose a session file').setInputFiles(sessionPath);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByText(/\(restored\)/).first()).toBeVisible();
  });

  test('persists an imported dataset in the local library', async ({ page, consoleErrors }) => {
    void consoleErrors;
    await page.goto('#/datasets');
    await page.getByRole('button', { name: 'Import embeddings' }).click();
    const json = JSON.stringify({
      embeddings: [
        [1, 2],
        [2, 3],
        [3, 5],
        [8, 1],
        [9, 2],
      ],
      ids: ['a', 'b', 'c', 'd', 'e'],
      labels: ['p', 'p', 'p', 'q', 'q'],
    });
    await page
      .getByLabel('Choose a dataset file')
      .setInputFiles({ name: 'vectors.json', mimeType: 'application/json', buffer: Buffer.from(json) });
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Validate data' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Import dataset' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goto('#/datasets');
    await page.reload();
    await expect(page.getByRole('cell', { name: 'vectors' })).toBeVisible();
  });
});

test.describe('education', () => {
  test('steps through the t-SNE tutorial with live optimisation', async ({ page, consoleErrors }) => {
    void consoleErrors;
    await page.goto('#/learn/tsne');
    await page.getByRole('radio', { name: 'Mathematical' }).click();
    await expect(page.locator('.katex').first()).toBeVisible();
    await page.getByRole('button', { name: '5. Final embedding' }).click();
    await expect(page.getByText(/Trustworthiness \(k = 5\) of this map/)).toBeVisible();
  });
});
