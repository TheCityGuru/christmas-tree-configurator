// Texture compressor for ornament GLBs.
// Resizes textures to a max dimension and re-encodes them as WebP
// (matching the EXT_texture_webp pipeline used by the other ornament sets).
//
// Usage: node scripts/compress_textures.mjs <in.glb> [out.glb] [--max 1024] [--quality 80]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress } from '@gltf-transform/functions';
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
  console.error('Usage: node scripts/compress_textures.mjs <in.glb> [out.glb] [--max N] [--quality N]');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inPath);

await doc.transform(
  textureCompress({
    encoder: sharp,
    targetFormat: 'webp',
    quality,
    resize: [maxSize, maxSize],
    resizeFilter: 'lanczos3',
  }),
);

await io.write(outPath, doc);
console.log(`wrote ${outPath} (max ${maxSize}px, webp q${quality})`);
