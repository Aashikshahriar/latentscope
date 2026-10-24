import { BarChart3, Gauge, GitCompareArrows, History, ScrollText, Table2 } from 'lucide-react';
import { useRef } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState } from '@/components/ui/Feedback';
import { Tabs } from '@/components/ui/Overlay';
import type { Dataset } from '@/types/dataset';
import { useExperimentStore, useActiveExperiment } from '@/stores/experimentStore';
import { useUiStore, type BottomTab } from '@/stores/uiStore';
import { ALGORITHM_LABELS } from '@/services/experiments/runner';
import { paramsSummary } from '@/services/experiments/describe';
import { formatDuration, formatNumber } from '@/utils/format';
import { MetricsPanel } from '../metrics/MetricsPanel';
import { HistoryPanel } from '../experiments/HistoryPanel';
import { DistributionsPanel } from './DistributionsPanel';
import { LogsPanel } from './LogsPanel';
import { DataTable } from './DataTable';
import { openExperiment } from '@/services/experiments/open';

function ComparisonSummary({ dataset }: { dataset: Dataset | null }) {
  const experiments = useExperimentStore((s) => s.experiments);
  const activeId = useExperimentStore((s) => s.activeId);
  if (!dataset) return null;
  const forDataset = experiments.filter((e) => e.datasetId === dataset.id);
  if (forDataset.length === 0) {
    return (
      <EmptyState title="Nothing to compare yet" icon={<GitCompareArrows />}>
        Run several projections of this dataset, or open the comparison workspace to run PCA, t-SNE and UMAP
        side by side.
      </EmptyState>
    );
  }
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          All projections of {dataset.name}. Metrics computed with different k are not directly comparable.
        </p>
        <Link to="/compare">
          <Button size="sm" variant="secondary" icon={<GitCompareArrows className="size-3.5" />}>
            Comparison workspace
          </Button>
        </Link>
      </div>
      <div className="scroll-thin overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="bg-surface text-left text-2xs text-subtle uppercase">
            <tr>
              <th className="px-3 py-2 font-medium">Projection</th>
              <th className="px-3 py-2 text-right font-medium">k</th>
              <th className="px-3 py-2 text-right font-medium">Trustworthiness</th>
              <th className="px-3 py-2 text-right font-medium">Continuity</th>
              <th className="px-3 py-2 text-right font-medium">Neighb. pres.</th>
              <th className="px-3 py-2 text-right font-medium">Dist. ρ</th>
              <th className="px-3 py-2 text-right font-medium">Silhouette (orig → proj)</th>
              <th className="px-3 py-2 text-right font-medium">Runtime</th>
            </tr>
          </thead>
          <tbody>
            {forDataset.map((e) => (
              <tr
                key={e.id}
                className={`cursor-pointer border-t border-line hover:bg-elevated/60 ${e.id === activeId ? 'bg-accent/[0.06]' : ''}`}
                onClick={() => void openExperiment(e)}
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <Badge tone="accent">{ALGORITHM_LABELS[e.algorithm]}</Badge>
                    <span className="text-fg">{e.outputDims}D</span>
                  </div>
                  <p className="num mt-0.5 text-2xs text-subtle">{paramsSummary(e.params)}</p>
                </td>
                <td className="num px-3 py-2 text-right">{e.metrics?.k ?? '—'}</td>
                <td className="num px-3 py-2 text-right">
                  {formatNumber(e.metrics?.trustworthiness?.value, 3)}
                </td>
                <td className="num px-3 py-2 text-right">{formatNumber(e.metrics?.continuity?.value, 3)}</td>
                <td className="num px-3 py-2 text-right">
                  {formatNumber(e.metrics?.neighborhoodPreservation?.value, 3)}
                </td>
                <td className="num px-3 py-2 text-right">
                  {formatNumber(e.metrics?.distanceCorrelation?.value, 3)}
                </td>
                <td className="num px-3 py-2 text-right">
                  {formatNumber(e.metrics?.silhouetteOriginal?.value, 3)} →{' '}
                  {formatNumber(e.metrics?.silhouetteProjected?.value, 3)}
                </td>
                <td className="num px-3 py-2 text-right">{formatDuration(e.runtimeMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function BottomPanelContent({ dataset }: { dataset: Dataset | null }) {
  const tab = useUiStore((s) => s.bottomTab);
  const setTab = useUiStore((s) => s.setBottomTab);
  const experiment = useActiveExperiment();
  return (
    <Tabs<BottomTab>
      value={tab}
      onChange={setTab}
      ariaLabel="Analysis"
      className="h-full"
      listClassName="px-2"
      contentClassName="scroll-thin overflow-y-auto"
      items={[
        {
          value: 'metrics',
          label: (
            <>
              <Gauge /> Quality metrics
            </>
          ),
          content: <MetricsPanel dataset={dataset} experiment={experiment} />,
        },
        {
          value: 'comparison',
          label: (
            <>
              <GitCompareArrows /> Algorithm comparison
            </>
          ),
          content: <ComparisonSummary dataset={dataset} />,
        },
        {
          value: 'distributions',
          label: (
            <>
              <BarChart3 /> Distributions
            </>
          ),
          content: <DistributionsPanel dataset={dataset} />,
        },
        {
          value: 'history',
          label: (
            <>
              <History /> History
            </>
          ),
          content: <HistoryPanel datasetId={dataset?.id ?? null} />,
        },
        {
          value: 'table',
          label: (
            <>
              <Table2 /> Data table
            </>
          ),
          content: dataset ? <DataTable dataset={dataset} /> : null,
        },
        {
          value: 'logs',
          label: (
            <>
              <ScrollText /> Logs
            </>
          ),
          content: <LogsPanel />,
        },
      ]}
    />
  );
}

/** Resizable bottom panel: drag the handle or use the arrow keys on it. */
export function BottomPanel({ dataset }: { dataset: Dataset | null }) {
  const height = useUiStore((s) => s.bottomHeight);
  const setHeight = useUiStore((s) => s.setBottomHeight);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const clampHeight = (h: number) => Math.max(140, Math.min(window.innerHeight * 0.7, h));
  return (
    <div className="relative flex shrink-0 flex-col border-t border-line bg-card" style={{ height }}>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize analysis panel"
        aria-valuenow={Math.round(height)}
        aria-valuemin={140}
        tabIndex={0}
        className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize hover:bg-accent/30 focus-visible:bg-accent/40"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, h: height };
        }}
        onPointerMove={(e) => {
          if (drag.current) setHeight(clampHeight(drag.current.h + drag.current.y - e.clientY));
        }}
        onPointerUp={() => (drag.current = null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') setHeight(clampHeight(height + 24));
          else if (e.key === 'ArrowDown') setHeight(clampHeight(height - 24));
        }}
      />
      <BottomPanelContent dataset={dataset} />
    </div>
  );
}
