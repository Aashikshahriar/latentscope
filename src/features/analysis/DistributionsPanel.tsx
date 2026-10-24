import { BarChart3 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/ui/Feedback';
import { TextInput } from '@/components/ui/Form';
import { Histogram } from '@/components/charts/Charts';
import type { Dataset } from '@/types/dataset';
import { formatNumber } from '@/utils/format';
import { useColorMapping } from '../explorer/useExplorerData';

interface FeatureSummary {
  index: number;
  name: string;
  mean: number;
  sd: number;
  min: number;
  max: number;
}

function summarize(dataset: Dataset): FeatureSummary[] {
  const { n, d, values } = dataset;
  const out: FeatureSummary[] = [];
  for (let t = 0; t < d; t++) {
    let mean = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = values[i * d + t]!;
      mean += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    mean /= n;
    let ss = 0;
    for (let i = 0; i < n; i++) ss += (values[i * d + t]! - mean) ** 2;
    out.push({
      index: t,
      name: dataset.featureNames[t] ?? `feature_${t}`,
      mean,
      sd: n > 1 ? Math.sqrt(ss / (n - 1)) : 0,
      min,
      max,
    });
  }
  return out;
}

export function DistributionsPanel({ dataset }: { dataset: Dataset | null }) {
  const mapping = useColorMapping(dataset);
  const summaries = useMemo(() => (dataset ? summarize(dataset) : []), [dataset]);
  const [feature, setFeature] = useState(0);
  const [query, setQuery] = useState('');
  const values = useMemo(() => {
    if (!dataset) return new Float32Array(0);
    const out = new Float32Array(dataset.n);
    for (let i = 0; i < dataset.n; i++)
      out[i] = dataset.values[i * dataset.d + Math.min(feature, dataset.d - 1)]!;
    return out;
  }, [dataset, feature]);
  const groups = useMemo(() => {
    if (!mapping || mapping.mode !== 'categorical') return undefined;
    return {
      colorOf: (i: number) => mapping.categories[mapping.categoryIndex[i]!]?.color ?? null,
      order: mapping.categories.map((c) => c.color),
    };
  }, [mapping]);

  if (!dataset) return <EmptyState title="No dataset" icon={<BarChart3 />} />;
  const filtered = summaries.filter((s) => s.name.toLowerCase().includes(query.toLowerCase())).slice(0, 300);
  const current = summaries[Math.min(feature, summaries.length - 1)]!;
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="min-w-0">
        <p className="mb-1 text-xs font-medium text-muted">
          Distribution of <span className="text-fg">{current.name}</span>
          {mapping?.mode === 'categorical' && (
            <span className="text-subtle"> · stacked by {mapping.title}</span>
          )}
        </p>
        <Histogram
          values={values}
          groups={groups}
          height={190}
          ariaLabel={`Histogram of ${current.name}`}
          xLabel={current.name}
        />
        <p className="num mt-1 text-2xs text-subtle">
          mean {formatNumber(current.mean, 4)} · sd {formatNumber(current.sd, 4)} · range [
          {formatNumber(current.min, 4)}, {formatNumber(current.max, 4)}]
        </p>
      </div>
      <div className="min-w-0">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted">Feature summary ({dataset.d} features)</p>
          <TextInput
            className="max-w-48"
            placeholder="Filter features…"
            aria-label="Filter features"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="scroll-thin max-h-56 overflow-auto rounded-lg border border-line">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface text-left text-2xs text-subtle uppercase">
              <tr>
                <th className="px-2 py-1.5 font-medium">Feature</th>
                <th className="px-2 py-1.5 text-right font-medium">Mean</th>
                <th className="px-2 py-1.5 text-right font-medium">SD</th>
                <th className="px-2 py-1.5 text-right font-medium">Min</th>
                <th className="px-2 py-1.5 text-right font-medium">Max</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.index}
                  className={`cursor-pointer border-t border-line/60 hover:bg-elevated ${s.index === feature ? 'bg-accent/10' : ''}`}
                  onClick={() => setFeature(s.index)}
                  onKeyDown={(e) => e.key === 'Enter' && setFeature(s.index)}
                  tabIndex={0}
                  aria-selected={s.index === feature}
                >
                  <td className="max-w-[10rem] truncate px-2 py-1">{s.name}</td>
                  <td className="num px-2 py-1 text-right">{formatNumber(s.mean, 3)}</td>
                  <td className="num px-2 py-1 text-right">{formatNumber(s.sd, 3)}</td>
                  <td className="num px-2 py-1 text-right">{formatNumber(s.min, 3)}</td>
                  <td className="num px-2 py-1 text-right">{formatNumber(s.max, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {summaries.length > filtered.length && !query && (
          <p className="mt-1 text-2xs text-subtle">
            Showing the first 300 features; filter by name to find others.
          </p>
        )}
      </div>
    </div>
  );
}
