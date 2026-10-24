import type { ImportFormat } from '@/types/dataset';
import { parseNpy } from './npy';
import { parseNpz } from './npz';
import { extractDelimited, extractJson, previewDelimited, previewJson, type JsonTable } from './table';
import { extractArrays } from './arrays';
import type { ArrayMapping, ExtractedData, ImportPreview, TableMapping } from './types';

export const SUPPORTED_EXTENSIONS = ['.csv', '.tsv', '.txt', '.json', '.npy', '.npz'] as const;
export const MAX_FILE_BYTES = 1024 * 1024 * 1024; // 1 GB hard limit

export function detectFormat(fileName: string): ImportFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.tsv') || lower.endsWith('.tab')) return 'tsv';
  if (lower.endsWith('.txt')) return 'csv'; // delimiter is auto-detected
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.npy')) return 'npy';
  if (lower.endsWith('.npz')) return 'npz';
  return null;
}

/** Holds whatever the extraction step needs after the preview (file handle or parsed JSON). */
export interface ImportSession {
  file: File;
  format: ImportFormat;
  preview: ImportPreview;
  json?: JsonTable;
}

export async function openImport(file: File, hasHeader?: boolean): Promise<ImportSession> {
  const format = detectFormat(file.name);
  if (!format) {
    throw new Error(`Unsupported file type "${file.name}". Supported: CSV, TSV, JSON, NPY and NPZ.`);
  }
  if (file.size === 0) throw new Error('The file is empty.');
  if (file.size > MAX_FILE_BYTES)
    throw new Error('Files larger than 1 GB cannot be processed in the browser.');
  if (format === 'csv' || format === 'tsv') {
    return { file, format, preview: await previewDelimited(file, file.name, format, hasHeader) };
  }
  if (format === 'json') {
    const { preview, table } = previewJson(await file.text(), file.name, file.size);
    return { file, format, preview, json: table };
  }
  const buffer = new Uint8Array(await file.arrayBuffer());
  if (format === 'npy') {
    const array = parseNpy(buffer);
    const name = file.name.replace(/\.npy$/i, '');
    return {
      file,
      format,
      preview: {
        kind: 'arrays',
        format,
        fileName: file.name,
        sizeBytes: file.size,
        arrays: [{ name, array, error: null }],
        warnings: [],
      },
    };
  }
  return {
    file,
    format,
    preview: {
      kind: 'arrays',
      format,
      fileName: file.name,
      sizeBytes: file.size,
      arrays: parseNpz(buffer),
      warnings: [],
    },
  };
}

export async function extractImport(
  session: ImportSession,
  mapping: TableMapping | ArrayMapping,
): Promise<ExtractedData> {
  const { preview } = session;
  if (preview.kind === 'arrays') return extractArrays(preview, mapping as ArrayMapping);
  const tableMapping = mapping as TableMapping;
  if (session.format === 'json') return extractJson(session.json!, tableMapping);
  return extractDelimited(session.file, session.format as 'csv' | 'tsv', preview.columns, tableMapping);
}
