// Uses three.js to actually load the GLB and compute per-mesh WORLD bboxes.
// Node needs a lightweight three environment; the project has three as a dep.
import * as THREE from '/home/jaewon/winterSketch/3D Christmas Tree Configurator_v5_work/node_modules/three/build/three.module.js';
import { GLTFLoader } from '/home/jaewon/winterSketch/3D Christmas Tree Configurator_v5_work/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { readFileSync } from 'fs';

const path = process.argv[2];
const buf = readFileSync(path);
const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const loader = new GLTFLoader();
loader.parse(arrayBuffer, '', (gltf) => {
  const model = gltf.scene;
  model.updateMatrixWorld(true);

  console.log(`\n=== ${path} ===`);
  const rows = [];
  model.traverse((child) => {
    if (!child.isMesh) return;
    if (!child.geometry) return;
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
    const worldBox = new THREE.Box3().copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
    rows.push({
      name: child.name,
      min_y: worldBox.min.y,
      max_y: worldBox.max.y,
      min_x: worldBox.min.x,
      max_x: worldBox.max.x,
    });
  });
  rows.sort((a, b) => a.min_y - b.min_y);
  console.log('\n--- Bottom 20 meshes by world min.y ---');
  console.log('name'.padEnd(30), 'min.y'.padStart(8), 'max.y'.padStart(8));
  rows.slice(0, 20).forEach((r) => {
    console.log(r.name.padEnd(30), r.min_y.toFixed(4).padStart(8), r.max_y.toFixed(4).padStart(8));
  });

  // Also show what box.min.y would be for the full model + for a PVC-excluded model
  const boxFull = new THREE.Box3().setFromObject(model);
  const boxNoPvc = new THREE.Box3();
  const tmp = new THREE.Box3();
  model.traverse((child) => {
    if (!child.isMesh) return;
    if (child.name.startsWith('PVC')) return;
    if (!child.geometry) return;
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
    tmp.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
    boxNoPvc.union(tmp);
  });
  console.log('\n--- Aggregate min.y ---');
  console.log(`Full model:      min.y = ${boxFull.min.y.toFixed(4)}`);
  console.log(`Excluding PVC*:  min.y = ${boxNoPvc.min.y.toFixed(4)}`);
}, (err) => console.error('parse error:', err));
