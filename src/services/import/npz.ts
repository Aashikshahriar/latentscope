import { unzipSync } from 'fflate';
import { NpyFormatError, parseNpy, type NpyArray } from './npy';

export interface NpzEntry {
  name: string;
  array: NpyArray | null;
  error: string | null;
}

/**
 * Reads a NumPy .npz archive (a ZIP of .npy files, stored or deflated). Entries that fail to
 * parse are reported individually instead of failing the whole archive, so a user can still pick
 * the embedding matrix when, for example, an object array is also present.
 */
export function parseNpz(buffer: ArrayBuffer | Uint8Array): NpzEntry[] {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    throw new NpyFormatError('Not an .npz archive (expected a ZIP file).');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (error) {
    throw new NpyFormatError(
      `Could not decompress the .npz archive: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const entries: NpzEntry[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (!path.endsWith('.npy')) continue;
    const name = path.replace(/\.npy$/, '');
    try {
      entries.push({ name, array: parseNpy(content), error: null });
    } catch (error) {
      entries.push({ name, array: null, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (entries.length === 0) throw new NpyFormatError('The archive contains no .npy arrays.');
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}
