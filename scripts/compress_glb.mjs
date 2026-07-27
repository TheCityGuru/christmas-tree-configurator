// Full GLB compressor: weld geometry, WebP textures, Meshopt geometry compression.
// Meshopt is used (not Draco) because the app's loader already registers
// MeshoptDecoder and meshoptimizer ships as a runtime dependency.
//
// Usage: node scripts/compress_glb.mjs <in.glb> [out.glb] [--max 1024] [--quality 80]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, textureCompress } from '@gltf-transform/functions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const getFlag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

const inPath = positional[0];
const outPath = positional[1] || inPath;
const maxSize = parseInt(getFlag('max', '1024'), 10);
const quality = parseInt(getFlag('quality', '80'), 10);
if (!inPath) {
  console.error('Usage: node scripts/compress_glb.mjs <in.glb> [out.glb] [--max N] [--quality N]');
  process.exit(1);
}

await MeshoptEncoder.ready;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(inPath);

await doc.transform(
  weld(),
  textureCompress({
    encoder: sharp,
    targetFormat: 'webp',
    quality,
    resize: [maxSize, maxSize],
    resizeFilter: 'lanczos3',
  }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);

await io.write(outPath, doc);
console.log(`wrote ${outPath} (webp max ${maxSize}px q${quality}, meshopt)`);
