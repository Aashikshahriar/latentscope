# Contributing

Contributions are welcome — bug reports, scientific corrections, new metrics, datasets and
accessibility improvements in particular.

## Setup

```bash
git clone <your fork>
cd latentscope
npm ci
npm run dev          # http://localhost:5173
```

Node.js ≥ 20.19 is required. Python 3.11+ with NumPy, SciPy, scikit-learn and umap-learn is needed
only to regenerate scientific reference fixtures.

## Quality gates

All of these run in CI and must pass:

```bash
npm run lint           # ESLint (strict TypeScript, React hooks)
npm run format:check   # Prettier
npm run typecheck      # TypeScript strict mode
npm test               # Vitest: unit, integration and scientific tests
npm run build          # production build
npm run test:e2e       # Playwright (after npx playwright install chromium)
```

## Ground rules

1. **No fake functionality.** Every control must do what it says. If something cannot be done
   correctly, leave it disabled and document the limitation.
2. **Scientific claims need tests.** New algorithms or metrics come with a reference fixture from a
   trusted implementation (`scripts/generate_references.py`) and a test in `tests/scientific/`.
   Stochastic methods are tested on behaviour (shape, finiteness, determinism, neighbourhood
   quality), not on raw coordinates.
3. **Approximations are labelled.** Sampled or approximate results must carry their sample size,
   seed and approximation flag (`MetricValue`).
4. **Computation stays out of React.** `src/algorithms/` imports nothing from the UI; expensive work
   runs through `src/workers/`.
5. **Determinism.** Use `createRng(seed)`; never `Math.random()` in computation.
6. **Accessibility.** Interactive elements need accessible names and keyboard support; information
   shown only in the canvas must also be reachable in a non-visual form (the data table, inspector).
7. **Privacy.** Never add network requests that carry user data, analytics or third-party
   trackers.

## Project layout

See [architecture.md](architecture.md). Key directories: `src/algorithms` (numerics),
`src/workers` (job handlers), `src/services` (import/export/persistence/experiments),
`src/visualization` (WebGL renderer), `src/features` (pages and panels), `tests/` (unit,
integration, scientific, e2e).

## Commit and PR checklist

- [ ] Tests added or updated; all quality gates pass locally
- [ ] Documentation updated (`docs/`) for user-visible or scientific changes
- [ ] New datasets documented with source, licence, preprocessing and citation
