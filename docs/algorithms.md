# Algorithms and metrics

This document describes exactly what LatentScope computes, how, and how each piece is verified.
All computation runs in Web Workers in the browser (`src/workers/handlers.ts`), using the pure
modules in `src/algorithms/`.

Verification fixtures are produced by `scripts/generate_references.py` with scikit-learn, SciPy,
NumPy and umap-learn (versions are recorded inside each fixture) and checked by the tests in
`tests/scientific/`.

## Preprocessing (`algorithms/preprocessing/preprocess.ts`)

Applied in this fixed order, each step optional and recorded in the experiment:

1. **Subsample** — seeded sampling without replacement; the selected row indices are stored with
   the experiment. Nothing is ever downsampled silently.
2. **L2 normalisation** of each observation (rows with zero norm are left unchanged and reported).
3. **Centring** of each feature (always applied for PCA).
4. **Standardisation** by the sample standard deviation (ddof = 1). Constant features are left
   unscaled and reported.

Missing, non-numeric and infinite values are resolved at import time by an explicit user choice
(reject, drop affected rows, or impute the feature mean). Datasets inside the application are
therefore always finite.

## Distances

Euclidean distances use the direct difference form Σ(aₖ − bₖ)² (no ‖a‖² + ‖b‖² − 2a·b
expansion, which loses precision for nearby points). Cosine distance is 1 − cos θ; zero vectors
are at distance 1 from everything (the umap-js convention). Exact k-nearest-neighbour search is
brute force, O(N² D), with ties broken by index so results are deterministic.

## PCA (`algorithms/pca/pca.ts`)

For centred data X_c = UΣVᵀ, the principal directions are the columns of V, the eigenvalues of the
covariance C = X_cᵀX_c / (N − 1) are λᵢ = σᵢ² / (N − 1), and the scores are Z = X_c V_k.

| Shape                   | Method                                                                                                   | Exact                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------- |
| N·D ≤ 4·10⁶             | Thin SVD of X_c (ml-matrix)                                                                              | yes                       |
| D ≤ N, D ≤ 2 000        | Symmetric eigendecomposition of C                                                                        | yes                       |
| N < D, N ≤ 2 000        | Eigendecomposition of the Gram matrix X_cX_cᵀ, V = X_cᵀUΣ⁻¹                                              | yes                       |
| otherwise / user choice | Randomized SVD (Halko et al., 2011), oversampling 10, 4 power iterations, re-orthogonalised Gram–Schmidt | no — labelled approximate |

- Explained variance ratios divide by the exact total variance tr(C), computed from the data, so
  they are correct even when only a few components are computed.
- Signs: in each component the loading with the largest magnitude is positive (scikit-learn ≥ 1.5).
- Rank deficiency is detected (eigenvalues below a relative tolerance); zero-variance axes are
  set to exactly 0 and a warning is shown.

**Verified:** explained variance, ratios, loadings and scores match `sklearn.decomposition.PCA`
(`svd_solver="full"`) to 1e-8 on tall, wide (N < D) and Iris data through **every** method
(randomized to 1e-6); orthonormality, exact reconstruction and rank-deficient inputs are tested.

## t-SNE (`algorithms/tsne/`)

LatentScope implements t-SNE (van der Maaten & Hinton, 2008) itself because no maintained
JavaScript package supports seeding, 3D output, Barnes–Hut and step-wise previews together.

- **Affinities.** σᵢ is found by bisection on βᵢ = 1/(2σᵢ²) until the entropy of P_{·|i} equals
  log(perplexity) (tolerance 1e-5, ≤ 100 steps, as scikit-learn). The joint distribution is
  p_ij = (p_{j|i} + p_{i|j}) / Σ(…) (equal to 2N up to rounding).
  Exact mode uses all pairs; Barnes–Hut mode uses k = min(N − 1, ⌊3·perplexity + 1⌋) exact
  nearest neighbours.
- **Low-dimensional similarities.** Student-t with one degree of freedom,
  q_ij ∝ (1 + ‖yᵢ − yⱼ‖²)⁻¹, in 2D **and 3D**. scikit-learn uses max(dims − 1, 1) degrees of
  freedom, so its 3D results differ by design.
- **Gradient.** ∂C/∂yᵢ = 4 Σⱼ (p_ij − q_ij)(yᵢ − yⱼ)(1 + ‖yᵢ − yⱼ‖²)⁻¹. Barnes–Hut uses a
  quadtree/octree with the criterion (cell width)² < θ²·(distance)², θ = 0.5 by default, and
  handles exact duplicate points without self-interaction.
- **Optimiser.** As scikit-learn: early exaggeration 12 for 250 iterations with momentum 0.5,
  then momentum 0.8; delta-bar-delta gains (+0.2 / ×0.8, floor 0.01); learning rate
  `auto` = max(N / exaggeration / 4, 50) (Belkina et al., 2019); stops early if the gradient
  norm falls below 1e-7.
- **Initialisation.** PCA (scaled so the first coordinate has standard deviation 1e-4, as
  scikit-learn) or seeded Gaussian N(0, 10⁻⁴).
- **PCA pre-reduction** (default 50 components when D > 50) is applied before computing
  affinities. This is common practice (not done by scikit-learn) and is recorded in the
  experiment diagnostics; quality metrics are always computed against the full preprocessed
  features.
- Exact gradients are used up to 1 500 points under `auto`; exact mode is capped at 5 000.

**Verified:** joint probabilities (exact and k-NN sparse) match scikit-learn's
`_joint_probabilities` and `_joint_probabilities_nn`, and KL divergence and gradient match
`_kl_divergence`, to float32 precision (scikit-learn casts distances to float32 before its
perplexity search, so ~1e-7 relative is the ceiling). Optimisation is tested for shape,
finiteness, determinism per seed, decreasing KL, cluster preservation, Barnes–Hut vs. exact
agreement, and identical observations. On the Digits benchmark, trustworthiness (k = 10) is
within 0.005 of scikit-learn's TSNE across seeds (0.9928 vs. 0.9926).

Raw t-SNE coordinates are **not** compared with Python outputs: they depend on random
initialisation and floating-point order and are not a meaningful correctness criterion.

## UMAP (`algorithms/umap/`)

Projections use **umap-js 1.4.0** (Google PAIR), a port of McInnes et al.'s umap-learn.

- All randomness is drawn from LatentScope's seeded generator (`random` option), so results are
  reproducible within umap-js.
- For N ≤ 4 000 (or when chosen), exact brute-force neighbours are injected through
  `setPrecomputedKNN`, removing NN-descent's approximation; above that, umap-js's NN-descent with
  random-projection trees is used and labelled as such.
- **Differences from umap-learn, not hidden:** umap-js initialises the layout uniformly at random
  in [−10, 10] (umap-learn defaults to spectral initialisation), and does not implement densMAP.
  Coordinates are therefore not expected to match Python, and LatentScope makes no claim of
  numerical equivalence.

The interactive tutorial also includes LatentScope's own implementation of UMAP's fuzzy
simplicial set (`algorithms/umap/fuzzy.ts`: `smooth_knn_dist`, membership strengths and fuzzy
union). **Verified:** ρ, σ and the symmetrised weights match umap-learn's
`fuzzy_simplicial_set` to 1e-4. umap-js itself is tested for output shape, finiteness, seeded
reproducibility (exact and approximate neighbours), parameter validation and neighbourhood
preservation; on Digits its trustworthiness is within 0.01 of umap-learn's (0.9876 vs.
0.9876–0.9887).

## Quality metrics (`algorithms/metrics/`)

"Original space" always means the preprocessed features the algorithm received (the same
subsample, if any).

| Metric                     | Definition                                                              | Notes                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Trustworthiness T(k)       | 1 − 2/(m k (2N − 3k − 1)) Σᵢ Σ_{j ∈ N_k^Z(i) \ N_k^X(i)} (r_X(i,j) − k) | Venna & Kaski (2001). Penalises false neighbours. Requires k < N/2.                                                      |
| Continuity C(k)            | Same with X and Z swapped                                               | Penalises missing neighbours.                                                                                            |
| Neighbourhood preservation | (1/m) Σᵢ \|N_k^X(i) ∩ N_k^Z(i)\| / k                                    |                                                                                                                          |
| Distance correlation       | Spearman ρ (and Pearson r) of pairwise distances                        | All pairs when ≤ 20 000 pairs, otherwise a seeded sample. Not a complete quality measure.                                |
| Silhouette                 | Rousseeuw (1987), Euclidean; singletons score 0                         | In both original and projected space, on a seeded subset of ≤ 2 000 labelled points (like scikit-learn's `sample_size`). |

When m < N query points are used (large N), the query points are a seeded random sample, but each
point's ranks are computed against **all** N points, so every term is exact and the average is an
unbiased estimate. The interface shows `sampled m/N` and the seed beside every such value.

**Verified:** trustworthiness, continuity (= trustworthiness with swapped arguments) and
neighbourhood preservation match scikit-learn to 1e-12 for k = 5, 10, 20; silhouette matches
`silhouette_score` to 1e-12.

## Representation comparison

| Measure                         | Definition                                                                                        | Verified against                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Linear CKA                      | ‖YᵀX‖²_F / (‖XᵀX‖_F ‖YᵀY‖_F), centred columns; feature- or Gram-space form, whichever is cheaper  | NumPy reference formula (1e-10); invariance to orthogonal transforms |
| RSA                             | Spearman ρ between condensed RDMs (Euclidean or 1 − Pearson r), seeded subset of ≤ m observations | `scipy.stats.spearmanr(pdist(...))` (1e-10)                          |
| kNN agreement                   | Mean \|N_k^A(i) ∩ N_k^B(i)\| / k                                                                  | Identity and range tests                                             |
| kNN accuracy                    | Leave-one-out majority vote of k neighbours (ties → nearest tied class)                           | Separable-class test                                                 |
| Cluster agreement               | k-means with the same k in A and B; adjusted Rand index between partitions and with labels        | ARI vs. `adjusted_rand_score` (1e-12)                                |
| Procrustes (visualisation only) | Centre, scale to unit Frobenius norm, R = UVᵀ from SVD of BᵀA; disparity = 1 − (tr Σ)²            | `scipy.spatial.procrustes` disparity (1e-10)                         |

Observations are matched by identical identifiers. Row-order matching requires equal sizes and an
explicit confirmation from the user.

## Clustering (`algorithms/clustering/`)

Computed clusterings are stored separately and never overwrite dataset labels.

- **k-means**: k-means++ seeding, Lloyd iterations, best of several seeded restarts, scikit-learn's
  relative tolerance. Verified to reach scikit-learn's inertia and partition (ARI = 1) on blobs.
- **DBSCAN**: scikit-learn's conventions (ε-neighbourhood includes the point, depth-first
  expansion in index order, border points join the first cluster that reaches them); memory O(N).
  Verified: identical partition and noise count to scikit-learn.
- **Agglomerative**: nearest-neighbour chain with Lance–Williams updates for Ward, average,
  complete and single linkage (N ≤ 3 000). Verified: merge heights equal SciPy's `linkage` to
  1e-9 and flat clusters equal scikit-learn's `AgglomerativeClustering` (ARI = 1) for all four.

## References

See the About page in the application, or:

- Pearson (1901); Halko, Martinsson & Tropp (2011) — PCA, randomized SVD
- van der Maaten & Hinton (2008); van der Maaten (2014); Belkina et al. (2019) — t-SNE
- McInnes, Healy & Melville (2018) — UMAP
- Venna & Kaski (2001) — trustworthiness and continuity
- Rousseeuw (1987) — silhouette
- Kornblith et al. (2019) — CKA; Kriegeskorte et al. (2008) — RSA
- Hubert & Arabie (1985) — adjusted Rand index; Murtagh (1983) — NN-chain
