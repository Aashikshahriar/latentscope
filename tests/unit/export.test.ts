import { describe, expect, it } from 'vitest';
import { coordinatesCsv, csvField } from '@/services/export/csv';
import { addPngTextChunk, crc32 } from '@/services/export/png';
import {
  buildSession,
  validateSession,
  datasetFromSession,
  SessionValidationError,
} from '@/services/export/session';
import { decodeShareConfig, encodeShareConfig, type ShareConfig } from '@/services/experiments/share';
import { renderFigureSvg } from '@/services/export/figure';
import { computeColorMapping } from '@/visualization/common/colorMapping';
import { DEFAULT_VISUALS } from '@/stores/viewStore';
import { datasetChecksum } from '@/utils/checksum';
import type { Dataset } from '@/types/dataset';
import type { Experiment } from '@/types/experiment';

async function fixture(): Promise<{ dataset: Dataset; experiment: Experiment }> {
  const values = Float32Array.from([1, 2, 3, 4, 5, 6]);
  const ids = ['s1', 's,2', 's"3'];
  const dataset: Dataset = {
    id: 'ds',
    name: 'Fixture',
    source: { type: 'upload', fileName: 'f.csv', format: 'csv' },
    n: 3,
    d: 2,
    values,
    featureNames: ['a', 'b'],
    ids,
    columns: [{ name: 'label', role: 'label', kind: 'categorical', values: ['x', 'y', null] }],
    checksum: await datasetChecksum(values, 3, 2, ids),
    createdAt: '2026-01-01T00:00:00.000Z',
    importNotes: [],
  };
  const experiment: Experiment = {
    id: 'e',
    name: 'PCA',
    datasetId: 'ds',
    datasetName: 'Fixture',
    datasetChecksum: dataset.checksum,
    algorithm: 'pca',
    implementation: { name: 'latentscope-pca', version: '1.0.0' },
    params: { algorithm: 'pca', solver: 'auto', seed: 0 },
    preprocessing: { center: true, standardize: false, l2Normalize: false, subsample: null },
    outputDims: 2,
    rowIndices: null,
    coords: Float32Array.from([0.5, -1, 0.125, 2, 3, 0]),
    diagnostics: {
      kind: 'pca',
      method: 'svd',
      exact: true,
      explainedVariance: [1, 0],
      explainedVarianceRatio: [1, 0],
      totalVariance: 1,
      components: [[1, 0]],
      componentCount: 1,
      rank: 1,
      warnings: [],
    },
    metrics: null,
    runtimeMs: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    appVersion: '1.0.0',
    environment: 'test',
  };
  return { dataset, experiment };
}

describe('CSV export', () => {
  it('quotes fields per RFC 4180', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField(null)).toBe('');
  });
  it('writes sample ids, components and metadata; 2D omits component_3', async () => {
    const { dataset, experiment } = await fixture();
    const csv = coordinatesCsv(dataset, experiment, { metadataColumns: ['label'] });
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('sample_id,component_1,component_2,label');
    expect(lines[1]).toBe('s1,0.5,-1,x');
    expect(lines[2]).toBe('"s,2",0.125,2,y');
    expect(lines[3]).toBe('"s""3",3,0,');
    expect(
      coordinatesCsv(dataset, experiment, { metadataColumns: [], rows: [2] })
        .trim()
        .split('\n'),
    ).toHaveLength(2);
  });
});

describe('PNG metadata', () => {
  it('computes the standard CRC-32 and inserts a valid iTXt chunk after IHDR', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    // Minimal 1×1 PNG.
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      ),
      (c) => c.charCodeAt(0),
    );
    const out = addPngTextChunk(png, 'LatentScope', '{"a":1}');
    const view = new DataView(out.buffer);
    const ihdrEnd = 8 + 12 + 13;
    expect(new TextDecoder().decode(out.subarray(ihdrEnd + 4, ihdrEnd + 8))).toBe('iTXt');
    const length = view.getUint32(ihdrEnd);
    const body = out.subarray(ihdrEnd + 8, ihdrEnd + 8 + length);
    expect(new TextDecoder().decode(body)).toContain('{"a":1}');
    const crc = view.getUint32(ihdrEnd + 8 + length);
    expect(crc).toBe(crc32(out.subarray(ihdrEnd + 4, ihdrEnd + 8 + length)));
    expect(out.length).toBe(png.length + 12 + length);
  });
});

describe('session files', () => {
  const view = {
    visuals: DEFAULT_VISUALS,
    colorBy: { type: 'none' as const },
    hidden: [],
    selection: { ids: ['s1'] },
    camera: null,
  };
  it('round-trips through JSON and validates structure', async () => {
    const { dataset, experiment } = await fixture();
    const session = JSON.parse(JSON.stringify(buildSession(experiment, dataset, view, false, [])));
    expect(validateSession(session).experiment.coordinates).toHaveLength(6);
    expect(session.dataset.embedded).toBeUndefined();
  });
  it('rejects inconsistent or foreign files', async () => {
    const { dataset, experiment } = await fixture();
    const session = JSON.parse(JSON.stringify(buildSession(experiment, dataset, view, false, [])));
    expect(() => validateSession({ ...session, schema: 'other' })).toThrow(SessionValidationError);
    expect(() =>
      validateSession({ ...session, experiment: { ...session.experiment, coordinates: [1, 2] } }),
    ).toThrow(/does not match/);
    expect(() =>
      validateSession({ ...session, experiment: { ...session.experiment, rowIndices: [0, 9, 1] } }),
    ).toThrow(/out of range/);
    expect(() => validateSession({ ...session, schemaVersion: 99 })).toThrow(/Unsupported/);
  });
  it('embeds raw data only on request and verifies its checksum on restore', async () => {
    const { dataset, experiment } = await fixture();
    const session = validateSession(
      JSON.parse(JSON.stringify(buildSession(experiment, dataset, view, true, ['label']))),
    );
    const restored = await datasetFromSession(session, 's.json');
    expect(restored.checksum).toBe(dataset.checksum);
    session.dataset.embedded!.values[0] = 99;
    await expect(datasetFromSession(session, 's.json')).rejects.toThrow(/checksum/);
  });
});

describe('share links', () => {
  it('encode configuration only and decode losslessly', () => {
    const config: ShareConfig = {
      v: 1,
      dataset: { kind: 'checksum', checksum: 'a'.repeat(64), name: 'mine', n: 10, d: 3 },
      algorithm: 'umap',
      params: {
        algorithm: 'umap',
        nNeighbors: 15,
        minDist: 0.1,
        spread: 1,
        metric: 'cosine',
        nEpochs: 0,
        knn: 'auto',
        seed: 4,
      },
      preprocessing: { center: true, standardize: false, l2Normalize: true, subsample: null },
      dims: 3,
    };
    const encoded = encodeShareConfig(config);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeShareConfig(encoded)).toEqual(config);
    expect(() => decodeShareConfig('garbage')).toThrow(/damaged/);
  });
});

describe('SVG figure', () => {
  it('renders one vector mark per visible point with embedded metadata', async () => {
    const { dataset, experiment } = await fixture();
    const mapping = computeColorMapping(
      dataset,
      { type: 'column', name: 'label' },
      [],
      'okabe-ito',
      'viridis',
    );
    const hidden = Uint8Array.from([0, 0, 1]);
    const svg = renderFigureSvg(
      { coords: experiment.coords, rowIndices: null, mapping, hidden, selection: new Set() },
      {
        width: 400,
        height: 300,
        background: '#fff',
        foreground: '#111',
        title: 'T',
        subtitle: '',
        xLabel: 'PC 1',
        yLabel: 'PC 2',
        showAxes: true,
        showGrid: false,
        legend: 'right',
        fontSize: 12,
        pointSize: 5,
        opacity: 1,
        shapes: false,
        highlightSelection: false,
        caption: null,
        viewport: null,
      },
      { algorithm: 'pca' },
      ['#000', '#fff'],
    );
    const plotMarks = svg.split('<g clip-path="url(#plot)"')[1]!.split('</g>')[0]!;
    expect(plotMarks.match(/<circle/g)).toHaveLength(2);
    expect(svg).toContain('<metadata><![CDATA[{"algorithm":"pca"}]]></metadata>');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  });
});
