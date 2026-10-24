# Bundled datasets

Every demonstration dataset records its source, licence, feature definitions and preprocessing in
the application (Explorer → Dataset → "Source & licence", and the Datasets page). Synthetic data
is labelled as synthetic everywhere it appears.

| Dataset                           | N × D                            | Source                                                                   | Licence                    | Preprocessing                |
| --------------------------------- | -------------------------------- | ------------------------------------------------------------------------ | -------------------------- | ---------------------------- |
| Synthetic Gaussian clusters       | configurable (default 900 × 20)  | Generated in the browser (seeded)                                        | CC0 (synthetic)            | none                         |
| Swiss roll                        | configurable (default 1 500 × 3) | Generated in the browser (seeded), as `sklearn.datasets.make_swiss_roll` | CC0 (synthetic)            | none                         |
| Iris                              | 150 × 4                          | Fisher (1936), UCI ML Repository, via scikit-learn                       | CC BY 4.0                  | none                         |
| Handwritten digits                | 1 797 × 64                       | Alpaydin & Kaynak (1998), UCI ML Repository, via scikit-learn            | CC BY 4.0                  | none (8×8 block counts 0–16) |
| Sentence embeddings · MiniLM      | 200 × 384                        | LatentScope corpus + `sentence-transformers/all-MiniLM-L6-v2`            | text CC0; model Apache-2.0 | mean pooling, L2-normalised  |
| Sentence embeddings · BGE-small   | 200 × 384                        | LatentScope corpus + `BAAI/bge-small-en-v1.5`                            | text CC0; model MIT        | CLS pooling, L2-normalised   |
| Paired modalities · A (EEG-like)  | 480 × 64                         | Generated in the browser (seeded)                                        | CC0 (synthetic)            | none                         |
| Paired modalities · B (fMRI-like) | 480 × 120                        | Generated in the browser (seeded)                                        | CC0 (synthetic)            | none                         |

## Synthetic Gaussian clusters

`src/services/datasets/generators.ts → gaussianClusters`. Cluster centres are drawn from
N(0, (s² / 2D)·I) so that the expected distance between two centres equals the separation `s`.
Each cluster's spread is `noise × u` with u ∈ [0.6, 1.4] drawn per cluster, so clusters have
different densities — useful for seeing how t-SNE and UMAP equalise apparent sizes. Metadata:
`cluster` (label) and `distance_to_centre` (numeric).

## Swiss roll

t = 1.5π(1 + 2u), h = 21v, (x, y, z) = (t cos t, h, t sin t) + noise·ε with u, v ~ U(0, 1).
Metadata: `position_t` (the intrinsic coordinate, numeric) and `segment` (t binned into five
categories). Linear PCA cannot unroll it; colour by `position_t` to judge whether a projection
preserves the manifold's order.

## Iris

R. A. Fisher (1936), "The use of multiple measurements in taxonomic problems", _Annals of
Eugenics_ 7(2), 179–188. Dataset DOI: 10.24432/C56C76. Taken from scikit-learn's bundled copy,
which corrects two values relative to the original UCI file (documented by scikit-learn).
Built by `scripts/build_datasets.py`.

## Handwritten digits

E. Alpaydin & C. Kaynak (1998), "Optical Recognition of Handwritten Digits", UCI ML Repository,
DOI 10.24432/C50P49. The 1 797-sample set bundled with scikit-learn: 32×32 bitmaps divided into
non-overlapping 4×4 blocks; each of the 64 features counts the "on" pixels in a block (0–16).
The inspector renders each observation as an 8×8 image. Built by `scripts/build_datasets.py`.

## Sentence embeddings (MiniLM and BGE-small)

- **Corpus:** `scripts/text-corpus.json` — 200 short English sentences written for LatentScope
  (8 topics × 25: astronomy, cooking, football, finance, medicine, music, programming, weather),
  released under CC0.
- **Models:** `sentence-transformers/all-MiniLM-L6-v2` (6-layer MiniLM, 384-D, Apache-2.0) and
  `BAAI/bge-small-en-v1.5` (BERT-small architecture, 384-D, MIT), via their ONNX exports
  (`Xenova/…`), fp32.
- **Feature extraction:** MiniLM — mean pooling over token embeddings; BGE — CLS-token pooling, as
  recommended by its authors. Both L2-normalised.
- **Tooling:** transformers.js (version recorded in `public/datasets/text-metadata.json`), run
  offline by `scripts/build-text-embeddings.mjs`. Embeddings are stored as float32 `.npy` files and
  loaded through LatentScope's own NPY parser.
- **Use:** both share observation identifiers, so they form a model-comparison demo (Compare
  models → "MiniLM vs BGE").

To regenerate: `npm install --no-save @huggingface/transformers && npm run embeddings:build`
(requires network access to download the model weights).

## Paired modalities (synthetic EEG-like / fMRI-like)

**Synthetic — not recordings of any person.** 480 trials in six conditions (80 each). Each trial
has a 4-D latent state z drawn around its condition centre. Modality A ("EEG-like", 64
band-power features) = tanh(W_A z + b_A) + per-subject offset + noise; modality B ("fMRI-like",
120 regional responses) = softplus(W_B z) + spatially smoothed noise. Both share trial
identifiers and condition labels; subject offsets affect A only. Designed as a controlled test bed
for representation-similarity measures.

## Adding a dataset

Bundled datasets live in `public/datasets/` and are registered in
`src/services/datasets/demos.ts`. Every addition must document source, licence, sample count,
feature dimensions, preprocessing and citation here and in its `provenance` record, and must be
legally redistributable.
