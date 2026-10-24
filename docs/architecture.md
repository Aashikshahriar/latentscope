# LatentScope architecture

This document is the engineering plan that LatentScope was built against, kept up to date as the
source of truth for how the application is organised.

## 1. Overview

LatentScope is a static single-page application. Everything — parsing, dimensionality reduction,
metrics, clustering, persistence and rendering — runs in the user's browser. There is no backend,
no analytics and no network traffic other than fetching the application bundle and the bundled
demonstration datasets from the same origin.

```text
┌────────────────────────── main thread ──────────────────────────┐
│ React UI (features/*)  ←→  Zustand stores (stores/*)              │
│        │                         │                               │
│        ▼                         ▼                               │
│ visualization/* (R3F + custom shaders)   services/* (import,     │
│                                           export, persistence)   │
│        │ jobs (typed messages, transferable buffers)             │
└────────┼─────────────────────────────────────────────────────────┘
         ▼
┌──────────── Web Worker (one per job, terminated on cancel) ──────┐
│ algorithms/* — PCA, t-SNE, UMAP (umap-js), metrics, clustering    │
└──────────────────────────────────────────────────────────────────┘
```

Principles:

- **Computation is UI-free.** `src/algorithms` imports nothing from React, the DOM or the stores, so
  every algorithm runs identically in a worker, in a unit test and in the tutorials.
- **One worker per job.** Cancellation terminates the worker, which is the only way to stop a
  tight numerical loop immediately. Spawning a worker costs a few milliseconds; the dataset is
  copied into it once per job.
- **Honest progress.** Algorithms that iterate (t-SNE, UMAP, k-means) report `iteration / total`.
  Stages without a reliable estimate (e.g. an eigendecomposition) report an indeterminate stage
  label instead of a percentage.

## 2. Dependency decisions

| Concern           | Choice                                       | Rationale                                                                                                                                                          |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Framework         | React 19.2, TypeScript 5.9 (strict), Vite 7  | Mature, verified APIs. TypeScript 7 (native) is not yet supported by typescript-eslint.                                                                            |
| Routing           | react-router 7 `createHashRouter`            | Hash routes work on GitHub Pages without a 404 fallback hack.                                                                                                      |
| Styling           | Tailwind CSS 4 + CSS custom properties       | Design tokens live in `src/styles/index.css` as variables and are exposed to Tailwind via `@theme`.                                                                |
| UI primitives     | `radix-ui` (unified package), lucide-react   | Accessible dialogs, tabs, selects, sliders, switches, tooltips.                                                                                                    |
| State             | Zustand 5                                    | Small, selector-based subscriptions avoid re-rendering the canvas on unrelated changes.                                                                            |
| 3D / 2D rendering | three + @react-three/fiber 9 + drei 10       | Both views share one `THREE.Points` renderer with a custom shader; 2D uses an orthographic camera.                                                                 |
| Linear algebra    | ml-matrix 6                                  | Tested SVD / symmetric eigendecomposition used by PCA, Procrustes and CKA checks.                                                                                  |
| UMAP              | umap-js 1.4 (PAIR / Google)                  | The maintained reference JavaScript port. Seeded via its `random` option; exact kNN injected for small N.                                                          |
| t-SNE             | In-house (exact + Barnes–Hut)                | No maintained JS package supports seeding, 3D, Barnes–Hut and step-wise previews. Verified against scikit-learn's joint probabilities, KL divergence and gradient. |
| CSV / TSV         | PapaParse                                    | Robust quoting / delimiter handling.                                                                                                                               |
| NPY               | In-house parser                              | The format is small and fully specified; tested against files written by NumPy.                                                                                    |
| NPZ               | fflate (unzip) + NPY parser                  | Handles stored and deflated archives.                                                                                                                              |
| Persistence       | Dexie 4 over IndexedDB                       | Datasets and experiments stored locally with typed-array payloads.                                                                                                 |
| Maths typesetting | KaTeX                                        | Fast, no runtime network.                                                                                                                                          |
| Charts            | Small in-house SVG chart components          | Scree plots, histograms and bar charts need ~300 lines of SVG; Plotly would add ~3 MB to the bundle and the SVG output doubles as vector export.                   |
| Fonts             | @fontsource-variable (Inter, JetBrains Mono) | Self-hosted, so no third-party font requests.                                                                                                                      |
| Tests             | Vitest + Testing Library, Playwright         | Scientific fixtures generated by scikit-learn / SciPy / umap-learn (`scripts/generate_references.py`).                                                             |

## 3. Data model (`src/types`)

```ts
interface Dataset {
  id: string; // stable local id
  name: string;
  source: DatasetSource; // demo (with generator spec) | upload | session
  n: number;
  d: number;
  values: Float32Array; // row-major N × D feature matrix
  featureNames: string[];
  ids: string[]; // unique observation identifiers
  columns: MetadataColumn[]; // labels, clusters, text, image URLs, numeric metadata…
  checksum: string; // SHA-256 over shape + values + ids
  provenance?: Provenance; // source, license, citation for bundled data
}

interface Experiment {
  id: string;
  name: string;
  datasetId: string;
  datasetChecksum: string;
  datasetName: string;
  algorithm: 'pca' | 'tsne' | 'umap';
  implementation: { name: string; version: string };
  params: AlgorithmParams; // includes seed
  preprocessing: PreprocessingConfig;
  outputDims: 2 | 3;
  rowIndices: Uint32Array | null; // explicit subsample, never silent
  coords: Float32Array; // rows × outputDims
  diagnostics: ProjectionDiagnostics; // PCA variance, t-SNE KL, method used…
  metrics?: QualityMetrics;
  runtimeMs: number;
  createdAt: string;
  appVersion: string;
}
```

Computed clusterings (`ClusteringResult`) are stored beside the dataset, never written into the
dataset's own label columns, so ground-truth labels, imported cluster labels and computed
assignments stay distinguishable.

## 4. State management

| Store             | Holds                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `datasetStore`    | Loaded datasets (in memory), active dataset id, computed clusterings                                       |
| `experimentStore` | Experiment history (mirrored to IndexedDB), active experiment, running job, preview                        |
| `viewStore`       | Visual encoding (palette, size, opacity, colour-by, hidden categories), selection, hover, camera bookmarks |
| `uiStore`         | Panel visibility and sizes, bottom-panel tab, dialogs                                                      |
| `logStore`        | Computational log entries shown in the Logs tab                                                            |

The canvas subscribes to the narrow slices it needs; selection is stored as a sorted index array
plus a version counter so the renderer can rebuild one `Float32Array` attribute rather than re-render
React trees.

## 5. Component hierarchy

```text
App (RouterProvider, Tooltip provider)
├── LandingPage            hero point cloud, feature cards, explainer
├── AppShell (top nav)
│   ├── ExplorerPage
│   │   ├── ControlsSidebar   dataset · algorithm · parameters · encoding · filters · clustering
│   │   ├── CanvasPanel       EmbeddingCanvas (2D/3D) + toolbar + selection overlay + legend
│   │   ├── InspectorPanel    point details · neighbours · cluster stats · dataset stats
│   │   └── BottomPanel       comparison · metrics · distributions · history · logs · table
│   ├── ComparisonPage      synchronized PCA / t-SNE / UMAP panels + metrics
│   ├── ModelComparisonPage representation correspondence, CKA / RSA / kNN agreement
│   ├── DatasetsPage        library + import wizard
│   ├── LearnPage           PCA / t-SNE / UMAP tutorials
│   └── AboutPage
```

## 6. Computation pipeline

```text
Dataset ─► preprocessing (explicit: missing-value policy, centring, standardisation,
           L2 normalisation, optional seeded subsample with recorded indices)
        ─► algorithm (worker) ─► coords + diagnostics
        ─► metrics (worker, seeded sampling, approximation flagged)
        ─► Experiment record (IndexedDB) ─► visualization / export
```

## 7. Performance strategy

- Feature matrices are `Float32Array`; algorithms promote to `Float64Array` internally.
- One `THREE.Points` draw call per view; colours / state live in GPU attributes; rendering is
  `frameloop="demand"` so idle views do not draw.
- Picking projects points to screen space on pointer move (≈1 ms for 50k points), throttled to
  animation frames. Rectangle and lasso selection reuse the same projection.
- t-SNE switches to Barnes–Hut (θ = 0.5) above 1 500 points; PCA chooses SVD, covariance or Gram
  eigendecomposition by shape, and offers randomized SVD for very large inputs (flagged approximate).
- A cost estimator warns before expensive runs and offers explicit, recorded subsampling.
- Routes and the three.js bundle are lazy-loaded.

## 8. Deployment strategy

- `vite.config.ts` reads `BASE_PATH` (default `/latentscope/` for builds, `/` for dev).
- Hash routing; all asset and dataset URLs derive from `import.meta.env.BASE_URL`.
- Workers use `new Worker(new URL(..., import.meta.url), { type: 'module' })`.
- `.github/workflows/ci.yml` (lint, typecheck, unit tests, build, E2E) and `deploy.yml`
  (official `actions/upload-pages-artifact` + `actions/deploy-pages`).

## 9. Risks and mitigations

| Risk                                               | Mitigation                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| O(N²) algorithms freeze or exhaust memory          | Workers, cost estimates, explicit subsampling, Barnes–Hut, sampled metrics                  |
| umap-js differs from Python umap-learn             | Documented (random init, NN-descent); tested on neighbourhood preservation, not coordinates |
| WebGL unavailable                                  | Detected up front; the data table remains usable                                            |
| Large uploads exceed browser memory                | Size estimate vs. `performance.memory` / `deviceMemory`, warning before import              |
| Coordinate systems of different projections differ | Comparison never aligns implicitly; Procrustes is an explicit, labelled option              |
| Sessions leaking private data                      | Raw values only embedded on explicit opt-in, with a warning; share URLs never contain data  |
