"""Build the bundled static demonstration datasets in public/datasets/.

    python scripts/build_datasets.py

Iris and Digits are taken from scikit-learn's bundled copies of the UCI datasets (CC BY 4.0).
Output format (JSON):
    { name, n, d, featureNames, ids, values: flat row-major list, columns: [...], provenance }
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import sklearn
from sklearn.datasets import load_digits, load_iris

OUT = Path(__file__).resolve().parent.parent / "public" / "datasets"


def write(name: str, payload: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.json"
    with open(path, "w", encoding="utf8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    print(f"wrote {path.name} ({path.stat().st_size / 1024:.0f} KB)")


def iris() -> None:
    data = load_iris()
    names = ["sepal length (cm)", "sepal width (cm)", "petal length (cm)", "petal width (cm)"]
    species = [str(data.target_names[t]) for t in data.target]
    write(
        "iris",
        {
            "name": "Iris",
            "n": 150,
            "d": 4,
            "featureNames": names,
            "ids": [f"iris_{i + 1:03d}" for i in range(150)],
            "values": [round(float(v), 4) for v in data.data.ravel()],
            "columns": [{"name": "species", "role": "label", "kind": "categorical", "values": species}],
            "provenance": {
                "source": "R. A. Fisher (1936); UCI Machine Learning Repository, via scikit-learn "
                + sklearn.__version__,
                "license": "CC BY 4.0",
                "citation": "Fisher, R. A. (1936). The use of multiple measurements in taxonomic problems. "
                "Annals of Eugenics, 7(2), 179-188. Dataset: https://doi.org/10.24432/C56C76",
                "url": "https://archive.ics.uci.edu/dataset/53/iris",
                "featureDescription": "Four morphological measurements in centimetres.",
                "preprocessing": "None. scikit-learn's copy, which corrects two values relative to the "
                "original UCI file as documented by scikit-learn.",
                "synthetic": False,
            },
        },
    )


def digits() -> None:
    data = load_digits()
    n, d = data.data.shape
    write(
        "digits",
        {
            "name": "Handwritten digits (8×8)",
            "n": int(n),
            "d": int(d),
            "featureNames": [f"pixel_{r}_{c}" for r in range(8) for c in range(8)],
            "ids": [f"digit_{i + 1:04d}" for i in range(n)],
            "values": [int(v) for v in data.data.ravel()],
            "columns": [
                {"name": "digit", "role": "label", "kind": "categorical", "values": [str(t) for t in data.target]}
            ],
            "provenance": {
                "source": "Optical Recognition of Handwritten Digits (Alpaydin & Kaynak, 1998), UCI Machine "
                "Learning Repository; the 1 797-sample test set bundled with scikit-learn " + sklearn.__version__,
                "license": "CC BY 4.0",
                "citation": "Alpaydin, E. & Kaynak, C. (1998). Optical Recognition of Handwritten Digits. "
                "UCI Machine Learning Repository. https://doi.org/10.24432/C50P49",
                "url": "https://archive.ics.uci.edu/dataset/80/optical+recognition+of+handwritten+digits",
                "featureDescription": "64 features: 32×32 bitmaps divided into non-overlapping 4×4 blocks; "
                "each feature counts the 'on' pixels in a block (integer 0–16), giving an 8×8 image.",
                "preprocessing": "None beyond the original block counting.",
                "synthetic": False,
            },
        },
    )


if __name__ == "__main__":
    iris()
    digits()
