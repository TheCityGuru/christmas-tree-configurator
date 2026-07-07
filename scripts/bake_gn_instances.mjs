import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshGPUInstancing } from '@gltf-transform/extensions';
import { instance } from '@gltf-transform/functions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();

// Manually walk instanced nodes and expand into regular child nodes.
for (const scene of root.listScenes()) {
  scene.traverse((node) => {
    const ext = node.getExtension('EXT_mesh_gpu_instancing');
    if (!ext) return;
    const mesh = node.getMesh();
    if (!mesh) return;

    const tAttr = ext.getAttribute('TRANSLATION');
    const rAttr = ext.getAttribute('ROTATION');
    const sAttr = ext.getAttribute('SCALE');
    const count = tAttr?.getCount() ?? rAttr?.getCount() ?? sAttr?.getCount() ?? 0;
    console.log(`Node "${node.getName()}" has ${count} instances`);

    // Create N child nodes, each with the instanced mesh + a per-instance transform.
    for (let i = 0; i < count; i++) {
      const child = doc.createNode(`${node.getName()}_inst_${i}`).setMesh(mesh);
      if (tAttr) {
        const t = new Float32Array(3);
        tAttr.getElement(i, t);
        child.setTranslation([t[0], t[1], t[2]]);
      }
      if (rAttr) {
        const r = new Float32Array(4);
        rAttr.getElement(i, r);
        child.setRotation([r[0], r[1], r[2], r[3]]);
      }
      if (sAttr) {
        const s = new Float32Array(3);
        sAttr.getElement(i, s);
        child.setScale([s[0], s[1], s[2]]);
      }
      node.addChild(child);
    }

    // Detach mesh + extension from the parent node — parent now just carries children.
    node.setMesh(null);
    node.setExtension('EXT_mesh_gpu_instancing', null);
  });
}

// Drop the extension from the doc's used list (no consumers now).
const extInst = doc.createExtension(EXTMeshGPUInstancing);
extInst.dispose();

await io.write(process.argv[3], doc);
console.log('Wrote', process.argv[3]);
