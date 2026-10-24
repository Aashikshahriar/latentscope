import { FileJson, FileSpreadsheet, ImageDown, Save, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { Checkbox, NumberField, Segmented, Select, TextInput } from '@/components/ui/Form';
import { Dialog, Tabs } from '@/components/ui/Overlay';
import type { Dataset } from '@/types/dataset';
import type { Experiment } from '@/types/experiment';
import { useViewStore } from '@/stores/viewStore';
import { ALGORITHM_LABELS } from '@/services/experiments/runner';
import { paramsSummary, reproducibilityRecord } from '@/services/experiments/describe';
import { coordinatesCsv, coordinatesJson } from '@/services/export/csv';
import { compose3dPng, renderFigurePng, renderFigureSvg, type FigureOptions } from '@/services/export/figure';
import { canvasToPngWithMetadata } from '@/services/export/png';
import { downloadBlob, downloadText, safeFileName } from '@/services/export/download';
import { buildSession, validateSession } from '@/services/export/session';
import { restoreSession } from '@/services/experiments/restore';
import { mainCanvas } from '@/visualization/registry';
import { SEQUENTIAL_PALETTES } from '@/visualization/common/palettes';
import { errorMessage } from '@/utils/misc';
import { formatBytes } from '@/utils/format';
import { useColorMapping, useHiddenMask, axisTitlesFor } from '../explorer/useExplorerData';
import { backgroundSolid } from '@/visualization/common/background';

type Tab = 'figure' | 'data' | 'session';

export function ExportDialog({
  open,
  onOpenChange,
  dataset,
  experiment,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dataset: Dataset | null;
  experiment: Experiment | null;
}) {
  const [tab, setTab] = useState<Tab>('figure');
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Export studio"
      description="Publication figures, projected coordinates and reproducible session files. Every export records the algorithm, parameters, seed, dataset checksum and software version."
    >
      {dataset && experiment ? (
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          ariaLabel="Export type"
          contentClassName="pt-4"
          items={[
            {
              value: 'figure',
              label: (
                <>
                  <ImageDown /> Figure
                </>
              ),
              content: <FigureTab dataset={dataset} experiment={experiment} />,
            },
            {
              value: 'data',
              label: (
                <>
                  <FileSpreadsheet /> Coordinates
                </>
              ),
              content: <DataTab dataset={dataset} experiment={experiment} />,
            },
            {
              value: 'session',
              label: (
                <>
                  <Save /> Session
                </>
              ),
              content: (
                <SessionTab dataset={dataset} experiment={experiment} onDone={() => onOpenChange(false)} />
              ),
            },
          ]}
        />
      ) : (
        <SessionImport onDone={() => onOpenChange(false)} />
      )}
    </Dialog>
  );
}

function figureMetadata(experiment: Experiment) {
  return {
    generator: 'LatentScope',
    exportedAt: new Date().toISOString(),
    ...reproducibilityRecord(experiment),
  };
}

function FigureTab({ dataset, experiment }: { dataset: Dataset; experiment: Experiment }) {
  const visuals = useViewStore((s) => s.visuals);
  const selection = useViewStore((s) => s.selection);
  const mapping = useColorMapping(dataset);
  const hidden = useHiddenMask(dataset, mapping);
  const titles = axisTitlesFor(experiment);
  const is3d = experiment.outputDims === 3;
  const [format, setFormat] = useState<'png' | 'svg'>(is3d ? 'png' : 'svg');
  const [width, setWidth] = useState(1200);
  const [height, setHeight] = useState(900);
  const [scale, setScale] = useState(2);
  const [bg, setBg] = useState<'current' | 'white' | 'transparent'>('white');
  const [title, setTitle] = useState(
    `${ALGORITHM_LABELS[experiment.algorithm]} projection of ${dataset.name}`,
  );
  const [xLabel, setXLabel] = useState(titles[0]);
  const [yLabel, setYLabel] = useState(titles[1]);
  const [fontSize, setFontSize] = useState(16);
  const [pointSize, setPointSize] = useState(Math.max(3, visuals.pointSize));
  const [legend, setLegend] = useState(true);
  const [axes, setAxes] = useState(true);
  const [grid, setGrid] = useState(false);
  const [caption, setCaption] = useState(true);
  const [viewportMode, setViewportMode] = useState<'all' | 'current'>('all');
  const [highlight, setHighlight] = useState(selection.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const background =
    bg === 'transparent'
      ? null
      : bg === 'white'
        ? '#FFFFFF'
        : backgroundSolid(visuals.background, visuals.customBackground);
  const foreground = background === null || background === '#FFFFFF' ? '#1A2233' : '#F4F7FB';
  const captionText = `${ALGORITHM_LABELS[experiment.algorithm]} · ${paramsSummary(experiment.params)} · dataset ${dataset.checksum.slice(0, 10)} · LatentScope ${experiment.appVersion}`;
  const options: FigureOptions = {
    width,
    height,
    background,
    foreground,
    title,
    subtitle: '',
    xLabel,
    yLabel,
    showAxes: axes,
    showGrid: grid,
    legend: legend ? 'right' : 'none',
    fontSize,
    pointSize,
    opacity: visuals.opacity,
    shapes: visuals.shapeEncoding,
    highlightSelection: highlight,
    caption: caption ? captionText : null,
    viewport: viewportMode === 'current' ? (mainCanvas.current?.viewport2D() ?? null) : null,
  };
  const stops = SEQUENTIAL_PALETTES[visuals.sequentialPalette].stops;
  const selectionSet = useMemo(() => new Set(selection), [selection]);
  const pointCount = experiment.coords.length / experiment.outputDims;

  const preview = useMemo(() => {
    if (is3d || !mapping || pointCount > 15000) return null;
    const svg = renderFigureSvg(
      {
        coords: experiment.coords,
        rowIndices: experiment.rowIndices,
        mapping,
        hidden,
        selection: selectionSet,
      },
      options,
      {},
      stops,
    );
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [is3d, mapping, hidden, selectionSet, experiment, JSON.stringify(options), stops, pointCount]);

  const exportFigure = async () => {
    if (!mapping) return;
    setError(null);
    setBusy(true);
    const meta = figureMetadata(experiment);
    const base = safeFileName(`${dataset.name}_${experiment.algorithm}_${experiment.outputDims}d`);
    try {
      if (is3d) {
        const capture = mainCanvas.current?.capture(scale);
        if (!capture)
          throw new Error(
            'The 3D view is not available for capture. Keep the explorer canvas visible and try again.',
          );
        const composed = compose3dPng(
          capture,
          mapping,
          {
            background,
            foreground,
            title,
            subtitle: '',
            legend: legend ? 'right' : 'none',
            fontSize,
            shapes: visuals.shapeEncoding,
            caption: caption ? captionText : null,
          },
          stops,
        );
        downloadBlob(await canvasToPngWithMetadata(composed, meta), `${base}.png`);
      } else if (format === 'svg') {
        const svg = renderFigureSvg(
          {
            coords: experiment.coords,
            rowIndices: experiment.rowIndices,
            mapping,
            hidden,
            selection: selectionSet,
          },
          options,
          meta,
          stops,
        );
        downloadText(svg, `${base}.svg`, 'image/svg+xml');
      } else {
        const canvas = renderFigurePng(
          {
            coords: experiment.coords,
            rowIndices: experiment.rowIndices,
            mapping,
            hidden,
            selection: selectionSet,
          },
          options,
          scale,
          stops,
        );
        downloadBlob(await canvasToPngWithMetadata(canvas, meta), `${base}.png`);
      }
      downloadText(JSON.stringify(meta, null, 2), `${base}.metadata.json`, 'application/json');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-3">
        <Segmented
          ariaLabel="Figure format"
          value={is3d ? 'png' : format}
          onChange={setFormat}
          options={[
            {
              value: 'svg',
              label: 'SVG (vector)',
              disabled: is3d,
              title: is3d ? 'Perspective 3D renderings have no faithful vector form' : undefined,
            },
            { value: 'png', label: 'PNG (raster)' },
          ]}
        />
        {is3d && (
          <Callout tone="info">
            3D views are exported as high-resolution raster images of the current camera view. LatentScope
            does not produce vector output for WebGL scenes.
          </Callout>
        )}
        <label className="block text-xs text-muted">
          Title
          <TextInput className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {!is3d && (
          <div className="grid grid-cols-2 gap-2.5">
            <NumberField
              label="Width (px)"
              value={width}
              integer
              min={200}
              max={6000}
              onChange={(v) => setWidth(v ?? 1200)}
            />
            <NumberField
              label="Height (px)"
              value={height}
              integer
              min={200}
              max={6000}
              onChange={(v) => setHeight(v ?? 900)}
            />
            <label className="block text-xs text-muted">
              X-axis title
              <TextInput className="mt-1" value={xLabel} onChange={(e) => setXLabel(e.target.value)} />
            </label>
            <label className="block text-xs text-muted">
              Y-axis title
              <TextInput className="mt-1" value={yLabel} onChange={(e) => setYLabel(e.target.value)} />
            </label>
            <NumberField
              label="Point size"
              value={pointSize}
              min={0.5}
              max={30}
              step={0.5}
              onChange={(v) => setPointSize(v ?? 4)}
            />
            <Select
              label="View"
              value={viewportMode}
              onChange={(v) => setViewportMode(v as 'all' | 'current')}
              options={[
                { value: 'all', label: 'All visible points' },
                { value: 'current', label: 'Current zoom' },
              ]}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-2.5">
          <NumberField
            label="Font size"
            value={fontSize}
            integer
            min={8}
            max={48}
            onChange={(v) => setFontSize(v ?? 16)}
          />
          {(format === 'png' || is3d) && (
            <Select
              label="Resolution"
              value={String(scale)}
              onChange={(v) => setScale(Number(v))}
              options={[1, 2, 3, 4].map((s) => ({
                value: String(s),
                label: `${s}× ${is3d ? 'screen' : `(${width * s} × ${height * s})`}`,
              }))}
            />
          )}
          <Select
            label="Background"
            value={bg}
            onChange={(v) => setBg(v as typeof bg)}
            options={[
              { value: 'white', label: 'White' },
              { value: 'current', label: 'Current canvas' },
              { value: 'transparent', label: 'Transparent' },
            ]}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Checkbox label="Legend" checked={legend} onChange={setLegend} />
          {!is3d && <Checkbox label="Axes and ticks" checked={axes} onChange={setAxes} />}
          {!is3d && <Checkbox label="Grid" checked={grid} onChange={setGrid} />}
          <Checkbox label="Reproducibility caption" checked={caption} onChange={setCaption} />
          {!is3d && (
            <Checkbox
              label="Highlight selection"
              checked={highlight}
              onChange={setHighlight}
              disabled={selection.length === 0}
            />
          )}
        </div>
        <p className="text-2xs leading-relaxed text-subtle">
          Colours, palette and opacity follow the explorer’s current settings. A JSON sidecar with the full
          configuration is downloaded alongside the figure; PNG files also embed it as an iTXt chunk and SVG
          files in a &lt;metadata&gt; element.
        </p>
        {error && <Callout tone="danger">{error}</Callout>}
        <Button
          variant="primary"
          className="w-full"
          loading={busy}
          icon={<ImageDown className="size-4" />}
          onClick={() => void exportFigure()}
        >
          Export {is3d ? 'PNG' : format.toUpperCase()}
        </Button>
      </div>
      <div className="min-w-0">
        <p className="mb-2 text-xs font-medium text-muted">Preview</p>
        {preview ? (
          <img
            src={preview}
            alt="Figure preview"
            className="w-full rounded-lg border border-line"
            style={{
              aspectRatio: `${width} / ${height}`,
              background:
                bg === 'transparent'
                  ? 'repeating-conic-gradient(#1c2434 0 25%, #151b29 0 50%) 50% / 16px 16px'
                  : undefined,
            }}
          />
        ) : (
          <div className="grid aspect-[4/3] place-items-center rounded-lg border border-dashed border-line p-6 text-center text-xs text-subtle">
            {is3d
              ? 'The 3D export captures the explorer canvas exactly as currently shown, at the chosen resolution.'
              : `Live preview is disabled above 15 000 points (${pointCount.toLocaleString()} here); the export itself is unaffected.`}
          </div>
        )}
      </div>
    </div>
  );
}

function DataTab({ dataset, experiment }: { dataset: Dataset; experiment: Experiment }) {
  const selection = useViewStore((s) => s.selection);
  const [onlySelected, setOnlySelected] = useState(false);
  const [columns, setColumns] = useState<string[]>(
    dataset.columns.filter((c) => c.role === 'label' || c.role === 'cluster').map((c) => c.name),
  );
  const options = { rows: onlySelected ? selection : null, metadataColumns: columns };
  const base = safeFileName(`${dataset.name}_${experiment.algorithm}_${experiment.outputDims}d_coordinates`);
  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted">
        Columns:{' '}
        <span className="num text-fg">sample_id, component_1 … component_{experiment.outputDims}</span>, then
        the selected metadata. Sample identifiers are preserved;{' '}
        {experiment.rowIndices
          ? `only the ${experiment.rowIndices.length} subsampled observations have coordinates.`
          : 'every observation is included.'}
      </p>
      <Checkbox
        label={`Selected observations only (${selection.length})`}
        checked={onlySelected}
        disabled={selection.length === 0}
        onChange={setOnlySelected}
      />
      {dataset.columns.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Metadata columns to include</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {dataset.columns.map((c) => (
              <Checkbox
                key={c.name}
                label={c.name}
                description={c.role}
                checked={columns.includes(c.name)}
                onChange={(v) => setColumns((cs) => (v ? [...cs, c.name] : cs.filter((x) => x !== c.name)))}
              />
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          icon={<FileSpreadsheet className="size-4" />}
          onClick={() =>
            downloadText(coordinatesCsv(dataset, experiment, options), `${base}.csv`, 'text/csv')
          }
        >
          Download CSV
        </Button>
        <Button
          variant="secondary"
          icon={<FileJson className="size-4" />}
          onClick={() =>
            downloadText(
              coordinatesJson(dataset, experiment, options, figureMetadata(experiment)),
              `${base}.json`,
              'application/json',
            )
          }
        >
          Download JSON
        </Button>
      </div>
    </div>
  );
}

function SessionTab({
  dataset,
  experiment,
  onDone,
}: {
  dataset: Dataset;
  experiment: Experiment;
  onDone: () => void;
}) {
  const [embed, setEmbed] = useState(false);
  const view = useViewStore();
  const estimated = embed ? dataset.n * dataset.d * 9 : experiment.coords.length * 10;
  const exportSession = () => {
    const session = buildSession(
      experiment,
      dataset,
      {
        visuals: view.visuals,
        colorBy: view.colorBy,
        hidden: view.hidden,
        selection: { ids: view.selection.map((r) => dataset.ids[r]!) },
        camera: mainCanvas.current?.getCamera() ?? null,
      },
      embed,
      dataset.columns.map((c) => c.name),
    );
    downloadText(
      JSON.stringify(session),
      `${safeFileName(`${dataset.name}_${experiment.algorithm}_session`)}.json`,
      'application/json',
    );
  };
  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted">
        A session file contains the schema version, dataset reference (name, shape and SHA-256 checksum),
        algorithm configuration and seed, projected coordinates, metrics, visual settings, selection and
        camera. Loading it later reproduces this view exactly.
      </p>
      <Checkbox
        label="Embed the dataset’s raw values and metadata"
        description="Makes the file self-contained, but anyone you share it with receives your data."
        checked={embed}
        onChange={setEmbed}
      />
      {embed && (
        <Callout tone="warning" title="This session will contain raw dataset values">
          {dataset.n.toLocaleString()} × {dataset.d.toLocaleString()} feature values and all metadata columns
          will be written into the file. Only share it with people allowed to see this data.
        </Callout>
      )}
      <p className="num text-2xs text-subtle">Approximate size: {formatBytes(estimated)}</p>
      <Button variant="primary" icon={<Save className="size-4" />} onClick={exportSession}>
        Download session
      </Button>
      <hr className="border-line" />
      <SessionImport onDone={onDone} />
    </div>
  );
}

export function SessionImport({ onDone }: { onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted">Load a session file</p>
      <p className="text-2xs text-subtle">
        The file is validated (schema, shapes, checksum) before anything is restored.
      </p>
      <Button
        variant="secondary"
        icon={<Upload className="size-4" />}
        loading={busy}
        onClick={() => inputRef.current?.click()}
      >
        Choose session file
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        aria-label="Choose a session file"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setError(null);
          setBusy(true);
          try {
            const session = validateSession(JSON.parse(await file.text()));
            await restoreSession(session, file.name);
            navigate('/explore');
            onDone();
          } catch (err) {
            setError(err instanceof SyntaxError ? 'The file is not valid JSON.' : errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      />
      {error && <Callout tone="danger">{error}</Callout>}
    </div>
  );
}
