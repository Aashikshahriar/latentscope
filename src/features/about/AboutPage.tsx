import { BookOpen, ExternalLink } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { REPOSITORY_URL, docsUrl } from '@/config';
import { APP_VERSION } from '@/utils/misc';

const REFERENCES = [
  [
    'Pearson, K. (1901). On lines and planes of closest fit to systems of points in space. Philosophical Magazine, 2(11), 559–572.',
    'PCA',
  ],
  ['van der Maaten, L. & Hinton, G. (2008). Visualizing data using t-SNE. JMLR, 9, 2579–2605.', 't-SNE'],
  [
    'van der Maaten, L. (2014). Accelerating t-SNE using tree-based algorithms. JMLR, 15, 3221–3245.',
    'Barnes–Hut t-SNE',
  ],
  [
    'Belkina, A. C. et al. (2019). Automated optimized parameters for t-SNE improve visualization and analysis of large datasets. Nature Communications, 10, 5415.',
    'learning-rate heuristic',
  ],
  [
    'McInnes, L., Healy, J. & Melville, J. (2018). UMAP: Uniform manifold approximation and projection for dimension reduction. arXiv:1802.03426.',
    'UMAP',
  ],
  [
    'Venna, J. & Kaski, S. (2001). Neighborhood preservation in nonlinear projection methods: an experimental study. ICANN.',
    'trustworthiness & continuity',
  ],
  [
    'Rousseeuw, P. J. (1987). Silhouettes: a graphical aid to the interpretation and validation of cluster analysis. J. Comput. Appl. Math., 20, 53–65.',
    'silhouette',
  ],
  [
    'Kornblith, S., Norouzi, M., Lee, H. & Hinton, G. (2019). Similarity of neural network representations revisited. ICML.',
    'linear CKA',
  ],
  [
    'Kriegeskorte, N., Mur, M. & Bandettini, P. (2008). Representational similarity analysis. Frontiers in Systems Neuroscience, 2, 4.',
    'RSA',
  ],
  [
    'Wattenberg, M., Viégas, F. & Johnson, I. (2016). How to use t-SNE effectively. Distill.',
    'interpretation caveats',
  ],
  [
    'Halko, N., Martinsson, P.-G. & Tropp, J. A. (2011). Finding structure with randomness. SIAM Review, 53(2), 217–288.',
    'randomized SVD',
  ],
] as const;

export default function AboutPage() {
  const { hash } = useLocation();
  useEffect(() => {
    const id = hash.replace('#', '');
    if (id) document.getElementById(id)?.scrollIntoView();
  }, [hash]);
  const doc = (file: string, label: string) => {
    const url = docsUrl(file);
    return url ? (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-accent hover:underline"
      >
        {label} <ExternalLink className="size-3" aria-hidden />
      </a>
    ) : (
      <span className="text-fg">{label}</span>
    );
  };
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <article className="mx-auto max-w-3xl space-y-10 px-5 py-10 text-sm leading-relaxed text-muted">
        <header>
          <p className="num text-xs text-accent">LatentScope {APP_VERSION}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg">About LatentScope</h1>
          <p className="mt-3">
            LatentScope is open-source research software for exploring how machine-learning models organise
            information in high-dimensional representation spaces. It runs entirely in the browser: there is
            no server, no account and no analytics.
          </p>
        </header>

        <section id="methodology" className="space-y-3">
          <h2 className="text-lg font-semibold text-fg">Scientific methodology</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="text-fg">PCA</span> uses a singular value decomposition of the centred data (or
              an exact eigendecomposition of the covariance or Gram matrix for large shapes); a randomized
              solver is available and labelled approximate. Signs follow scikit-learn’s convention.
            </li>
            <li>
              <span className="text-fg">t-SNE</span> is implemented in LatentScope with exact and Barnes–Hut
              gradients. Affinities, KL divergence and gradients are verified against scikit-learn. The 3D
              variant uses one degree of freedom (scikit-learn uses two).
            </li>
            <li>
              <span className="text-fg">UMAP</span> uses umap-js, the JavaScript port maintained by Google
              PAIR. It initialises randomly (umap-learn defaults to spectral initialisation), so coordinates
              are not expected to match Python; LatentScope injects exact neighbours for up to 4 000 points.
            </li>
            <li>
              <span className="text-fg">Metrics</span> (trustworthiness, continuity, neighbourhood
              preservation, silhouette, CKA, RSA, Procrustes, ARI) match scikit-learn, SciPy or the reference
              formula in the automated test suite. Sampled estimates always state their sample size and seed.
            </li>
          </ul>
          <p>
            Details: {doc('algorithms.md', 'algorithms')}, {doc('reproducibility.md', 'reproducibility')},{' '}
            {doc('datasets.md', 'datasets')}, {doc('architecture.md', 'architecture')}.
          </p>
        </section>

        <section id="privacy" className="space-y-3">
          <h2 className="text-lg font-semibold text-fg">Privacy</h2>
          <p>
            Files you import are parsed in your browser and processed in Web Workers on your device. Nothing
            is uploaded. Datasets and experiments you choose to save are kept in this browser’s IndexedDB and
            can be deleted from the{' '}
            <Link to="/datasets" className="text-accent hover:underline">
              Datasets
            </Link>{' '}
            page. Share links contain configuration only, never data. The only network requests are for the
            application itself and its bundled demonstration files — plus, if your metadata contains image
            URLs, the images you explicitly choose to load.
          </p>
        </section>

        <section id="limitations" className="space-y-3">
          <h2 className="text-lg font-semibold text-fg">Known limitations</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              All computation is bounded by browser memory and single-threaded worker speed. Exact neighbour
              search is O(N²·D); very large datasets should be subsampled (explicitly, with a recorded seed).
            </li>
            <li>Exact t-SNE is limited to 5 000 points, hierarchical clustering to 3 000 points.</li>
            <li>
              umap-js does not support spectral initialisation, densMAP or supervised parameters beyond the
              basics exposed here.
            </li>
            <li>3D figures are exported as raster images only.</li>
            <li>
              Results are reproducible for the same dataset, parameters, seed and LatentScope version;
              different browsers may produce tiny floating-point differences.
            </li>
          </ul>
        </section>

        <section id="references" className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-fg">
            <BookOpen className="size-4" aria-hidden /> References
          </h2>
          <ol className="list-decimal space-y-2 pl-5 text-xs">
            {REFERENCES.map(([ref, topic]) => (
              <li key={ref}>
                {ref} <span className="text-subtle">— {topic}</span>
              </li>
            ))}
          </ol>
        </section>

        <section id="license" className="space-y-3">
          <h2 className="text-lg font-semibold text-fg">Licence</h2>
          <p>
            LatentScope is released under the MIT licence. Bundled datasets carry their own licences (UCI
            datasets: CC BY 4.0; LatentScope-written text corpus and generated embeddings: CC0; model weights
            used offline to compute embeddings: Apache-2.0 / MIT), listed with each dataset.
          </p>
          {REPOSITORY_URL && (
            <p>
              Source code:{' '}
              <a
                href={REPOSITORY_URL}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                {REPOSITORY_URL.replace('https://', '')}
              </a>
            </p>
          )}
        </section>
      </article>
    </div>
  );
}
