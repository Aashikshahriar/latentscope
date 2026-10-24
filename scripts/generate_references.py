"""Generate reference values for LatentScope's scientific tests.

Every fixture is produced by a trusted implementation (scikit-learn, SciPy, NumPy, umap-learn)
on small, seeded inputs, and stored as JSON together with the inputs. The TypeScript tests in
tests/scientific/ recompute the same quantities and compare within stated tolerances.

Usage:
    python scripts/generate_references.py

Requires: numpy, scipy, scikit-learn, umap-learn (versions are recorded in the fixtures).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np
import scipy
import sklearn
from scipy.cluster.hierarchy import linkage
from scipy.spatial import procrustes
from scipy.spatial.distance import pdist
from scipy.stats import spearmanr
from sklearn.cluster import DBSCAN, AgglomerativeClustering, KMeans
from sklearn.datasets import load_iris, make_blobs
from sklearn.decomposition import PCA
from sklearn.manifold import trustworthiness
from sklearn.manifold._t_sne import _joint_probabilities, _joint_probabilities_nn, _kl_divergence
from sklearn.metrics import adjusted_rand_score, pairwise_distances, silhouette_score
from sklearn.neighbors import NearestNeighbors

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "scientific" / "fixtures"
NPY_DIR = ROOT / "tests" / "unit" / "fixtures" / "npy"


def versions() -> dict[str, str]:
    out = {
        "python": sys.version.split()[0],
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "scikit-learn": sklearn.__version__,
    }
    try:
        import umap  # noqa: PLC0415

        out["umap-learn"] = umap.__version__
    except ImportError:
        pass
    return out


def dump(name: str, payload: dict) -> None:
    payload = {"generatedBy": "scripts/generate_references.py", "versions": versions(), **payload}
    FIXTURES.mkdir(parents=True, exist_ok=True)
    with open(FIXTURES / f"{name}.json", "w", encoding="utf8") as fh:
        json.dump(payload, fh, indent=None, separators=(",", ":"))
    print(f"wrote {name}.json")


def tolist(a: np.ndarray) -> list:
    return np.asarray(a, dtype=np.float64).tolist()


def correlated_data(rng: np.random.Generator, n: int, d: int) -> np.ndarray:
    latent = rng.normal(size=(n, d))
    mixing = rng.normal(size=(d, d)) * np.linspace(3.0, 0.2, d)
    return latent @ mixing + rng.normal(size=d) * 5


def pca_fixture() -> None:
    rng = np.random.default_rng(7)
    cases = {}
    for label, (n, d) in {"tall": (60, 6), "wide": (12, 30)}.items():
        x = correlated_data(rng, n, d)
        k = min(n, d)
        pca = PCA(n_components=k, svd_solver="full").fit(x)
        cases[label] = {
            "n": n,
            "d": d,
            "x": tolist(x),
            "explainedVariance": tolist(pca.explained_variance_),
            "explainedVarianceRatio": tolist(pca.explained_variance_ratio_),
            "components": tolist(pca.components_[:3]),
            "scores": tolist(pca.transform(x)[:, :3]),
        }
    iris = load_iris()
    pca = PCA(n_components=4, svd_solver="full").fit(iris.data)
    cases["iris"] = {
        "n": 150,
        "d": 4,
        "x": tolist(iris.data),
        "explainedVariance": tolist(pca.explained_variance_),
        "explainedVarianceRatio": tolist(pca.explained_variance_ratio_),
        "components": tolist(pca.components_[:3]),
        "scores": tolist(pca.transform(iris.data)[:, :3]),
    }
    dump("pca", {"cases": cases})


def tsne_fixture() -> None:
    rng = np.random.default_rng(11)
    centers = rng.normal(scale=6, size=(3, 5))
    x = np.vstack([c + rng.normal(size=(15, 5)) for c in centers])
    n = x.shape[0]
    perplexity = 10.0
    dist = pairwise_distances(x, metric="euclidean", squared=True)
    p_condensed = _joint_probabilities(dist, perplexity, 0)
    y = rng.normal(size=(n, 2))
    kl, grad = _kl_divergence(y.ravel(), p_condensed, 1, n, 2)

    k = min(n - 1, int(3.0 * perplexity + 1))
    nn = NearestNeighbors(n_neighbors=k, metric="euclidean").fit(x)
    dist_nn = nn.kneighbors_graph(mode="distance")
    dist_nn.data **= 2
    p_sparse = _joint_probabilities_nn(dist_nn, perplexity, 0).toarray()
    dump(
        "tsne",
        {
            "n": n,
            "d": 5,
            "perplexity": perplexity,
            "x": tolist(x),
            "pCondensed": tolist(p_condensed),
            "y": tolist(y),
            "kl": float(kl),
            "grad": tolist(grad.reshape(n, 2)),
            "kSparse": k,
            "pSparseDense": tolist(p_sparse),
        },
    )


def neighborhood_fixture() -> None:
    rng = np.random.default_rng(3)
    x = correlated_data(rng, 80, 10)
    z = PCA(n_components=2).fit_transform(x) + rng.normal(scale=0.5, size=(80, 2))
    out = {"x": tolist(x), "z": tolist(z), "n": 80, "dx": 10, "dz": 2, "cases": []}
    for k in (5, 10, 20):
        # kneighbors() without X excludes the query point itself.
        nnx = NearestNeighbors(n_neighbors=k).fit(x).kneighbors(return_distance=False)
        nnz = NearestNeighbors(n_neighbors=k).fit(z).kneighbors(return_distance=False)
        overlap = np.mean([len(set(a) & set(b)) / k for a, b in zip(nnx, nnz)])
        out["cases"].append(
            {
                "k": k,
                "trustworthiness": float(trustworthiness(x, z, n_neighbors=k)),
                "continuity": float(trustworthiness(z, x, n_neighbors=k)),
                "preservation": float(overlap),
            }
        )
    dump("neighborhood", out)


def silhouette_fixture() -> None:
    x, labels = make_blobs(n_samples=90, centers=4, n_features=6, cluster_std=2.5, random_state=5)
    dump(
        "silhouette",
        {
            "x": tolist(x),
            "labels": labels.tolist(),
            "n": 90,
            "d": 6,
            "silhouette": float(silhouette_score(x, labels)),
        },
    )


def representation_fixture() -> None:
    rng = np.random.default_rng(21)
    n = 70
    a = rng.normal(size=(n, 12))
    b = np.tanh(a @ rng.normal(size=(12, 9))) + 0.3 * rng.normal(size=(n, 9))

    def linear_cka(x: np.ndarray, y: np.ndarray) -> float:
        x = x - x.mean(0)
        y = y - y.mean(0)
        return float(np.linalg.norm(y.T @ x) ** 2 / (np.linalg.norm(x.T @ x) * np.linalg.norm(y.T @ y)))

    rsa_euclid = spearmanr(pdist(a), pdist(b)).statistic
    rsa_corr = spearmanr(pdist(a, "correlation"), pdist(b, "correlation")).statistic
    pa = rng.normal(size=(n, 2))
    theta = 0.7
    rot = np.array([[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]])
    pb = 3.0 * pa @ rot + 4.0 + 0.2 * rng.normal(size=(n, 2))
    _, aligned, disparity = procrustes(pa, pb)
    dump(
        "representation",
        {
            "n": n,
            "a": tolist(a),
            "b": tolist(b),
            "da": 12,
            "db": 9,
            "cka": linear_cka(a, b),
            "ckaSelfRotated": linear_cka(a, a @ np.linalg.qr(rng.normal(size=(12, 12)))[0] * 2.5),
            "rsaEuclidean": float(rsa_euclid),
            "rsaCorrelation": float(rsa_corr),
            "procrustesA": tolist(pa),
            "procrustesB": tolist(pb),
            "procrustesDisparity": float(disparity),
        },
    )


def clustering_fixture() -> None:
    x, truth = make_blobs(n_samples=150, centers=4, n_features=5, cluster_std=1.0, random_state=42)
    km = KMeans(n_clusters=4, n_init=10, random_state=0).fit(x)
    db = DBSCAN(eps=2.5, min_samples=5).fit(x)
    out = {
        "x": tolist(x),
        "n": 150,
        "d": 5,
        "truth": truth.tolist(),
        "kmeansInertia": float(km.inertia_),
        "kmeansLabels": km.labels_.tolist(),
        "dbscanEps": 2.5,
        "dbscanMinSamples": 5,
        "dbscanLabels": db.labels_.tolist(),
        "agglomerative": {},
        "linkageHeights": {},
    }
    rng = np.random.default_rng(9)
    small = rng.normal(size=(40, 3))
    out["small"] = tolist(small)
    for method in ("ward", "average", "complete", "single"):
        agg = AgglomerativeClustering(n_clusters=4, linkage=method).fit(x)
        out["agglomerative"][method] = agg.labels_.tolist()
        out["linkageHeights"][method] = tolist(linkage(small, method=method)[:, 2])
    labels_a = rng.integers(0, 4, size=200)
    labels_b = np.where(rng.random(200) < 0.6, labels_a, rng.integers(0, 5, size=200))
    out["ariA"] = labels_a.tolist()
    out["ariB"] = labels_b.tolist()
    out["ari"] = float(adjusted_rand_score(labels_a, labels_b))
    dump("clustering", out)


def umap_fixture() -> None:
    try:
        from umap.umap_ import fuzzy_simplicial_set  # noqa: PLC0415
    except ImportError:
        print("umap-learn not installed; skipping umap fixture")
        return
    rng = np.random.default_rng(4)
    x = np.vstack([rng.normal(size=(25, 3)), rng.normal(size=(25, 3)) + 4]).astype(np.float64)
    n_neighbors = 8
    nn = NearestNeighbors(n_neighbors=n_neighbors).fit(x)
    dists, idx = nn.kneighbors(x)  # includes self at column 0
    graph, sigmas, rhos = fuzzy_simplicial_set(
        x, n_neighbors, np.random.RandomState(0), "euclidean", knn_indices=idx, knn_dists=dists
    )
    dump(
        "umap",
        {
            "x": tolist(x),
            "n": 50,
            "nNeighbors": n_neighbors,
            "knnIndices": idx.tolist(),
            "knnDistances": tolist(dists),
            "weights": tolist(graph.toarray()),
            "sigmas": tolist(sigmas),
            "rhos": tolist(rhos),
        },
    )


def npy_fixtures() -> None:
    NPY_DIR.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(1)
    f32 = rng.normal(size=(5, 3)).astype("<f4")
    np.save(NPY_DIR / "f32_c.npy", f32)
    np.save(NPY_DIR / "f64_fortran.npy", np.asfortranarray(rng.normal(size=(4, 3))))
    np.save(NPY_DIR / "i16_be.npy", np.arange(12, dtype=">i2").reshape(3, 4))
    np.save(NPY_DIR / "u8.npy", np.arange(6, dtype="u1").reshape(2, 3))
    np.save(NPY_DIR / "labels_u.npy", np.array(["cat", "dog", "bird", "cat", "fish"]))
    np.save(NPY_DIR / "bool.npy", np.array([True, False, True]))
    np.save(NPY_DIR / "vector.npy", np.arange(4, dtype="<f8"))
    np.save(NPY_DIR / "cube.npy", np.zeros((2, 2, 2), dtype="<f4"))
    np.save(NPY_DIR / "objects.npy", np.array([{"a": 1}, None], dtype=object), allow_pickle=True)
    np.savez_compressed(NPY_DIR / "bundle_compressed.npz", embeddings=f32, labels=np.array(["a", "b", "a", "c", "b"]))
    np.savez(NPY_DIR / "bundle_stored.npz", embeddings=f32, ids=np.arange(5))
    with open(NPY_DIR / "expected.json", "w", encoding="utf8") as fh:
        json.dump({"f32": tolist(f32)}, fh)
    print("wrote npy fixtures")


if __name__ == "__main__":
    os.chdir(ROOT)
    pca_fixture()
    tsne_fixture()
    neighborhood_fixture()
    silhouette_fixture()
    representation_fixture()
    clustering_fixture()
    umap_fixture()
    npy_fixtures()


def benchmark_fixture() -> None:
    """Neighbourhood quality of reference implementations on the bundled Digits data.

    t-SNE and UMAP coordinates are not comparable across implementations, but their
    trustworthiness on a standard benchmark should be similar. PCA is deterministic, so its
    2-D trustworthiness must match exactly.
    """
    from sklearn.datasets import load_digits  # noqa: PLC0415
    from sklearn.manifold import TSNE  # noqa: PLC0415

    x = load_digits().data.astype(np.float64)
    out = {"n": int(x.shape[0]), "k": 10}
    z_pca = PCA(n_components=2, svd_solver="full").fit_transform(x)
    out["pcaTrustworthiness"] = float(trustworthiness(x, z_pca, n_neighbors=10))
    tsne_scores = []
    for seed in (0, 1, 2):
        z = TSNE(n_components=2, perplexity=30, init="pca", random_state=seed).fit_transform(x)
        tsne_scores.append(float(trustworthiness(x, z, n_neighbors=10)))
    out["tsneTrustworthiness"] = tsne_scores
    try:
        import umap  # noqa: PLC0415

        umap_scores = []
        for seed in (0, 1, 2):
            z = umap.UMAP(n_neighbors=15, min_dist=0.1, random_state=seed).fit_transform(x)
            umap_scores.append(float(trustworthiness(x, z, n_neighbors=10)))
        out["umapTrustworthiness"] = umap_scores
    except ImportError:
        pass
    dump("benchmark", out)


if __name__ == "__main__" and os.environ.get("LATENTSCOPE_BENCHMARK", "1") == "1":
    benchmark_fixture()
