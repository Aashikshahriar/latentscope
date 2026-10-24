import { DropdownMenu } from 'radix-ui';
import {
  Bookmark,
  Crosshair,
  Download,
  Lasso,
  Maximize2,
  Minimize2,
  MousePointer2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  RotateCcw,
  Share2,
  SquareDashed,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, EmptyState, ProgressBar, Spinner } from '@/components/ui/Feedback';
import type { Dataset } from '@/types/dataset';
import { useExperimentStore } from '@/stores/experimentStore';
import { useUiStore } from '@/stores/uiStore';
import { useViewStore } from '@/stores/viewStore';
import { ALGORITHM_LABELS } from '@/services/experiments/runner';
import { methodSummary, paramsSummary } from '@/services/experiments/describe';
import { EmbeddingCanvas, type EmbeddingCanvasApi } from '@/visualization/EmbeddingCanvas';
import { Legend } from '@/visualization/Legend';
import { mainCanvas } from '@/visualization/registry';
import { formatDuration, formatInteger } from '@/utils/format';
import { createId } from '@/utils/misc';
import {
  axisTitlesFor,
  useColorMapping,
  useDisplayedProjection,
  useHiddenMask,
  useShapes,
} from './useExplorerData';
import { backgroundCss } from '@/visualization/common/background';
import { useIsDesktop } from '@/hooks/useMediaQuery';

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

const WARNINGS: Record<string, string> = {
  tsne: 't-SNE preserves local neighbourhoods only. Gaps between clusters, cluster sizes and densities are not reliable, and visual separation alone is not evidence of class separation in the original space.',
  umap: 'UMAP preserves local neighbourhood structure; distances between clusters are only loosely meaningful and cluster sizes do not reflect original-space density.',
};

export function CanvasPanel({ dataset }: { dataset: Dataset | null }) {
  const projection = useDisplayedProjection(dataset);
  const mapping = useColorMapping(dataset);
  const hidden = useHiddenMask(dataset, mapping);
  const shapes = useShapes(mapping);
  const visuals = useViewStore((s) => s.visuals);
  const selection = useViewStore((s) => s.selection);
  const focus = useViewStore((s) => s.focus);
  const hover = useViewStore((s) => s.hover);
  const tool = useViewStore((s) => s.tool);
  const hiddenKeys = useViewStore((s) => s.hidden);
  const fitRequest = useViewStore((s) => s.fitRequest);
  const resetRequest = useViewStore((s) => s.resetRequest);
  const bookmarks = useViewStore((s) => s.bookmarks);
  const job = useExperimentStore((s) => s.jobs.projection);
  const ui = useUiStore();
  const isDesktop = useIsDesktop();
  const apiRef = useRef<EmbeddingCanvasApi | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [hasWebgl] = useState(webglAvailable);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === panelRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    mainCanvas.current = apiRef.current;
    return () => {
      mainCanvas.current = null;
    };
  });

  const experiment = projection?.experiment ?? null;
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void panelRef.current?.requestFullscreen?.();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const store = useViewStore.getState();
    switch (e.key.toLowerCase()) {
      case 'f':
        store.requestFit();
        break;
      case 'r':
        store.requestReset();
        break;
      case 'v':
        store.setTool('navigate');
        break;
      case 'b':
        store.setTool('rectangle');
        break;
      case 'l':
        store.setTool('lasso');
        break;
      case 'escape':
        if (store.tool !== 'navigate') store.setTool('navigate');
        else store.clearSelection();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const labelColumn = dataset?.columns.find((c) => c.role === 'label' || c.role === 'sample-name');
  const describe = (row: number) => {
    if (!dataset) return '';
    const label = labelColumn ? labelColumn.values[row] : null;
    return label !== null && label !== undefined ? `${dataset.ids[row]} · ${label}` : dataset.ids[row]!;
  };

  const warning =
    experiment && WARNINGS[experiment.algorithm] && !dismissed.includes(experiment.algorithm)
      ? WARNINGS[experiment.algorithm]
      : null;
  const rows = projection ? projection.coords.length / projection.dims : 0;

  return (
    <div ref={panelRef} className="relative flex h-full min-h-0 flex-col bg-canvas" onKeyDown={onKeyDown}>
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5">
        {isDesktop && (
          <IconButton
            label={ui.leftOpen ? 'Hide controls' : 'Show controls'}
            icon={<PanelLeft />}
            active={ui.leftOpen}
            onClick={() => ui.setLeftOpen(!ui.leftOpen)}
          />
        )}
        <div className="min-w-0 flex-1 basis-[14rem]">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-sm font-semibold text-fg">{dataset?.name ?? 'No dataset loaded'}</h1>
            {experiment && (
              <>
                <Badge tone="accent">
                  {ALGORITHM_LABELS[experiment.algorithm]} · {experiment.outputDims}D
                </Badge>
                {experiment.rowIndices && (
                  <Badge tone="warning">subsample {formatInteger(experiment.rowIndices.length)}</Badge>
                )}
                {experiment.diagnostics.kind === 'pca' && !experiment.diagnostics.exact && (
                  <Badge tone="warning">approximate</Badge>
                )}
              </>
            )}
            {projection?.preview && <Badge tone="teal">live preview</Badge>}
          </div>
          {experiment && (
            <p
              className="num truncate text-2xs text-subtle"
              title={`${paramsSummary(experiment.params)} · ${methodSummary(experiment)}`}
            >
              {paramsSummary(experiment.params)} · {methodSummary(experiment)} ·{' '}
              {formatDuration(experiment.runtimeMs)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-0.5" role="toolbar" aria-label="Visualization tools">
          <IconButton
            label="Navigate and inspect"
            shortcut="V"
            icon={<MousePointer2 />}
            active={tool === 'navigate'}
            onClick={() => useViewStore.getState().setTool('navigate')}
          />
          <IconButton
            label="Rectangle selection"
            shortcut="B"
            icon={<SquareDashed />}
            active={tool === 'rectangle'}
            onClick={() => useViewStore.getState().setTool('rectangle')}
          />
          <IconButton
            label="Lasso selection"
            shortcut="L"
            icon={<Lasso />}
            active={tool === 'lasso'}
            onClick={() => useViewStore.getState().setTool('lasso')}
          />
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <IconButton
            label="Fit to visible points"
            shortcut="F"
            icon={<Crosshair />}
            onClick={() => useViewStore.getState().requestFit()}
            disabled={!projection}
          />
          <IconButton
            label="Reset camera"
            shortcut="R"
            icon={<RotateCcw />}
            onClick={() => useViewStore.getState().requestReset()}
            disabled={!projection}
          />
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                disabled={!experiment}
                aria-label="Camera bookmarks"
                className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-elevated hover:text-fg disabled:opacity-40"
              >
                <Bookmark className="size-4" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="z-50 min-w-56 rounded-lg border border-line bg-elevated p-1 shadow-pop animate-fade-in"
              >
                <DropdownMenu.Item
                  className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent/15"
                  onSelect={() => {
                    const camera = apiRef.current?.getCamera();
                    if (!camera || !experiment) return;
                    const count = bookmarks.filter((b) => b.experimentId === experiment.id).length;
                    useViewStore.getState().addBookmark({
                      id: createId('cam'),
                      name: `View ${count + 1}`,
                      experimentId: experiment.id,
                      camera,
                    });
                  }}
                >
                  <Bookmark className="size-3.5" /> Save current view
                </DropdownMenu.Item>
                {bookmarks.filter((b) => b.experimentId === experiment?.id).length > 0 && (
                  <DropdownMenu.Separator className="my-1 h-px bg-line" />
                )}
                {bookmarks
                  .filter((b) => b.experimentId === experiment?.id)
                  .map((b) => (
                    <DropdownMenu.Item
                      key={b.id}
                      className="group flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent/15"
                      onSelect={() => apiRef.current?.setCamera(b.camera)}
                    >
                      <span className="flex-1">Restore “{b.name}”</span>
                      <button
                        type="button"
                        aria-label={`Delete ${b.name}`}
                        className="rounded p-0.5 text-subtle hover:text-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          useViewStore.getState().removeBookmark(b.id);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </DropdownMenu.Item>
                  ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <IconButton
            label="Export figure and data"
            icon={<Download />}
            onClick={() => ui.setExportOpen(true)}
            disabled={!experiment}
          />
          <IconButton
            label="Share configuration"
            icon={<Share2 />}
            onClick={() => ui.setShareOpen(true)}
            disabled={!experiment}
          />
          <IconButton
            label={fullscreen ? 'Exit full screen' : 'Full screen'}
            icon={fullscreen ? <Minimize2 /> : <Maximize2 />}
            onClick={toggleFullscreen}
          />
          {isDesktop && (
            <>
              <IconButton
                label={ui.bottomOpen ? 'Hide analysis panel' : 'Show analysis panel'}
                icon={<PanelBottom />}
                active={ui.bottomOpen}
                onClick={() => ui.setBottomOpen(!ui.bottomOpen)}
              />
              <IconButton
                label={ui.rightOpen ? 'Hide inspector' : 'Show inspector'}
                icon={<PanelRight />}
                active={ui.rightOpen}
                onClick={() => ui.setRightOpen(!ui.rightOpen)}
              />
            </>
          )}
        </div>
      </div>

      <div
        className="relative min-h-0 flex-1"
        tabIndex={0}
        aria-label="Embedding visualization. Keyboard: F fit, R reset, V navigate, B rectangle select, L lasso, Escape clear selection."
      >
        {!hasWebgl ? (
          <EmptyState title="WebGL is not available" icon={<X />}>
            Your browser or device does not provide WebGL, which the point-cloud view requires. The data table
            in the analysis panel still lists every observation and its coordinates.
          </EmptyState>
        ) : projection && dataset && mapping ? (
          <>
            <EmbeddingCanvas
              ref={apiRef}
              coords={projection.coords}
              dims={projection.dims}
              rowIndices={projection.rowIndices}
              colors={mapping.colors}
              shapes={shapes}
              hidden={hidden}
              selection={selection}
              focus={focus}
              hover={hover}
              visuals={visuals}
              tool={tool}
              background={backgroundCss(visuals.background, visuals.customBackground)}
              axisTitles={axisTitlesFor(experiment)}
              ariaLabel={`${projection.dims}D projection of ${dataset.name} with ${formatInteger(rows)} points${experiment ? ` computed by ${ALGORITHM_LABELS[experiment.algorithm]}` : ''}. ${selection.length} selected.`}
              onHover={(row) => useViewStore.getState().setHover(row)}
              onPick={(row, mods) => {
                const view = useViewStore.getState();
                if (row === null) {
                  if (!mods.shift) view.setFocus(null);
                  return;
                }
                view.setFocus(row);
                if (mods.shift) view.setSelection([row], view.selection.includes(row) ? 'subtract' : 'add');
                else if (mods.meta) view.setSelection([row], 'add');
              }}
              onSelectRegion={(rowsSelected, mode) => {
                useViewStore.getState().setSelection(rowsSelected, mode);
              }}
              fitRequest={fitRequest}
              resetRequest={resetRequest}
              labelFor={describe}
            />
            <Legend
              mapping={mapping}
              position={visuals.legendPosition}
              hidden={hiddenKeys}
              shapes={visuals.shapeEncoding}
              sequentialPalette={visuals.sequentialPalette}
              onToggle={(k) => useViewStore.getState().toggleHidden(k)}
              onSolo={(k) =>
                useViewStore
                  .getState()
                  .setHidden(mapping.categories.filter((c) => c.key !== k).map((c) => c.key))
              }
            />
            {hover !== null && dataset && (
              <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-xs rounded-md border border-line bg-elevated/95 px-2.5 py-1.5 text-xs shadow-pop">
                <span className="num text-fg">{describe(hover)}</span>
              </div>
            )}
            {selection.length > 0 && (
              <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-elevated/95 py-1 pr-1 pl-3 text-xs shadow-pop">
                <span className="num text-fg">{formatInteger(selection.length)} selected</span>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => useViewStore.getState().clearSelection()}
                  icon={<X className="size-3" />}
                >
                  Clear
                </Button>
              </div>
            )}
            {projection.preview && (
              <div className="absolute top-3 left-1/2 z-10 w-64 -translate-x-1/2 rounded-lg border border-teal/30 bg-elevated/95 px-3 py-2 text-xs shadow-pop">
                <div className="flex justify-between">
                  <span className="text-teal">Optimising…</span>
                  <span className="num text-muted">
                    {projection.preview.iteration}/{projection.preview.total}
                  </span>
                </div>
                <ProgressBar
                  className="mt-1.5"
                  value={
                    projection.preview.total ? projection.preview.iteration / projection.preview.total : null
                  }
                  label="Optimisation progress"
                />
              </div>
            )}
            {warning && (
              <div className="absolute right-3 bottom-3 z-10 max-w-sm rounded-lg border border-warning/25 bg-elevated/95 p-2.5 text-2xs leading-relaxed text-[#f8e2a8] shadow-pop">
                <div className="flex gap-2">
                  <p>
                    {warning}{' '}
                    <Link to={`/learn/${experiment!.algorithm}`} className="text-accent hover:underline">
                      Learn why
                    </Link>
                  </p>
                  <button
                    type="button"
                    aria-label="Dismiss warning"
                    className="self-start text-subtle hover:text-fg"
                    onClick={() => setDismissed((d) => [...d, experiment!.algorithm])}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : job ? (
          <div className="grid h-full place-items-center">
            <div className="w-72 space-y-3 text-center">
              <Spinner className="mx-auto size-6" />
              <p className="text-sm text-fg">{job.progress?.stage ?? 'Starting the compute worker…'}</p>
              <ProgressBar value={job.progress?.fraction ?? null} label="Computation progress" />
            </div>
          </div>
        ) : (
          <EmptyState title={dataset ? 'No projection yet' : 'No dataset loaded'} icon={<Crosshair />}>
            {dataset
              ? 'Choose an algorithm in the controls panel and press Run to compute a projection of this dataset.'
              : 'Load a demonstration dataset or import your own embeddings to begin.'}
          </EmptyState>
        )}
      </div>
    </div>
  );
}
