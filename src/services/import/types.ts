import type { ColumnKind, ColumnRole, ImportFormat, MetadataColumn } from '@/types/dataset';
import type { NpyArray } from './npy';

export type CellValue = string | number | null;

/** First rows of a delimited or JSON table, used to configure the import. */
export interface TablePreview {
  kind: 'table';
  format: Extract<ImportFormat, 'csv' | 'tsv' | 'json'>;
  fileName: string;
  sizeBytes: number;
  hasHeader: boolean;
  columns: string[];
  rows: CellValue[][];
  /** Inferred from the preview rows only; the full import re-validates every cell. */
  inferred: ColumnInference[];
  /** Total rows when known (JSON); null for streamed CSV until the full pass. */
  totalRows: number | null;
  warnings: string[];
}

export interface ColumnInference {
  name: string;
  numeric: boolean;
  distinct: number;
  missing: number;
  suggestedRole: ColumnRole | 'feature' | 'id' | 'ignore';
  suggestedKind: ColumnKind;
}

export interface ArrayPreview {
  kind: 'arrays';
  format: Extract<ImportFormat, 'npy' | 'npz'>;
  fileName: string;
  sizeBytes: number;
  arrays: { name: string; array: NpyArray | null; error: string | null }[];
  warnings: string[];
}

export type ImportPreview = TablePreview | ArrayPreview;

export type ColumnAssignment = 'feature' | 'id' | 'ignore' | ColumnRole;

export interface TableMapping {
  hasHeader: boolean;
  assignments: Record<string, ColumnAssignment>;
  kinds: Record<string, ColumnKind>;
}

export interface ArrayMapping {
  embedding: string;
  /** Flatten dimensions after the first (e.g. N × 8 × 8 images to N × 64). */
  flattenTrailing: boolean;
  /** 1-D arrays of length N used as metadata columns, with their roles. */
  metadata: Record<string, ColumnRole | 'id' | 'ignore'>;
}

export interface CellIssue {
  row: number;
  column: string;
  value: string;
  kind: 'missing' | 'non-numeric' | 'infinite' | 'out-of-range';
}

export interface ExtractedData {
  n: number;
  d: number;
  /** Row-major; may contain NaN (missing / non-numeric) and ±Infinity. */
  values: Float64Array;
  featureNames: string[];
  ids: string[] | null;
  columns: MetadataColumn[];
  issues: {
    missing: number;
    nonNumeric: number;
    infinite: number;
    outOfRange: number;
    rowsAffected: number;
    examples: CellIssue[];
  };
  warnings: string[];
}
