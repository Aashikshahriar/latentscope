import {
  ArrowRight,
  Boxes,
  FileDown,
  Gauge,
  GitCompareArrows,
  Layers,
  Orbit,
  ShieldCheck,
} from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Link, useNavigate } from 'react-router';
import { Logo } from '@/components/common/Logo';
import { Button } from '@/components/ui/Button';
import { NAV_ITEMS } from '@/components/layout/navigation';
import { PORTFOLIO_URL, REPOSITORY_URL, docsUrl } from '@/config';
import { DEMOS } from '@/services/datasets/demos';
import { useDatasetStore } from '@/stores/datasetStore';
import { useConfigStore } from '@/stores/configStore';
import { DimensionalityExplainer } from './DimensionalityExplainer';

const HeroCloud = lazy(() => import('./HeroCloud').then((m) => ({ default: m.HeroCloud })));

const FEATURES = [
  {
    icon: <Layers />,
    title: 'High-dimensional exploration',
    text: 'Load embeddings from CSV, JSON, NPY or NPZ — validated cell by cell, processed entirely in your browser.',
    to: '/datasets',
  },
  {
    icon: <Orbit />,
    title: 'PCA, t-SNE & UMAP',
    text: 'Exact and Barnes–Hut t-SNE, UMAP via umap-js, SVD-based PCA — in Web Workers, seeded and cancellable.',
    to: '/explore',
  },
  {
    icon: <Boxes />,
    title: 'Interactive 3D visualization',
    text: 'GPU point clouds with rotation, lasso and box selection, hover inspection and camera bookmarks.',
    to: '/explore',
  },
  {
    icon: <GitCompareArrows />,
    title: 'Model representation comparison',
    text: 'Match observations by identifier and compare models with linear CKA, RSA and neighbourhood agreement.',
    to: '/models',
  },
  {
    icon: <Gauge />,
    title: 'Scientific quality metrics',
    text: 'Trustworthiness, continuity, neighbourhood preservation, distance correlation and silhouette — verified against scikit-learn.',
    to: '/compare',
  },
  {
    icon: <FileDown />,
    title: 'Publication-ready exports',
    text: 'Vector SVG and high-resolution PNG figures with embedded reproducibility metadata, CSV coordinates and sessions.',
    to: '/explore',
  },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const exploreDemo = async () => {
    const spec = DEMOS.find((d) => d.key === 'text-minilm')!.defaultSpec;
    useConfigStore.getState().setAlgorithm('umap');
    await useDatasetStore
      .getState()
      .loadDemo(spec)
      .catch(() => undefined);
    navigate('/explore');
  };
  const docs = docsUrl('algorithms.md');
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-5 py-4">
          <Logo />
          <nav aria-label="Primary" className="ml-auto hidden items-center gap-1 md:flex">
            {NAV_ITEMS.slice(0, 5).map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:text-fg"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <Link to="/explore" className="ml-auto md:ml-0">
            <Button size="sm" variant="secondary">
              Open app
            </Button>
          </Link>
        </div>
      </header>

      <main id="main">
        <section className="relative isolate flex min-h-[92dvh] items-center overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_70%_40%,rgba(124,140,255,0.16),transparent_55%),radial-gradient(ellipse_at_20%_80%,rgba(56,217,197,0.08),transparent_50%)]" />
          <div className="absolute inset-y-0 right-0 -z-10 w-full opacity-90 lg:w-[62%]">
            <Suspense fallback={null}>
              <HeroCloud />
            </Suspense>
          </div>
          <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-r from-canvas via-canvas/80 to-transparent lg:via-canvas/40" />
          <div className="mx-auto w-full max-w-7xl px-5 pt-24 pb-16">
            <div className="max-w-2xl">
              <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 px-3 py-1 text-xs text-muted backdrop-blur">
                <span className="size-1.5 rounded-full bg-teal" /> Open-source research software · runs
                entirely in your browser
              </p>
              <h1 className="text-[2.6rem] leading-[1.05] font-semibold tracking-tight text-fg sm:text-6xl">
                Explore the Geometry
                <br />
                of{' '}
                <span className="bg-gradient-to-r from-accent via-violet to-teal bg-clip-text text-transparent">
                  Intelligence
                </span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
                An interactive scientific workspace for understanding, visualizing, and comparing
                high-dimensional machine learning representations.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link to="/explore">
                  <Button variant="primary" size="lg" icon={<ArrowRight className="size-4" />}>
                    Launch Explorer
                  </Button>
                </Link>
                <Button variant="secondary" size="lg" onClick={() => void exploreDemo()}>
                  Explore Demo
                </Button>
              </div>
              <p className="mt-6 flex items-center gap-2 text-xs text-subtle">
                <ShieldCheck className="size-3.5 text-teal" aria-hidden /> No uploads, no accounts, no
                analytics. Your data never leaves this device.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-20" aria-labelledby="features">
          <h2 id="features" className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
            A research instrument, not a dashboard
          </h2>
          <p className="mt-3 max-w-2xl text-muted">
            Every number on screen is computed from your data, with its sample size, seed and approximation
            status shown next to it.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <Link
                key={f.title}
                to={f.to}
                className="group relative overflow-hidden rounded-2xl border border-line bg-card p-6 shadow-panel transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40"
              >
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                <div className="mb-4 grid size-10 place-items-center rounded-xl border border-line bg-surface text-accent [&_svg]:size-5">
                  {f.icon}
                </div>
                <h3 className="font-semibold text-fg">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.text}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-accent opacity-80 group-hover:opacity-100">
                  Open <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="border-y border-line bg-surface/40" aria-labelledby="why">
          <div className="mx-auto max-w-7xl px-5 py-20">
            <h2 id="why" className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
              Why dimensionality reduction?
            </h2>
            <p className="mt-3 mb-10 max-w-2xl text-muted">
              Two small experiments, computed live in this page. For the full story, step through{' '}
              <Link to="/learn" className="text-accent hover:underline">
                Inside the Mathematics
              </Link>
              .
            </p>
            <DimensionalityExplainer />
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-20 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-fg">Start with a real dataset</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted">
            Handwritten digits, Iris, pretrained sentence embeddings from two transformer models, and
            clearly-labelled synthetic benchmarks are built in.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/explore">
              <Button variant="primary" size="lg">
                Launch Explorer
              </Button>
            </Link>
            <Link to="/models">
              <Button variant="outline" size="lg">
                Compare two models
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-10 text-sm text-muted md:flex-row md:items-center">
          <div>
            <Logo />
            <p className="mt-2 text-xs text-subtle">Explore the Geometry of Intelligence.</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 md:ml-auto">
            {docs ? (
              <a href={docs} target="_blank" rel="noreferrer" className="hover:text-fg">
                Documentation
              </a>
            ) : (
              <Link to="/about" className="hover:text-fg">
                Documentation
              </Link>
            )}
            {REPOSITORY_URL && (
              <a href={REPOSITORY_URL} target="_blank" rel="noreferrer" className="hover:text-fg">
                GitHub repository
              </a>
            )}
            <Link to="/about" className="hover:text-fg">
              About
            </Link>
            <Link to="/about#license" className="hover:text-fg">
              License (MIT)
            </Link>
            {PORTFOLIO_URL && (
              <a href={PORTFOLIO_URL} target="_blank" rel="noreferrer" className="hover:text-fg">
                Portfolio
              </a>
            )}
          </nav>
        </div>
      </footer>
    </div>
  );
}
