/** A metric value with the information required to interpret it honestly. */
export interface MetricValue {
  value: number;
  /** True when computed on a subsample of observations or pairs. */
  approximate: boolean;
  /** Number of observations (or pairs) the value is based on. */
  sampleSize: number;
  /** Number of observations available. */
  population: number;
  seed: number | null;
  note?: string;
}

export interface QualityMetrics {
  k: number;
  trustworthiness: MetricValue | null;
  continuity: MetricValue | null;
  neighborhoodPreservation: MetricValue | null;
  distanceCorrelation: MetricValue | null;
  silhouetteOriginal: MetricValue | null;
  silhouetteProjected: MetricValue | null;
  silhouetteLabelColumn: string | null;
  computedAt: string;
  runtimeMs: number;
  warnings: string[];
}

export interface MetricsRequestOptions {
  k: number;
  /** Maximum number of query observations for neighbourhood metrics. */
  maxQueries: number;
  /** Maximum number of observations used for silhouette (subset, as in scikit-learn). */
  maxSilhouette: number;
  /** Number of sampled pairs for the distance correlation. */
  distancePairs: number;
  seed: number;
}

export interface RepresentationComparison {
  matched: number;
  cka: MetricValue | null;
  rsa: MetricValue | null;
  knnAgreement: MetricValue | null;
  knnAccuracy: { name: string; value: MetricValue }[] | null;
  distancePairs: { a: number; b: number }[];
  distancePearson: number | null;
  /** k-means with the same k in each representation; agreement measured by the adjusted Rand index. */
  clusterAgreement: { k: number; ariAB: number; ariALabels: number | null; ariBLabels: number | null } | null;
  k: number;
  runtimeMs: number;
  warnings: string[];
}
