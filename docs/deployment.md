# Deployment

LatentScope is a static site. The production build in `dist/` can be served by any static host;
the repository ships a workflow for GitHub Pages.

## GitHub Pages (recommended)

1. Push the repository to GitHub (the default branch must be `main`, or edit the branch in
   `.github/workflows/deploy.yml`).
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main` (or run the "Deploy to GitHub Pages" workflow manually from the Actions tab).

The workflow (`.github/workflows/deploy.yml`):

1. checks out the code and sets up Node.js 22 with npm caching;
2. installs dependencies with `npm ci`;
3. runs linting, type checking and the unit/scientific test suite;
4. asks `actions/configure-pages` for the site's base path and builds with
   `BASE_PATH=<base path>/` — `/latentscope/` for a project site at
   `https://<username>.github.io/latentscope/`, `/` for a user site or custom domain;
5. uploads `dist/` with `actions/upload-pages-artifact`;
6. deploys with `actions/deploy-pages` (permissions: `contents: read`, `pages: write`,
   `id-token: write`; one deployment at a time, never cancelled midway).

`.github/workflows/ci.yml` additionally runs Prettier checks, the production build and the
Playwright end-to-end suite on every push and pull request.

### Why it works under a sub-path

- **Hash routing** (`createHashRouter`): the server only ever receives `/latentscope/`; routes live
  in the URL fragment, so deep links and refreshes never 404 and no `404.html` trick is needed.
- **Base path**: `vite.config.ts` uses `BASE_PATH` (default `/latentscope/`) for both `vite build`
  and `vite preview`. Bundled datasets are fetched through `assetUrl()`, which prefixes
  `import.meta.env.BASE_URL`.
- **Workers**: created with `new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' })`,
  which Vite rewrites to a hashed asset URL relative to the importing chunk.
- The E2E suite runs against `vite preview` under `/latentscope/`, so sub-path regressions fail CI.

## Manual deployment

```bash
npm ci
BASE_PATH=/latentscope/ npm run build   # or BASE_PATH=/ for a root deployment
npx vite preview                         # optional local check at http://localhost:4173/latentscope/
```

Upload the contents of `dist/` to any static host. No server-side configuration, secrets or
runtime environment variables are required.

## Optional build-time settings

| Variable              | Purpose                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `BASE_PATH`           | Public sub-path (default `/latentscope/`).                                                                                          |
| `VITE_REPOSITORY_URL` | Repository link shown in the header/footer. On `*.github.io` it is inferred automatically; elsewhere the link is hidden unless set. |
| `VITE_PORTFOLIO_URL`  | Adds a "Portfolio" link to the landing-page footer.                                                                                 |

## Verifying a deployment

After the workflow finishes, open the URL printed by the deploy job and check: the landing page
renders its 3D hero; `#/explore` loads the Digits demo and computes PCA (this exercises dataset
fetching, the worker and WebGL); a refresh on `#/learn/umap` stays on that page; an export
downloads a file; a saved dataset survives a reload (IndexedDB).

## Portfolio integration

- Link to the root URL for the product tour, or deep-link straight into a view:
  `https://<username>.github.io/latentscope/#/explore`,
  `…/#/models`, `…/#/learn/tsne`.
- A share link from the Explorer (Share button) reproduces a specific demo projection exactly,
  which works well as a "live figure" link in a portfolio or paper.
- To embed: `<iframe src="https://<username>.github.io/latentscope/#/learn/pca" width="100%" height="720" loading="lazy" title="LatentScope PCA tutorial"></iframe>`.
- Screenshots for portfolio pages are in `docs/images/`.
