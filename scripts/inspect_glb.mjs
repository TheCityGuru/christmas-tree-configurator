// Raw GLB inspector — no deps. Reads the JSON chunk directly.
import { readFileSync } from 'fs';

const path = process.argv[2];
const buf = readFileSync(path);

// GLB header: magic(4) + version(4) + length(4), then chunks
const magic = buf.readUInt32LE(0);
if (magic !== 0x46546C67) { // "glTF"
  console.error('Not a binary GLB (magic bytes not glTF)');
  process.exit(1);
}
const version = buf.readUInt32LE(4);
console.log(`GLB v${version}, total ${buf.readUInt32LE(8)} bytes`);

// First chunk = JSON
let off = 12;
const chunkLen = buf.readUInt32LE(off);
const chunkType = buf.readUInt32LE(off + 4);
if (chunkType !== 0x4E4F534A) { // "JSON"
  console.error('First chunk is not JSON');
  process.exit(1);
}
const jsonStr = buf.subarray(off + 8, off + 8 + chunkLen).toString('utf8');
const gltf = JSON.parse(jsonStr);

console.log(`\n=== ${path} ===`);
console.log(`Scenes: ${(gltf.scenes || []).length}`);
console.log(`Nodes: ${(gltf.nodes || []).length}`);
console.log(`Meshes: ${(gltf.meshes || []).length}`);
console.log(`Cameras: ${(gltf.cameras || []).length}`);
console.log(`Animations: ${(gltf.animations || []).length}`);
console.log(`Extensions used: ${(gltf.extensionsUsed || []).join(', ') || 'none'}`);

if (gltf.cameras && gltf.cameras.length > 0) {
  console.log('\n!!! Cameras defined in GLB:');
  gltf.cameras.forEach((c, i) => console.log(`  [${i}] ${c.name || '(unnamed)'}  type=${c.type}`));
}

// Top-level nodes per scene
console.log('\n--- Top-level nodes ---');
for (const scene of (gltf.scenes || [])) {
  console.log(`Scene "${scene.name || '(unnamed)'}":`);
  for (const nodeIdx of (scene.nodes || [])) {
    const n = gltf.nodes[nodeIdx];
    const t = n.translation || [0, 0, 0];
    const s = n.scale || [1, 1, 1];
    const camIdx = n.camera !== undefined ? ` [CAMERA idx=${n.camera}]` : '';
    const meshIdx = n.mesh !== undefined ? ` [mesh idx=${n.mesh}]` : '';
    console.log(`  [${nodeIdx}] ${n.name || '(unnamed)'}${camIdx}${meshIdx}  t=(${t.map(x => x.toFixed(3)).join(', ')})  s=(${s.map(x => x.toFixed(3)).join(', ')})`);
  }
}

// Any nodes with a camera attached
console.log('\n--- Nodes carrying cameras ---');
let camNodes = 0;
gltf.nodes.forEach((n, i) => {
  if (n.camera !== undefined) {
    camNodes++;
    const t = n.translation || [0, 0, 0];
    console.log(`  [${i}] ${n.name || '(unnamed)'}  camera=${n.camera}  t=(${t.map(x => x.toFixed(3)).join(', ')})`);
  }
});
if (camNodes === 0) console.log('  (none)');

// Nodes with unusually large translations
console.log('\n--- Nodes with large translations (|t| > 3m) ---');
let anomalous = 0;
gltf.nodes.forEach((n, i) => {
  const t = n.translation || [0, 0, 0];
  const mag = Math.hypot(t[0], t[1], t[2]);
  if (mag > 3) {
    anomalous++;
    if (anomalous <= 15) console.log(`  [${i}] ${n.name || '(unnamed)'}  |t|=${mag.toFixed(2)}m  t=(${t.map(x => x.toFixed(2)).join(', ')})`);
  }
});
console.log(`  Total: ${anomalous}`);

// EXT_mesh_gpu_instancing usage — where and how many instances?
console.log('\n--- EXT_mesh_gpu_instancing nodes ---');
let gnCount = 0;
gltf.nodes.forEach((n, i) => {
  const ext = n.extensions?.EXT_mesh_gpu_instancing;
  if (ext) {
    gnCount++;
    const t = n.translation || [0, 0, 0];
    const attrs = Object.keys(ext.attributes || {});
    // Get instance count from a translation accessor if available
    let instCount = '?';
    const trAcc = ext.attributes?.TRANSLATION;
    if (trAcc !== undefined && gltf.accessors?.[trAcc]) {
      instCount = gltf.accessors[trAcc].count;
    }
    console.log(`  [${i}] ${n.name || '(unnamed)'}  instances=${instCount}  attrs=[${attrs.join(',')}]  node.t=(${t.map(x => x.toFixed(3)).join(', ')})`);
  }
});
if (gnCount === 0) console.log('  (none)');

