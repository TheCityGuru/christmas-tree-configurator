# scripts/

One-off asset processing helpers. Not part of the runtime.

## `bake_gn_instances.mjs`

Bakes `EXT_mesh_gpu_instancing` (Blender Geometry Nodes output) into regular mesh nodes.

**Why it's needed:** Blender's Geometry Nodes exports as `EXT_mesh_gpu_instancing` in the GLB. Three.js's GLTFLoader parses this as `InstancedMesh`, but Scene.tsx's ornament placement code only reads `.geometry` (single instance) — losing the ~N per-curve/per-array positions. The user only sees ONE instance where there should be N.

**Fix:** Bake the per-instance transforms into real child mesh nodes at pre-computed positions. Result renders correctly with the existing placement pipeline.

**Usage:**
```bash
cd /tmp/glbinspect  # or wherever @gltf-transform is installed
node bake_gn_instances.mjs /path/to/input.glb /path/to/output.glb
```

Then swap `output.glb` into `public/models/`.

**Dependencies:**
```bash
npm install @gltf-transform/core @gltf-transform/extensions
```

**Symptoms that indicate you need this:**
- Ornament renders with only 1-2 sub-mesh instances instead of the expected pattern (chain, cluster, spiral, etc.)
- The connecting geometry (curves, wires) renders but the instanced element (beads, leaves) does not.
- Inspect with `raw_hierarchy.mjs`-style script: look for `EXT_mesh_gpu_instancing` in `root.listExtensionsUsed()` and on individual nodes.

**Related:** for a proper runtime fix (support GN instancing directly in Scene.tsx placement), see the open item in `project_christmas_tree.md`.
