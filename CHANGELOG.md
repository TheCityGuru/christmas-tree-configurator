# Changelog

Running log of changes pushed to `main`. Newest at the top.
Format: each push = one dated section. Commit hash linked for diff drill-down.
For the v4 → v5 transition history, see `CHANGELOG_v4_to_v5.md`.

---

## 2026-07-14 (late) — Camera lock, env reparenting, tree recenter fix, bead ornament restored

### Camera pose locks to canonical initial view on every tree change

- User report: camera "shifted position" when switching trees (most visibly with sketchTree_v3_olive150).
- Root cause: OrbitControls persists its orbit-sphere state (theta / phi / radius) across renders. After orbiting Tree A, that state carried into Tree B, so the framing looked shifted even though `camera.position` and `controls.target` were unchanged.
- Fix: extracted `INITIAL_CAMERA_POSITION` (`-1.4, 0.55, 1.2`) and `INITIAL_ORBIT_TARGET` (`0, 0.70, 0`) as module-scope constants so setup and reset agree on one source of truth; added a `useEffect(_, [treeModelPath])` in Scene.tsx that snaps both back on every tree change, then calls `controls.update()` so the internal spherical state re-derives from the reset pose.
- Also raised the initial camera height by 5cm (`0.50 → 0.55`) and orbit target by 5cm (`0.65 → 0.70`) — coupled bumps keep the initial pitch angle unchanged.

### Env moved from `model` child to `scene` child + self-recentered

- Env.glb was `model.add(envModel)`, so it inherited the tree's recenter offset (`model.position.y = -box.min.y`). Larger trees → larger offset → env floor climbed above y=0 → OrbitControls floor clamp snapped the initial camera up on the sketchTree_v3 tree. That was the "camera shifts on this specific tree" symptom.
- Env is now loaded once at scene setup and attached directly to `scene`. `envBoxRef` — which drives the floor clamp — is now constant across tree swaps.
- Env.glb's Plane mesh is authored below local y=0. Under the old parent-of-model setup, `model.position.y` happened to lift env's floor up to coincide with the tree ground. Under the new setup, env was visually below world y=0 → tree "floated" above it. Fixed with `envModel.position.y = -envBoxLocal.min.y` — same recenter pattern applied to env so its floor sits at world y=0 by construction.

### Tree recenter now skips `PVC*` meshes + shared helper for both passes

- sketchTree_v3+ authors a `PVC` pipe that extends below the visible stand base (hidden structural pole). Old recenter used vanilla `Box3.setFromObject(model)`, so `box.min.y` = PVC's underground extent → recenter over-lifted the tree by ~36cm. Was hidden by env-following-model; became visible after the env reparent.
- Fixed with a module-scope helper `computeRecenterBox(model)` that walks meshes and skips any `startsWith('PVC')` mesh. Applied at BOTH recenter sites in the tree-load useEffect (initial recenter before quadrant instancing AND the post-cloning recenter that runs after node instancing) so they agree — earlier only the first was fixed and the second was undoing it.

### Shadow flicker fix — ground plane raised 1mm above env floor

- After env-to-scene reparenting + env self-recenter, both env's authored floor plane AND the dedicated `ShadowMaterial` ground plane sit at exactly `y=0`. Camera motion flipped the depth-test winner between the two coplanar surfaces → shadow flickered.
- Raised the shadow ground to `y=0.001` (1mm) — invisible to the eye, but a clean depth priority for the shadow-receiving plane over the env floor.

### Angelina 엔젤리나 bead — bead_string.glb → bead.glb (qty 15)

- `ORNAMENT_SET_1` gains `{ path: '/models/ornaments/angelina/bead.glb', qty: 15 }`.
- `beadStringActive` useMemo replaced with a `const beadStringActive = false;` so the legacy single-instance `bead_string.glb` renderer stays dormant. Prop wiring kept for cheap rollback if we ever want the chain-string look back.
- **Blender Geometry Nodes bug — same one 핑크루체 hit**: new `bead.glb` shipped with `EXT_mesh_gpu_instancing` on the `BézierCurve.003` node (20 GN-authored bead positions). Three.js placement code reads only `srcMesh.geometry` and drops per-instance transforms silently → single-sphere stubs instead of a bead cluster.
- Fixed by re-running `scripts/bake_gn_instances.mjs` on the file — extension expanded into 20 explicit child nodes, extension removed from used list. Node count 3 → 23, size 18.9 KB → 22.6 KB.
- **Material override exception**: appended `|| ornPath.endsWith('/ornaments/angelina/bead.glb')` to the `keepOriginal` gate at all 4 override sites in Scene.tsx (`1839, 2005, 2277, 2458`) so the bead's authored `KHR_materials_clearcoat` PBR renders as-shipped instead of getting swapped for the silver PBR override that every other angelina item gets.

### Diagnostic scripts kept in `scripts/`

- `scripts/inspect_glb.mjs` — raw-JSON GLB structure inspector (no deps). Prints scene/node/mesh/camera/animation/extension counts, top-level node positions, any camera-attached nodes, anomalous transforms, and any nodes carrying `EXT_mesh_gpu_instancing` with per-node instance counts. Used to catch the sketchTree_v3 PVC extension issue and the angelina bead GN extension.
- `scripts/inspect_bbox.mjs` — uses three.js to actually load a GLB and compute per-mesh world-space bboxes. Used to verify PVC-excluded `box.min.y` in v3.
- `scripts/bake_gn_instances.mjs` — the existing GN-instance baker (already documented from 핑크루체's incident) — now re-run on `bead.glb`.

### Files
- `src/app/App.tsx` — `ORNAMENT_SET_1` gains bead entry (qty 15); `beadStringActive` set to `false`.
- `src/app/components/Scene.tsx` — `INITIAL_CAMERA_POSITION` / `INITIAL_ORBIT_TARGET` module consts; `computeRecenterBox()` helper; env loaded at setup + self-recentered; per-tree-change camera reset effect; ground plane at y=0.001; angelina bead material-override exception at 4 sites.
- `public/models/ornaments/angelina/bead.glb` — new asset (GN-baked).
- `scripts/inspect_glb.mjs`, `scripts/inspect_bbox.mjs` — new diagnostic scripts.
- `public/screen capture/스케치_트리_올리브_스노우_-*.png` — sketch v3 recenter iteration screenshots.

---

## 2026-07-14 — sketchTree v3 wired + node-naming regex extended + bloom/light tuning

### sketchTree_v3_olive150.glb wired for 3-150cm-올리브

- New asset `public/models/trees/sketchTree_v3_olive150.glb` (9.4 MB) — updated sketchTree base model.
- `App.tsx` `treeVariantModels['3-150cm-olive']`: `sketchTree_olive150.glb` → `sketchTree_v3_olive150.glb`.
- Other references to the old olive150 (line 863 for Tree 4 150cm size-fallback, and tree default fallbacks for Tree 3/4) still point at the pre-v3 file — flagged to user for later.

### Node-naming regex extended for the sketchTree family

- v3 exports dropped the `sketchBranch` prefix, using plain `branch` / `branch.NNN` instead. Two regexes updated to accept both naming conventions (still substring-gated on `sketchTree` so no cross-family collision):
  - Quadrant instancing block (Scene.tsx `~L986`): `/^sketchBranch(\.\d{3}|\d{3})?$/` → `/^(?:sketchBranch|branch)(\.\d{3}|\d{3})?$/`
  - Light-scatter cluster discovery (Scene.tsx `~L1215`): `/^sketchBranch/` → `/^(?:sketchBranch|branch)/`
- Older sketchTree variants (`sketchTree_olive*.glb`, `sketchTree_white*.glb`) keep working via the `sketchBranch` alternate.
- Spot beacon cloning was already `child.name.startsWith('spot')` — no change needed.

### Light rendering tuning

- **Selective per-object bloom** — `BLOOM_STRENGTH_LIGHTS` finalized at **0.3** (was 0.5 → 0.45 → 0.3 over the iteration); `BLOOM_STRENGTH_OTHER` set to **0.0** so any authored emissive on ornaments contributes zero to bloom. Base scene render still shows the raw emissive color (only halo is killed).
- **Light material emissive intensity** bumped **4.2 → 13** at the source constructor in `buildGroup()` AND at the `setBlinkGroupLit(tag, lit=true)` restore point so the ON/blink/OFF cycle stays consistent. Net bloom-driving product went from `0.65 × 4.2 = 2.73` to `0.3 × 13 = 3.9` (~43% brighter halos, punchier bulbs).
- **Light mesh geometry** shrunk **6mm diameter → 4.5mm** (`SphereGeometry` radius `0.003 → 0.00225`). Tighter individual bulb footprint with a stronger emissive signal — reads as sharper points of light.

### Files
- `src/app/App.tsx` — sketchTree_v3_olive150 variant swap
- `src/app/components/Scene.tsx` — sketch quadrant regex + cluster regex extensions; bloom/emissive/geometry tuning
- `public/models/trees/sketchTree_v3_olive150.glb` — new asset

---

## 2026-07-13 (night) — Light distribution tuning + selective per-object bloom

### Light distribution — hollowed-cone shell now applied to all families

- Promoted `depthMin` from a per-family value to a scene-wide constant at `0.65` across ultimate/fishbone, sketch, and theFirstTree — every family now uses the outer-35% shell distribution (dense on the outer envelope, empty inside). Per-family y-band and radial numbers still differ per model geometry.
- theFirstTree scatter tuning iterated:
  - `yMinKeepPct: 0.05 → 0.11 → 0.08` — swung too aggressive, back to a compromise that trims deep floaters without starving the skirt.
  - `yBasePct` matched the moving floor at each step (0.08 → 0.14 → 0.10).
  - `tipRPct: 0.15 → 0.28 → 0.20` — 0.28 pushed bulbs past the visible tip silhouette (isolated above-tip floaters); 0.20 is the middle-ground that reaches the crown without launching bulbs out of the tree.
  - `yMaxKeepPct: 1.00 → 0.96` — new upper trim rejects vertex picks in the top ~4% (~7cm on 180cm) to kill leftover above-tip floaters.

### Selective per-object bloom

- The bloom pass is already gated to emissives (non-emissives get swapped to `darkMaterial` during the bloom render). Extended this so different emissive categories bloom at different strengths.
- **Constants** near the bloom composer setup:
  - `BLOOM_STRENGTH_LIGHTS = 0.5` — the actual `UnrealBloomPass` strength; drives tree-light halos.
  - `BLOOM_STRENGTH_OTHER = 0.0` — target strength for anything else emissive.
  - `OTHER_EMISSIVE_SCALE = BLOOM_STRENGTH_OTHER / BLOOM_STRENGTH_LIGHTS` — the per-frame multiplier applied to non-light emissives during the bloom render.
- **How it works**: bloom brightness is proportional to `bloom.strength × mat.emissiveIntensity`. Since the pass strength is a global scalar, we simulate a lower "other" strength by temporarily scaling non-light `emissiveIntensity` during the bloom render, then restoring immediately. The base scene render is unaffected.
- **Tagging**: `buildGroup()` in the scatter effect stamps every InstancedMesh with `userData.isTreeLight = true`. The bloom traversal checks that tag before deciding whether to scale.
- **Cache scheme**: `emissiveIntensityCache` is keyed by MATERIAL (not mesh) so a material shared across many meshes only gets scaled once per frame; restored after bloom render in the same pass that restores swapped materials.
- **Scope**: this only affects the bloom halo, not the base-scene emissive glow. Any ornament GLB shipping with authored emissive still glows in the base render — killing that too would require a load-time emissive zero-out (deferred).

### Files
- `src/app/components/Scene.tsx` — bloom constants + tag + emissive intensity cache; iterated scatter TUNING for theFirstTree; unified `depthMin` across all families.
- `public/screen capture/더퍼스트_트리-14{2730,3508}.png` — light-tuning iteration references.

---

## 2026-07-13 (evening) — 더퍼스트 model swaps: 180 → v4, 210 → theFirstTree_210

- 180cm × 없음: `theFirstTree_test_v3.glb` → `theFirstTree_test_v4.glb` (9.2 MB)
- 210cm × 없음: `theFirstTree_test_v2.glb` → `theFirstTree_210.glb` (10.5 MB)
- Both are one-line swaps in `App.tsx` `treeVariantModels`. All existing substring-gated behavior (quadrant instancing, built-in light scatter, `treeColor` opt-out) auto-applies since both new files still contain the `theFirstTree` substring.
- Prior `_test_v3` and `_test_v2` GLBs left on disk unreferenced (rollback safety).

---

## 2026-07-13 (later) — 더퍼스트 180cm model swap → theFirstTree_test_v3

- New asset `public/models/trees/theFirstTree_test_v3.glb` (9.2 MB) replaces the earlier `theFirstTree_test.glb` for the 180cm × 없음 slot.
- One-line change in `App.tsx` `treeVariantModels`: `'2-180cm-none'` now points at `_v3.glb`.
- Everything else auto-applies via the existing `theFirstTree` substring gates: 4-quadrant instancing of `spot / branch / foliage(.NNN)?`, built-in light scatter (3050 bulbs, hollow-cone tuning), `treeColor` opt-out preserving authored materials.
- Prior `theFirstTree_test.glb` left on disk for rollback; no longer referenced anywhere.

---

## 2026-07-13 — 더퍼스트 210cm variant wired + built-in light scatter tuning

### 더퍼스트 트리 210cm × 없음 wired

- New asset `public/models/trees/theFirstTree_test_v2.glb` (9.1 MB) — second real 더퍼스트 GLB.
- `App.tsx` `treeVariantModels` gains `'2-210cm-none': '/models/trees/theFirstTree_test_v2.glb'`.
- `DEPERSE_BUILTIN_BULB_COUNT` gains `'210cm': 3050` — **placeholder** using the 180cm figure. TODO: confirm real 210cm count with client (visual density would suggest something closer to ~4800 given the ~1.6× volume scaling).
- Everything else auto-applied via the `theFirstTree` substring gates already in Scene.tsx: 4-quadrant instancing of `spot / branch / foliage(.NNN)?`, cluster-scatter for the built-in lights, and the `treeColor` opt-out that preserves authored materials.

### Built-in light scatter tuning for theFirstTree

Iterating on the emissive-bulb distribution:

- Promoted the previously-magic `DEPTH_MIN = 0.35` constant into the `ScatterTuning` type as `depthMin`, so each tree family owns its own value.
- Introduced a dedicated theFirstTree TUNING entry (previously duplicated the sketch numbers). Current values:
  - `yBasePct: 0.08, yTipPct: 1.00` — cone envelope reaches from just above the base to the actual tip
  - `yMinKeepPct: 0.05, yMaxKeepPct: 1.00` — per-sample band trims sub-foliage floaters while still admitting crown picks
  - `baseRPct: 0.85, tipRPct: 0.15` — wider skirt at the base, mild taper at the top (avoids collapsing to a knife-point)
  - `rMaxKeepPct: 1.00` — reject outlier vertex picks beyond the cone envelope
  - `depthMin: 0.65` — bulbs pin to the outer 35% of the target radius, producing the hollowed-cone-shell look (dense on the outer envelope, empty inside)
- ultimate/fishbone and sketch families keep their prior `depthMin: 0.35` (volume-fill) — no behavior change for those.
- Tuning still not final for the crown / base — parked to return to.

### Files
- `src/app/App.tsx` — variant map entry, `DEPERSE_BUILTIN_BULB_COUNT` extension
- `src/app/components/Scene.tsx` — theFirstTree TUNING entry, `depthMin` in `ScatterTuning` type
- `public/models/trees/theFirstTree_test_v2.glb` — new asset (210cm)
- `public/screen capture/더퍼스트_트리-*.png` — light-tuning iteration references

---

## 2026-07-10 — 더퍼스트 트리 wired + JS-default-ate-opt-out fix + baked lights

### 더퍼스트 트리 (theFirstTree_test.glb) wired for 180cm × 없음

- New asset `public/models/trees/theFirstTree_test.glb` (8.4 MB) — first real 더퍼스트 GLB (Tree slot 2). Previously the slot fell back to `fishboneTree_green150.glb`.
- `App.tsx` `treeVariantModels`: added `'2-180cm-none': '/models/trees/theFirstTree_test.glb'`. Other 더퍼스트 (size × color) combos still fall back to the tree default (open item: 210cm × 없음).
- `Scene.tsx` — new 4-quadrant instancing block gated on `treeModelPath.includes('theFirstTree')`. Clones every `spot(.NNN)?`, `branch(.NNN)?`, and `foliage(.NNN)?` node at 90° / 180° / 270° around world Y. Uses the same `quaternion.premultiply(worldY-rot)` pattern as ultimate_tree_v2 / sketchTree so baked branch quaternions swing correctly. Regex handles both dot-preserved and dot-stripped GLTFLoader outputs.

### Material recolor bug — Scene.tsx default parameter was eating App.tsx's `undefined` opt-out

- **Symptom**: 더퍼스트 rendered as a uniform bright green (`#2d5a27`) despite the authored materials being dark olive (`#344a2f`, `#0b180b`, `#060e06`) — visually nothing like the Babylon sandbox reference.
- **Root cause**: `Scene.tsx` prop destructuring declared `treeColor = '#2d5a27'` as a default parameter. App.tsx's variant-specific opt-out (`treeColor={undefined}` when a `treeVariantModels` entry exists) was silently substituted by that default — the recolor useEffect then repainted all 892 foliage-tagged materials to the fallback green.
- **Fix**: removed the default parameter. `treeColor?: string` now propagates `undefined` faithfully, and the recolor effect's `if (!treeColor) return;` correctly early-returns for variant-specific GLBs. Authored materials render as-shipped.
- **Diagnostic recipe** (kept in the mental toolkit): dump material state (a) right after `gltf.scene` returns, (b) right before `treeGroup.add(model)`, and (c) log every recolor fire with the received `treeColor` value + repaint count. When (a) and (b) match but (c) shows a repaint using a value the caller thought it had opted out of → the callee is defaulting the prop.
- **Pattern lesson**: JS destructuring defaults substitute whenever the incoming value is `undefined` (not just missing). When a prop's `undefined` carries semantic meaning ("do nothing"), the callee MUST NOT declare a default for it.

### 더퍼스트 전구 일체형 — 3050 built-in bulbs baked as default (180cm)

- 더퍼스트 트리 remains 전구 일체형: Page 2 light thumbnails still surface the "electricity-integrated, no add-on" modal on click. Cart never gets add-on light rows for this tree.
- **What changed**: instead of the light pipeline hard-returning `[]` for `selectedTree === 2`, App now injects a synthetic `deperse-builtin` layer sourced from a per-size table (`DEPERSE_BUILTIN_BULB_COUNT`) so the scatter effect renders the built-in bulbs. Only `'180cm': 3050` for now — other sizes still empty until authored counts land.
- Palette: warm white `['#fff5cc']`, single color.
- `Scene.tsx` — scatter gate extended to `isUltimate || isSketch || isTheFirstTree`. Cluster regex `/^(?:foliage|branch)(?:\.\d{3}|\d{3})?(?:_rot_\d+)?$/` matches both `foliage.NNN` and `branch.NNN` parent nodes plus the `_rot_N` clones from the instancing block. Descendant-walk mesh collection reused from sketch family. Bounds derivation falls into the cluster-bbox branch. TUNING entry seeded from sketchTree numbers as a starting baseline — tune once the visual settles.
- The existing 전구 ON / 점멸모드 / 전구 OFF button controls the built-in bulbs like any other tree's lights.

### Files
- `src/app/App.tsx` — `treeVariantModels` entry, `DEPERSE_BUILTIN_BULB_COUNT` table, `lightLayers` synthetic layer injection
- `src/app/components/Scene.tsx` — theFirstTree quadrant clone block, scatter gate + cluster regex + TUNING, `treeColor` default parameter removal
- `public/models/trees/theFirstTree_test.glb` — new asset
- `public/screen capture/스크린샷 2026-07-10 171717.png` — Babylon sandbox reference (authored dark-olive look)
- `public/screen capture/더퍼스트_트리-171851.png` — pre-fix screenshot (before recolor bug was found)

---

## 2026-07-07 (late²) — Angelina folder reorg

- Moved all 17 엔젤리나 GLBs + `bead_string.glb` from flat `/models/*.glb` into `/models/ornaments/angelina/*.glb` to match the folder-per-set convention used by all other ornament sets.
- Updated `ORNAMENT_SET_1` paths (17 entries) + `beadStringPath` prop in App.tsx.
- Scene.tsx material-override whitelist tweaked at all 4 sites: `/ornaments/` still triggers "keep authored," EXCEPT when path also contains `/ornaments/angelina/` → angelina items continue to get the silver PBR override so the historical look is preserved.
- `ribon_custom_material` + `Silver_Ornament_Ball_` substring rules still fire independently; those specific angelina items keep their authored materials as before.
- No visual change expected.

---

## 2026-07-07 (late) — Final 2 ornament sets wired — 11 of 11 complete

- `ORNAMENT_SET_6` = 아이스젬 (6 GLBs × 3 = 18 pcs). 51MB → 4.9MB (90%).
- `ORNAMENT_SET_9` = 스노우크리스탈 (16 GLBs, 50 pcs). 159MB → 14MB (91%).
- Registry `ORNAMENT_SETS` now covers all 11 catalog ids: `{ 1: 엔젤리나, 2: 레인보우캔디샵, 3: 디스코나잇, 4: 겨울숲, 5: 도트볼, 6: 아이스젬, 7: 발레프리즘, 8: 핑크루체, 9: 스노우크리스탈, 10: 리치엘빈, 11: 코크베어 }`.
- Day total: ~2.8 GB source → ~227 MB deployed across 8 ornament folders (~92% reduction).

---

## 2026-07-07 (evening) — 6 more ornament sets wired + anchored placement + GN instancing fix

### Ornament sets added
Registry now covers **9 of 11** catalog entries:
- `ORNAMENT_SET_2` = 레인보우캔디샵 (28 GLBs, 73 pcs) — 606MB → 59MB
- `ORNAMENT_SET_3` = 디스코나잇 (15 GLBs, 50 pcs) — 210MB → 51MB (one outlier Beaded_Silver_Orb at 735K tris kept at 36MB per user)
- `ORNAMENT_SET_4` = 겨울숲 (7 GLBs, 20 pcs) — 127MB → 9.9MB
- `ORNAMENT_SET_5` = 도트볼 (6 GLBs, 18 pcs) — 103MB → 7.1MB
- `ORNAMENT_SET_7` = 발레프리즘 (13 GLBs, 50 pcs) — 220MB → 18MB
- `ORNAMENT_SET_8` = 핑크루체 (19 GLBs, 60 pcs) — 299MB → 26MB
- `ORNAMENT_SET_11` = 코크베어 (20 GLBs, 70 pcs) — 322MB → 22MB

Remaining: id=6 (아이스젬), id=9 (스노우 크리스탈).

### Anchored placement (star-tops on `top_point`)
- New `ANCHORED_PLACEMENTS` array in Scene.tsx: pattern-matched ornament paths get anchored to specific tree nodes rather than random beacons.
- Currently one entry: `/star[-_]top\.glb$/i` → `'top_point'` node. Matches `Golden_Star-top.glb` (coke_bear), `Silver_Star_top.glb` (disco), and any future star-tops in other sets.
- Placement pipeline now 3-phase: Phase 0 (anchored) → Phase 1 (preset) → Phase 2 (random fill).
- Star sits +7cm above the `top_point` object on Y so its base doesn't clip through the tree tip.
- If tree lacks `top_point`, all star instances fall through to random beacons.
- First star per tree lands anchored; additional qty (from multiple cart commits) goes to random beacons.

### Blender Geometry Nodes → EXT_mesh_gpu_instancing bug + fix
- 핑크루체's `bead.glb` used Blender GN to instance a sphere along a curve. Three.js loads EXT_mesh_gpu_instancing as an InstancedMesh, but our placement code reads only `.geometry` — dropping 20 per-curve positions.
- Wrote `scripts/bake_gn_instances.mjs` (see `scripts/README.md`) that expands each instance into a real child node. One-shot per affected GLB.
- Runtime fix (extend Scene.tsx to handle InstancedMesh sources natively) deferred.

### Material whitelist rule change
- Scene.tsx force-swap-to-silver whitelist extended: any path containing `/ornaments/` (subdirectory-based per-ornament sets) now keeps its authored material. Was silvering rich_alvin ornaments among others.

### Draco → WebP for asset compression
- Initial Draco attempt on rich_alvin damaged material state (black spots, valid attribute inspection but broken KHR_materials_clearcoat/sheen). Reverted.
- Switched to `gltf-transform webp` — touches only image encoding, valid binary GLB output, works in Three.js and Babylon.
- Pattern applied to 7 ornament folders. Total compression: ~2 GB source → ~213 MB.

### Render setting defaults
- Bloom strength: 0.8 → **0.5**
- DirectionalLight intensity: 6.5 → **3.77**
- DirectionalLight position: (-0.9, 20, 3.2) → **(-0.9, 20, -0.9)**

### Files touched
- `src/app/App.tsx` — 7 new `ORNAMENT_SET_N` arrays + registry entries
- `src/app/components/Scene.tsx` — `ANCHORED_PLACEMENTS` + Phase 0 placement + `/ornaments/` whitelist entries at 4 sites + render defaults
- `scripts/bake_gn_instances.mjs` + `scripts/README.md` — one-off GN instancing baker
- `public/models/ornaments/{candy_shop,coke_bear,disco,dotted_balls,pink,rich_alvin,winter_forrest}/` — WebP-compressed GLBs

---

## 2026-07-07 — 리치엘빈 wiring + per-ornament GLB architecture + WebP compression

### Per-ornament GLB sets — architecture
- Renamed `ORNAMENT_CONFIG` → `ORNAMENT_SET_1` (엔젤리나 default set).
- Added `ORNAMENT_SET_10` — 20 GLBs summing to exactly 70 pieces per set (리치엘빈 70pcs).
- New `ORNAMENT_SETS: Record<number, OrnamentSet>` — future ornaments register here; ids without a set entry silently contribute nothing to the scene.
- `scaledOrnamentConfig` rewritten to iterate all ornament layers (cart commits + preview), resolve each layer's set, scale by qty, merge into flat combined path→qty list.
- Multi-ornament in cart now stacks visually — Q3 answer honored.

### Material-override whitelist fix
- Scene.tsx had 4 sites that force-swap ornament materials to a silver PBR material unless the path matches specific whitelist entries. New rule at all 4 sites: any path containing `/ornaments/` (subdirectory-based per-ornament sets) keeps its authored material.
- Fixes 리치엘빈 rendering with unwanted silver override.

### Draco misadventure + WebP compression win
- Initial attempt: Draco geometry compression on all 20 리치엘빈 GLBs. `gltf-transform draco` produced split glTF (JSON + external .bin + external PNG textures) with `.glb` extension — Three.js parsed it (permissive loader) but Babylon rejected with "Unexpected magic". Rendered visually corrupted materials (black spots on ornaments) despite vertex attribute inspection showing no data loss.
- Reverted to originals (316 MB total).
- **WebP texture compression via `gltf-transform webp`** — touches only image encoding, no material extension damage risk. Result: **316 MB → 23 MB (93% reduction)** across all 20 ornaments. Valid self-contained binary GLBs (magic bytes `glTF`), works in both Three.js and Babylon.
- **Lesson pinned:** WebP-first for asset compression. Draco can silently damage material extension state (KHR_materials_clearcoat / sheen) even when CLI attribute inspection reports "identical pre/post."

---

## 2026-06-27 (afternoon) — Variant coverage, twotone accent, tree 4 sketchTree mapping

### Variant-specific GLB skips treeColor tint
- App.tsx Scene prop logic: when `treeVariantModels[treeId-size-color]` returns a hit, pass `treeColor={undefined}`. Scene's recolor effect short-circuits on `!treeColor`, preserving authored materials.
- Only fallback paths get tinted — sketch snow at 120/150/210cm (uses olive150) + tree 4 (uses sketch olive per size).
- Fixes "fishbone twotone shows no difference from green" — was being overwritten by recolor.

### Twotone Material.005 accent override (code-side)
- Investigation: twotone fishbone GLBs differ from green only by `Material.005` baseColor `#0d1104` vs base `#030d03`. Both near-black, visual difference imperceptible. Base "Material" greenness comes from per-vertex COLOR_0 attrs, not baseColor.
- Fix in `Scene.tsx` tree-load callback: when `treeModelPath.includes('twotone')`, hard-override `Material.005`'s color to `#5d8132` (brighter olive). Tagged `userData.isFoliage = false` so the foliage recolor doesn't sweep it.
- Match both `'Material.005'` and `'Material005'` (Three.js GLTFLoader is inconsistent about stripping dots from material names).

### Fishbone variant fleet — 100% coverage
- Added `green210` + `twotone210` GLBs. 피시본 now has all 8 (size × color) combos (120/150/180/210cm × 그린/믹스 투톤).

### Sketch variant fleet — partial coverage
- Added `sketchTree_olive120/210.glb` + `sketchTree_white120.glb`.
- 스케치 트리(올리브/스노우) status: olive all 4 sizes ✓; snow 120cm ✓ + snow 180cm ✓; snow 150cm + snow 210cm still fall back to olive150 + #f0f0f0 tint.

### Tree 4 (스케치 핑크/로즈) now uses sketchTree models
- New `treeSizeFallbackModels` layer between `treeVariantModels` and `treeDefaultModel`.
- Tree 4 at 150/180/210cm now resolves to the sketchTree olive GLB of matching size, then gets tinted to pink or rose via the foliage recolor.
- Was previously falling back to `ultimate_tree_v2_test.glb` (fishbone-style) regardless of size — now uses the visually correct sketch shape.

### Color tuning
- 핑크: `#ffc0cb` → `#f7d4da` (softer pale pink)
- 로즈: `#c64073` → `#d10050` (bold magenta-rose)

---

## 2026-06-27 — Fishbone variant fleet + scatter robustness + color-swap bug fix

### New tree GLBs
- `fishboneTree_green120.glb` / `fishboneTree_twotone120.glb` — 피시본 120cm variants
- `fishboneTree_green180.glb` / `fishboneTree_twotone180.glb` — 피시본 180cm variants
- Wired into `treeVariantModels` for the four (treeId × size × color) combos. 피시본 now covers 120/150/180cm in both 그린 and 믹스 투톤; 210cm still falls back to default.

### Light scatter — bounds-derived for both families
- `Scene.tsx` scatter useEffect: unified bounds derivation reading the cluster (sketch) or full-tree-minus-Stand/PVC/env (fishbone) AABB at runtime. Per-family `TUNING` table holds percentages.
- Fishbone-specific bbox source skips `defaultEnv` (env room walls), `Stand`, `PVC`, and `Cube.003` so `maxR` reflects the visible foliage extent, not the studio backdrop.
- `BASE_R = 1.45 × maxR`, `TIP_R = 0.32 × maxR` for fishbone — pushes lights past the cluster geometry to the alpha-card foliage edge. Sketch unchanged at `0.85 / 0.12`.
- Auto-adapts to any tree size (120/150/180/210); no more per-size tuning.

### Cluster regex — twotone variant compatibility
- Old regex `^branch(?:\d{3})?3$` only matched the green models' nested `branch.NNN.3` naming (dots stripped by Three.js → `branch0013`).
- Twotone variants have `Cube.022` at top level → Three.js sees them as `Cube022` / `Cube022_1` / `Cube022_2` etc. Old regex matched zero clusters → silent no-lights bug on 믹스 투톤.
- New: `^(?:branch(?:\d{3})?3|Cube022(?:_\d+)?)$` — handles both naming styles.

### Tree-load race condition fix
- `useEffect` now sets a `cancelled` flag in its cleanup. When the user rapidly toggles tree variants (e.g. olive ↔ snow at 180cm), out-of-order async GLB callbacks no longer overwrite the current model with a stale one. Cancelled loads also dispose their gltf.scene to free GPU memory.

### Foliage recolor bug — hue gate replaced with tag
- Old `treeColor` effect filtered materials by current hue (0.2–0.45 = greenish). After switching to 스노우 (white), foliage no longer passed the gate → next color click became a no-op → tree stuck on snow.
- Fix: tag foliage materials with `userData.isFoliage = true` at tree-load time (based on initial hue). `treeColor` effect now recolors by tag, regardless of current color. `treeReady` added to deps so newly loaded trees apply the current color immediately.

### Misc
- Bloom strength default: 0.92 → 0.8 (carried from prior session).
- Per-tree variant entries now organized by (treeId × size × color) key in `treeVariantModels`.
- Diagnostic console.info logs in tree load + scatter useEffects — useful for debugging future model wiring; can be stripped once stable.

---

## 2026-06-26 — Recommendation tables + 더퍼스트 guard + UI polish
Commit [`2d6143a`](https://github.com/TheCityGuru/christmas-tree-configurator/commit/2d6143a)

### Lights — recommendation engine
- Added two lookup tables to `App.tsx`:
  - **`SCENE_COUNT_TABLE`** (from `#트리` PDF) — bulbs to render in viewport, keyed by `(tree color group × size × light family × wrap mode)`.
  - **`CART_SET_COUNT_TABLE`** (from `#전구` PDF) — sets to buy, keyed by `(light product × qty unit × size × wrap mode)`.
- Decoupled by design: e.g. 스케치 150cm + 쥬얼라이트 renders 800 bulbs on tree but cart buys 2× 500구 sets (1000 total).
- `lightLayers` is now **reactive** — any change to tree/size/wrap re-derives scene count for every layer (committed + preview). Cart purchase numbers stay frozen at commit time.
- `addToCart` (kind `light`): `qty` = `getCartSetCount(...)` at commit. Example: 팝팝 500구 on 피시본 210cm × 360 촘촘 → row reads "팝팝 500구 ×6" (6 sets = 3000 bulbs purchase).

### Wrap mode UI per light family
- Wire (팝팝/파스텔팝/좁쌀): front-only → [앞면], 360 → [360도, 360도 촘촘]
- LED (쥬얼라이트): front-only → [앞면], 360 → [360도]
- Cluster: front-only → [앞면], 360 → [360도]
- Auto-snap: switching light to a family without 촘촘 demotes wrap mode from `360-dense` → `360`.
- Hover tooltip (Radix): *"권장구수: X개 · 구매: Y세트 (Z개)"*. Fallback text when no light selected or no data.

### 더퍼스트 (treeId=2) — 전구 일체형 guard
- `lightLayers` hard-gates: returns `[]` when `selectedTree === 2`. No add-on lights render regardless of cart contents.
- Clicking any page-2 light thumbnail with 더퍼스트 selected → modal: *"더퍼스트 트리는 전구 일체형으로 전구 추가 선택이 불가합니다."* + 확인 button.
- When the real 더퍼스트 GLB lands, its baked-in lights will be part of the model.

### Palette fixes (per #전구 PDF notes)
- 파스텔팝: 6-cycle `warm/orange/warm/green/warm/purple` (50% warm + 16.7% each accent). Was: pink/mint/sky pastel.
- 쥬얼라이트: 4-cycle `warm/warm/warm/scarlet` (`#e63946`, 75/25 mix). Was: warm only.
- 팝팝 혼합색: unchanged.

### Misc
- Bloom strength default: 0.92 → 0.8.

### Files
- `src/app/App.tsx` — tables, helpers, lightLayers gate, addToCart qty, wrap UI rewrite + tooltips, modal.
- `src/app/components/Scene.tsx` — bloom strength.

---

## 2026-06-26 — Initial v5 commit
Commit [`533974a`](https://github.com/TheCityGuru/christmas-tree-configurator/commit/533974a)

Snapshot of all v5 work-in-progress at the time the repo was initialized. Full narrative in `CHANGELOG_v4_to_v5.md`. Highlights:

- sketchTree GLB wiring (slot 3) with quadrant clone block.
- jopsal_fish family abolished; white-orb bug fix (unscoped `Material.006` override removed).
- Cart persistence refactor — discriminated union `CartItem` (tree/light/ornament/point), per-kind merge rules, clear-on-commit, multi-layer light rendering.
- Multi-color light palettes (`colorsByBulbColor`) — 팝팝 혼합색 (warm + sky blue), 파스텔팝 (pink/mint/sky — superseded next push).
- Per-tree size + color options (`treeOptionsMap[treeId]`). 더퍼스트 = "없음" placeholder. 스케치 핑크/로즈 drops 120cm.
- Variant-aware tree model resolver: `resolveTreeModel(treeId, size, color)` with fallback chain.
- New tree GLBs: `fishboneTree_green150` (renamed from `ultimate_tree_v2`), `fishboneTree_twotone150`, `sketchTree_olive150/180`, `sketchTree_white180`.
- Scene.tsx gates expanded to match both `ultimate_tree_v2*` and `fishboneTree*` families.
- Bloom default 0.65 → 0.92.
