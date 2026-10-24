import { Dialog as RadixDialog } from 'radix-ui';
import { BarChart3, Crosshair, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Callout } from '@/components/ui/Feedback';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useActiveDataset, useDatasetStore } from '@/stores/datasetStore';
import { useConfigStore } from '@/stores/configStore';
import { useActiveExperiment, useExperimentStore } from '@/stores/experimentStore';
import { useUiStore } from '@/stores/uiStore';
import { resetViewForDataset, useViewStore } from '@/stores/viewStore';
import { log } from '@/stores/logStore';
import { DEMOS } from '@/services/datasets/demos';
import { runProjection } from '@/services/experiments/runner';
import { decodeShareConfig, type ShareConfig } from '@/services/experiments/share';
import { DEFAULT_PREPROCESSING } from '@/algorithms/preprocessing/preprocess';
import { PCA_DEFAULTS } from '@/stores/configStore';
import { defaultColorBy } from '@/visualization/common/colorMapping';
import { mainCanvas } from '@/visualization/registry';
import { errorMessage } from '@/utils/misc';
import { ControlsSidebar } from './ControlsSidebar';
import { CanvasPanel } from './CanvasPanel';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { BottomPanel, BottomPanelContent } from '../analysis/BottomPanel';
import { ImportWizard } from '../dataset-manager/ImportWizard';
import { ExportDialog } from '../export/ExportDialog';
import { ShareDialog } from '../export/ShareDialog';

/** Datasets that already had an automatic initial projection in this session. */
const autoProjected = new Set<string>();

function applyShareConfig(config: ShareConfig) {
  const c = useConfigStore.getState();
  c.setAlgorithm(config.algorithm);
  c.setOutputDims(config.dims);
  if (config.params.algorithm === 'pca') c.setPca(config.params);
  if (config.params.algorithm === 'tsne') c.setTsne(config.params);
  if (config.params.algorithm === 'umap') c.setUmap(config.params);
  c.setPreprocessing(config.preprocessing);
}

export default function ExplorerPage() {
  const dataset = useActiveDataset();
  const experiment = useActiveExperiment();
  const datasetsLoaded = useDatasetStore((s) => Object.keys(s.datasets).length);
  const experimentsLoaded = useExperimentStore((s) => s.loaded);
  const ui = useUiStore();
  const isDesktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  const [pendingShare, setPendingShare] = useState<ShareConfig | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning' | 'danger'; text: string } | null>(null);
  const focus = useViewStore((s) => s.focus);
  const pendingCamera = useViewStore((s) => s.pendingCamera);

  // Shared link: ?cfg=…
  useEffect(() => {
    const encoded = params.get('cfg');
    if (!encoded) return;
    setParams({}, { replace: true });
    try {
      const config = decodeShareConfig(encoded);
      applyShareConfig(config);
      if (config.dataset.kind === 'demo') {
        void useDatasetStore
          .getState()
          .loadDemo(config.dataset.spec)
          .then((ds) => {
            if (config.view)
              useViewStore.setState({
                colorBy: config.view.colorBy,
                visuals: { ...useViewStore.getState().visuals, ...config.view.visuals },
              });
            autoProjected.add(ds.id);
            setNotice({
              tone: 'info',
              text: 'Configuration loaded from a shared link. Recomputing the projection with the recorded parameters and seed…',
            });
            return runProjection(ds, {
              algorithm: config.algorithm,
              params: config.params,
              preprocessing: config.preprocessing,
              outputDims: config.dims,
              autoMetrics: useConfigStore.getState().metrics,
            });
          })
          .catch((e) => setNotice({ tone: 'danger', text: errorMessage(e) }));
      } else {
        setPendingShare(config);
        setNotice({
          tone: 'warning',
          text: `This shared configuration refers to your own dataset “${config.dataset.name}” (${config.dataset.n} × ${config.dataset.d}). Import the same file and the projection will be recomputed automatically. Links never contain data.`,
        });
      }
    } catch (e) {
      setNotice({ tone: 'danger', text: errorMessage(e) });
    }
  }, [params, setParams]);

  // Apply a pending shared configuration once a dataset with the right checksum is active.
  useEffect(() => {
    if (!pendingShare || !dataset || pendingShare.dataset.kind !== 'checksum') return;
    if (dataset.checksum !== pendingShare.dataset.checksum) return;
    const config = pendingShare;
    setPendingShare(null);
    autoProjected.add(dataset.id);
    setNotice({ tone: 'info', text: 'Dataset matches the shared configuration. Recomputing…' });
    void runProjection(dataset, {
      algorithm: config.algorithm,
      params: config.params,
      preprocessing: config.preprocessing,
      outputDims: config.dims,
      autoMetrics: useConfigStore.getState().metrics,
    }).catch((e) => setNotice({ tone: 'danger', text: errorMessage(e) }));
  }, [pendingShare, dataset]);

  // First visit: load a real demonstration dataset so the workspace is never empty.
  useEffect(() => {
    if (datasetsLoaded === 0 && !params.get('cfg') && !useDatasetStore.getState().loading) {
      void useDatasetStore
        .getState()
        .loadDemo(DEMOS.find((d) => d.key === 'digits')!.defaultSpec)
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetsLoaded]);

  // When the active dataset changes: reset dataset-specific view state and pick a projection.
  const lastDataset = useRef<string | null>(null);
  useEffect(() => {
    if (!dataset || !experimentsLoaded) return;
    if (lastDataset.current === dataset.id) return;
    const switching = lastDataset.current !== null;
    lastDataset.current = dataset.id;
    const store = useExperimentStore.getState();
    const active = store.experiments.find((e) => e.id === store.activeId);
    if (switching || !active || active.datasetId !== dataset.id) {
      if (!useViewStore.getState().pendingCamera) resetViewForDataset(defaultColorBy(dataset));
      const latest = store.experiments.find(
        (e) => e.datasetId === dataset.id && e.datasetChecksum === dataset.checksum,
      );
      if (latest && active?.datasetId !== dataset.id) store.setActive(latest.id);
      else if (!latest && !autoProjected.has(dataset.id) && !store.jobs.projection) {
        autoProjected.add(dataset.id);
        log('info', `Computing an initial PCA projection of “${dataset.name}”.`);
        void runProjection(dataset, {
          algorithm: 'pca',
          params: PCA_DEFAULTS,
          preprocessing: DEFAULT_PREPROCESSING,
          outputDims: useConfigStore.getState().outputDims,
          name: `PCA · ${dataset.name} (initial)`,
          autoMetrics: dataset.n <= 20000 ? useConfigStore.getState().metrics : null,
        }).catch(() => undefined);
      }
    } else if (useViewStore.getState().colorBy.type === 'none' && !switching) {
      resetViewForDataset(defaultColorBy(dataset));
    }
  }, [dataset, experimentsLoaded]);

  // Restore a camera from a session once the canvas has fitted the new projection.
  useEffect(() => {
    if (!pendingCamera || !experiment) return;
    const t = setTimeout(() => {
      mainCanvas.current?.setCamera(pendingCamera);
      useViewStore.getState().restoreCamera(null);
    }, 250);
    return () => clearTimeout(t);
  }, [pendingCamera, experiment]);

  // On small screens, open the inspector sheet when a point is picked.
  useEffect(() => {
    if (!isDesktop && focus !== null) useUiStore.getState().setMobilePanel('inspector');
  }, [focus, isDesktop]);

  const datasetError = useDatasetStore((s) => s.error);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {(notice || datasetError) && (
        <div className="border-b border-line px-3 py-2">
          <div className="relative">
            <Callout tone={notice?.tone ?? 'danger'}>{notice?.text ?? datasetError}</Callout>
            <button
              type="button"
              aria-label="Dismiss"
              className="absolute top-2 right-2 text-subtle hover:text-fg"
              onClick={() => setNotice(null)}
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {isDesktop && ui.leftOpen && (
          <aside aria-label="Experiment controls" className="w-[312px] shrink-0 border-r border-line bg-card">
            <ControlsSidebar />
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <CanvasPanel dataset={dataset} />
          </div>
          {isDesktop && ui.bottomOpen && <BottomPanel dataset={dataset} />}
        </div>
        {isDesktop && ui.rightOpen && (
          <aside
            aria-label="Scientific inspector"
            className="w-[340px] shrink-0 border-l border-line bg-card"
          >
            <InspectorPanel dataset={dataset} />
          </aside>
        )}
      </div>

      {!isDesktop && (
        <>
          <nav
            aria-label="Workspace panels"
            className="grid shrink-0 grid-cols-3 border-t border-line bg-card pb-[env(safe-area-inset-bottom)]"
          >
            {(
              [
                ['controls', 'Controls', <SlidersHorizontal key="c" />],
                ['inspector', 'Inspector', <Crosshair key="i" />],
                ['analysis', 'Analysis', <BarChart3 key="a" />],
              ] as const
            ).map(([key, label, icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => ui.setMobilePanel(key)}
                className="flex flex-col items-center gap-0.5 py-2 text-2xs text-muted hover:text-fg [&_svg]:size-4.5"
              >
                {icon}
                {label}
              </button>
            ))}
          </nav>
          <RadixDialog.Root
            open={ui.mobilePanel !== null}
            onOpenChange={(o) => !o && ui.setMobilePanel(null)}
          >
            <RadixDialog.Portal>
              <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
              <RadixDialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[82dvh] flex-col rounded-t-2xl border-t border-line bg-card shadow-pop animate-fade-in">
                <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                  <RadixDialog.Title className="text-sm font-semibold capitalize">
                    {ui.mobilePanel}
                  </RadixDialog.Title>
                  <RadixDialog.Description className="sr-only">Workspace panel</RadixDialog.Description>
                  <RadixDialog.Close
                    className="rounded-md p-1 text-muted hover:text-fg"
                    aria-label="Close panel"
                  >
                    <X className="size-4" />
                  </RadixDialog.Close>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {ui.mobilePanel === 'controls' && <ControlsSidebar />}
                  {ui.mobilePanel === 'inspector' && <InspectorPanel dataset={dataset} />}
                  {ui.mobilePanel === 'analysis' && (
                    <div className="h-[70dvh]">
                      <BottomPanelContent dataset={dataset} />
                    </div>
                  )}
                </div>
              </RadixDialog.Content>
            </RadixDialog.Portal>
          </RadixDialog.Root>
        </>
      )}

      <ImportWizard open={ui.importOpen} onOpenChange={ui.setImportOpen} />
      <ExportDialog
        open={ui.exportOpen}
        onOpenChange={ui.setExportOpen}
        dataset={dataset}
        experiment={experiment?.datasetId === dataset?.id ? experiment : null}
      />
      <ShareDialog
        open={ui.shareOpen}
        onOpenChange={ui.setShareOpen}
        dataset={dataset}
        experiment={experiment?.datasetId === dataset?.id ? experiment : null}
      />
    </div>
  );
}
