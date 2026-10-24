// Builds the pretrained sentence-embedding demonstrations in public/datasets/.
//
//   npm install --no-save @huggingface/transformers
//   node scripts/build-text-embeddings.mjs
//
// The corpus (scripts/text-corpus.json) was written for this project and is released under CC0.
// Each sentence is embedded by two pretrained models so the same observations can be compared
// across representations:
//   - sentence-transformers/all-MiniLM-L6-v2 (Apache-2.0), ONNX export Xenova/all-MiniLM-L6-v2
//   - BAAI/bge-small-en-v1.5 (MIT), ONNX export Xenova/bge-small-en-v1.5
// MiniLM uses mean pooling; BGE uses CLS pooling as recommended by its authors. Both outputs are
// L2-normalised and stored as little-endian float32 .npy files.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public', 'datasets');
mkdirSync(out, { recursive: true });
env.allowLocalModels = false;

const corpus = JSON.parse(readFileSync(resolve(root, 'scripts', 'text-corpus.json'), 'utf8'));
const rows = [];
for (const [topic, sentences] of Object.entries(corpus.topics)) {
  sentences.forEach((text, i) =>
    rows.push({ id: `${topic}_${String(i + 1).padStart(2, '0')}`, topic, text }),
  );
}

function npy(float32, n, d) {
  const header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${n}, ${d}), }`;
  const magicLength = 10;
  let padded = header;
  while ((magicLength + padded.length + 1) % 64 !== 0) padded += ' ';
  padded += '\n';
  const headerBytes = new TextEncoder().encode(padded);
  const buf = new Uint8Array(magicLength + headerBytes.length + float32.byteLength);
  buf.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0], 0);
  new DataView(buf.buffer).setUint16(8, headerBytes.length, true);
  buf.set(headerBytes, magicLength);
  buf.set(new Uint8Array(float32.buffer), magicLength + headerBytes.length);
  return buf;
}

const models = [
  {
    key: 'text-minilm',
    model: 'Xenova/all-MiniLM-L6-v2',
    pooling: 'mean',
    source: 'sentence-transformers/all-MiniLM-L6-v2',
    license: 'Apache-2.0',
  },
  {
    key: 'text-bge',
    model: 'Xenova/bge-small-en-v1.5',
    pooling: 'cls',
    source: 'BAAI/bge-small-en-v1.5',
    license: 'MIT',
  },
];

const transformersVersion = JSON.parse(
  readFileSync(resolve(root, 'node_modules', '@huggingface', 'transformers', 'package.json'), 'utf8'),
).version;
const manifest = { corpusLicense: corpus.license, rows, models: [] };
for (const spec of models) {
  const extractor = await pipeline('feature-extraction', spec.model, { dtype: 'fp32' });
  const output = await extractor(
    rows.map((r) => r.text),
    { pooling: spec.pooling, normalize: true },
  );
  const [n, d] = output.dims;
  const data = Float32Array.from(output.data);
  writeFileSync(resolve(out, `${spec.key}.npy`), npy(data, n, d));
  manifest.models.push({ ...spec, n, d, transformersJs: transformersVersion });
  console.log(`wrote ${spec.key}.npy (${n} × ${d})`);
}
writeFileSync(resolve(out, 'text-metadata.json'), JSON.stringify(manifest));
console.log('wrote text-metadata.json');
