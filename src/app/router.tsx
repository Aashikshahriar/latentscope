import { lazy, Suspense, type ReactNode } from 'react';
import { createHashRouter, Link, useRouteError } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { Spinner } from '@/components/ui/Feedback';
import { Button } from '@/components/ui/Button';
import { errorMessage } from '@/utils/misc';

const LandingPage = lazy(() => import('@/features/landing/LandingPage'));
const ExplorerPage = lazy(() => import('@/features/explorer/ExplorerPage'));
const ComparisonPage = lazy(() => import('@/features/comparison/ComparisonPage'));
const ModelComparisonPage = lazy(() => import('@/features/comparison/ModelComparisonPage'));
const DatasetsPage = lazy(() => import('@/features/dataset-manager/DatasetsPage'));
const LearnPage = lazy(() => import('@/features/education/LearnPage'));
const AboutPage = lazy(() => import('@/features/about/AboutPage'));

function PageFallback() {
  return (
    <div className="grid h-full min-h-[50vh] place-items-center">
      <Spinner className="size-6" label="Loading page" />
    </div>
  );
}

function page(node: ReactNode) {
  return <Suspense fallback={<PageFallback />}>{node}</Suspense>;
}

function RouteError() {
  const error = useRouteError();
  return (
    <div className="mx-auto max-w-lg px-6 py-24 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">{errorMessage(error)}</p>
      <Link to="/">
        <Button className="mt-6">Back to home</Button>
      </Link>
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-6 py-24 text-center">
      <p className="num text-sm text-accent">404</p>
      <h1 className="mt-2 text-xl font-semibold">This page does not exist</h1>
      <p className="mt-2 text-sm text-muted">
        The link may be outdated. LatentScope uses hash-based routes such as #/explore.
      </p>
      <Link to="/">
        <Button className="mt-6">Back to home</Button>
      </Link>
    </div>
  );
}

/**
 * Hash routing keeps every route working on GitHub Pages, which has no SPA fallback: the server
 * only ever sees /latentscope/ and the route lives in the fragment.
 */
export const router = createHashRouter([
  { path: '/', element: page(<LandingPage />), errorElement: <RouteError /> },
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { path: '/explore', element: page(<ExplorerPage />) },
      { path: '/compare', element: page(<ComparisonPage />) },
      { path: '/models', element: page(<ModelComparisonPage />) },
      { path: '/datasets', element: page(<DatasetsPage />) },
      { path: '/learn', element: page(<LearnPage />) },
      { path: '/learn/:topic', element: page(<LearnPage />) },
      { path: '/about', element: page(<AboutPage />) },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
