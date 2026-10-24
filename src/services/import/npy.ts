/**
 * Parser for NumPy's .npy format (versions 1.0, 2.0 and 3.0).
 * https://numpy.org/doc/stable/reference/generated/numpy.lib.format.html
 *
 * Supported dtypes: little/big-endian float16/32/64, signed and unsigned 8–64-bit integers,
 * booleans, fixed-width unicode ('<U') and byte strings ('S'). Object arrays (which require
 * unpickling and could execute code in Python) are rejected.
 */

export type NpyData = { kind: 'numeric'; values: Float64Array } | { kind: 'string'; values: string[] };

export interface NpyArray {
  dtype: string;
  shape: number[];
  fortranOrder: boolean;
  data: NpyData;
}

export class NpyFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NpyFormatError';
  }
}

const MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]; // \x93NUMPY

interface Header {
  descr: string;
  fortran_order: boolean;
  shape: number[];
}

/** Parses the Python-literal header dict, e.g. {'descr': '<f4', 'fortran_order': False, 'shape': (3, 2), }. */
function parseHeader(text: string): Header {
  const descr = /'descr'\s*:\s*'([^']+)'/.exec(text)?.[1];
  const fortran = /'fortran_order'\s*:\s*(True|False)/.exec(text)?.[1];
  const shapeText = /'shape'\s*:\s*\(([^)]*)\)/.exec(text)?.[1];
  if (/'descr'\s*:\s*\[/.test(text))
    throw new NpyFormatError('Structured (record) arrays are not supported; save a plain numeric matrix.');
  if (descr === undefined || fortran === undefined || shapeText === undefined) {
    throw new NpyFormatError('The .npy header is malformed (missing descr, fortran_order or shape).');
  }
  const shape = shapeText
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const v = Number(s.replace(/L$/, ''));
      if (!Number.isInteger(v) || v < 0) throw new NpyFormatError(`Invalid dimension "${s}" in .npy shape.`);
      return v;
    });
  return { descr, fortran_order: fortran === 'True', shape };
}

function float16ToNumber(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
  if (exp === 0x1f) return frac ? Number.NaN : sign * Infinity;
  return sign * 2 ** (exp - 15) * (1 + frac / 1024);
}

export function parseNpy(buffer: ArrayBuffer | Uint8Array): NpyArray {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 10 || MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new NpyFormatError('Not a NumPy .npy file (missing \\x93NUMPY magic bytes).');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const major = bytes[6]!;
  let headerLength: number;
  let offset: number;
  if (major === 1) {
    headerLength = view.getUint16(8, true);
    offset = 10;
  } else if (major === 2 || major === 3) {
    headerLength = view.getUint32(8, true);
    offset = 12;
  } else {
    throw new NpyFormatError(`Unsupported .npy format version ${major}.${bytes[7]}.`);
  }
  const decoder = new TextDecoder(major === 3 ? 'utf-8' : 'latin1');
  const header = parseHeader(decoder.decode(bytes.subarray(offset, offset + headerLength)));
  const dataOffset = offset + headerLength;
  const count = header.shape.reduce((a, b) => a * b, 1);
  const descr = header.descr;
  const match = /^([<>|=]?)([a-zA-Z])(\d*)$/.exec(descr);
  if (!match) throw new NpyFormatError(`Unsupported dtype "${descr}".`);
  const [, order, code, sizeText] = match;
  if (code === 'O') {
    throw new NpyFormatError(
      'Object arrays require pickle and are rejected for safety. Save with a numeric or string dtype.',
    );
  }
  const littleEndian = order !== '>';
  const size = Number(sizeText || '1');
  const itemBytes = code === 'U' ? size * 4 : size;
  if (dataOffset + count * itemBytes > bytes.length) {
    throw new NpyFormatError(`The file is truncated: expected ${count * itemBytes} data bytes.`);
  }

  let data: NpyData;
  if (code === 'U' || code === 'S') {
    const values: string[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const start = dataOffset + i * itemBytes;
      if (code === 'U') {
        let s = '';
        for (let c = 0; c < size; c++) {
          const cp = view.getUint32(start + c * 4, littleEndian);
          if (cp === 0) break;
          s += String.fromCodePoint(cp);
        }
        values[i] = s;
      } else {
        let end = start;
        while (end < start + size && bytes[end] !== 0) end++;
        values[i] = new TextDecoder('latin1').decode(bytes.subarray(start, end));
      }
    }
    data = { kind: 'string', values };
  } else {
    const values = new Float64Array(count);
    const read = numericReader(view, code!, size, littleEndian, descr);
    for (let i = 0; i < count; i++) values[i] = read(dataOffset + i * itemBytes);
    data = { kind: 'numeric', values };
  }

  if (header.fortran_order && header.shape.length > 1) data = toCOrder(data, header.shape);
  return { dtype: descr, shape: header.shape, fortranOrder: header.fortran_order, data };
}

function numericReader(
  view: DataView,
  code: string,
  size: number,
  le: boolean,
  descr: string,
): (offset: number) => number {
  switch (`${code}${size}`) {
    case 'f2':
      return (o) => float16ToNumber(view.getUint16(o, le));
    case 'f4':
      return (o) => view.getFloat32(o, le);
    case 'f8':
      return (o) => view.getFloat64(o, le);
    case 'i1':
      return (o) => view.getInt8(o);
    case 'i2':
      return (o) => view.getInt16(o, le);
    case 'i4':
      return (o) => view.getInt32(o, le);
    case 'i8':
      return (o) => Number(view.getBigInt64(o, le));
    case 'u1':
      return (o) => view.getUint8(o);
    case 'u2':
      return (o) => view.getUint16(o, le);
    case 'u4':
      return (o) => view.getUint32(o, le);
    case 'u8':
      return (o) => Number(view.getBigUint64(o, le));
    case 'b1':
      return (o) => view.getUint8(o);
    default:
      throw new NpyFormatError(
        `Unsupported dtype "${descr}" (complex and datetime arrays are not supported).`,
      );
  }
}

/** Converts column-major (Fortran) data to row-major. */
function toCOrder(data: NpyData, shape: number[]): NpyData {
  const count = shape.reduce((a, b) => a * b, 1);
  const rank = shape.length;
  const fStrides = new Array<number>(rank);
  const cStrides = new Array<number>(rank);
  fStrides[0] = 1;
  for (let r = 1; r < rank; r++) fStrides[r] = fStrides[r - 1]! * shape[r - 1]!;
  cStrides[rank - 1] = 1;
  for (let r = rank - 2; r >= 0; r--) cStrides[r] = cStrides[r + 1]! * shape[r + 1]!;
  const mapIndex = (c: number) => {
    let rem = c;
    let f = 0;
    for (let r = 0; r < rank; r++) {
      const idx = Math.floor(rem / cStrides[r]!);
      rem -= idx * cStrides[r]!;
      f += idx * fStrides[r]!;
    }
    return f;
  };
  if (data.kind === 'numeric') {
    const out = new Float64Array(count);
    for (let c = 0; c < count; c++) out[c] = data.values[mapIndex(c)]!;
    return { kind: 'numeric', values: out };
  }
  const out: string[] = new Array(count);
  for (let c = 0; c < count; c++) out[c] = data.values[mapIndex(c)]!;
  return { kind: 'string', values: out };
}
