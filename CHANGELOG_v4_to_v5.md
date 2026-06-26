# Changelog: v4 → v5

**v4 archived:** 2026-06-25 (latest snapshot, supersedes 2026-06-11 zip)
**v5 branched:** 2026-06-25

---

## Tree Models

### 스케치 트리 (Tree 3) — New Model
- New GLB: `/public/models/trees/sketchTree_olive150.glb`
- Quadrant-instanced (single quadrant baked, runtime-cloned at 90°/180°/270°)
- New Scene.tsx quadrant clone block matching the `ultimate_tree_v2` pattern
- Regex matches both Blender export styles: `sketchBranch.001` and `sketchBranch001`
- Spot beacons (`spot.NNN`) auto-cloned via existing `startsWith('spot')` discovery

### jopsal_fish Family — Abolished
- Removed `jopsal_fish_v9.glb` test model wiring + Scene.tsx clone block (~50 lines)
- Removed `jopsal_fish_v11.glb` test model wiring + Scene.tsx clone block (~60 lines)
- Removed unscoped global `Material.006` baked-light override — was causing sketchTree's needle material (also named `Material.006` by Blender auto-numbering) to render as a giant glowing yellow orb
- Removed `setMatEmissive` helper + `treeOn` toggle line (now-dead code in the light-mode useEffect)
- 좁쌀 light **product** (millet-light catalog item) preserved — separate from the jopsal test tree

### Tree Slot Renaming
- Tree 1 = 피시본 트리 (label, currently uses `ultimate_tree_v2.glb` as placeholder)
- Tree 2 = 더퍼스트 트리 (label, currently uses `ultimate_tree_v2.glb` as placeholder)
- Tree 3 = 스케치 트리(올리브/스노우) — wired to new `sketchTree_olive150.glb`
- Tree 4 = 스케치 트리(로즈/핑크) — wired to `ultimate_tree_v2_test.glb` (placeholder)

### Lesson Learned
- **Never do model-wide `Material.NNN` overrides without scoping by `treeModelPath`.** Blender auto-numbers material names → different GLBs may reuse the same auto-name for completely different meshes.
- Future best practice: rename materials in Blender to purposeful names (`BakedBulb_Emissive`, `Foliage_Olive`, etc.).

---

## 장식 범위 Selector (Decoration Scope)

- New Step 1 selector card with two options: **앞면만 장식** / **360도 전체 장식**
- Uses built-in lucide icons (`TreePine` + `RotateCw`)
- Default = 360도 전체 장식
- Replaced the previous floating "오너먼트 앞면 배치" button
- Wires to existing `frontOnlyMode` state

---

## 전구 감기 옵션 (Light Wrap Mode)

- New state: `lightWrapMode: 'front' | '360' | '360-dense'`, default `'360'`
- Synced with 장식 범위: front-only → forced to `'front'`; 360-mode → resets `'front'` to `'360'` but preserves `'360-dense'` choice
- **Replaced the buggy 전구 감기 밀도 buttons** (which were wrongly writing to `selectedColor` state and clobbering tree color)
- Conditional UI based on 장식 범위:
  - 앞면만 장식 → single auto-selected "앞면" button (TreePine icon)
  - 360도 전체 장식 → two buttons: "360도" (LayoutGrid) + "360도 촘촘" (Grip)
- Section title renamed: 전구 감기 밀도 → 전구 감기 옵션

---

## Front-Only Geometry — Quintant → Quadrant Router

- New helper: `isFrontForTree(p, treeModelPath)` routes between front-half geometry implementations
  - Fishbone tree (5-arm) → `isFrontQuintant` (Q1/Q2/Q3 of 5 quintants)
  - Quadrant trees (ultimate_tree_v2, sketchTree, 4-arm) → `isFrontQuadrant` (`p.z >= 0`)
- All three ornament-placement sites migrated from `isFrontQuintant` → `isFrontForTree`
- Light scatter migrated to `isFrontForTree` (front-only respects tree geometry)

### Front-Only Light Scatter
- Light scatter useEffect now respects `frontOnly` prop
- Dynamic over-sampling: `PER_BRANCH = clamp(ceil(lightCount × safety / numClusters), 12, 60)`
  - `safety = frontOnly ? 3 : 1.2` — front-only oversamples 3× to compensate for back-half rejection
- Verified to meet user-ordered count even at 3000구 + front-only
- `frontOnly` added to dep array → fresh re-shuffle on 장식 범위 toggle

### Front-Only Ornament Count Bug Fix
- **Bug**: Phase 2 random-fill divided remaining quota by hardcoded `/4` (4 quadrants). In front-only mode, the front filter leaves 2/4 buckets empty → empty buckets contributed 0 → placed count was exactly half of `cfg.qty`.
- **Fix**: replaced `/4` with `nonEmptyBuckets = quadrantBuckets.filter(b => b.length > 0).length || 1`
- Now: 360-mode → 4 quadrants, front-only quadrant-tree → 2, front-only fishbone quintant → 3
- Same `cfg.qty` ornaments rendered regardless of mode

---

## sketchTree Light Scatter Wiring (v5-specific)

- Light scatter gate expanded from `includes('ultimate_tree_v2')` only → accepts both `ultimate_tree_v2` and `sketchTree`
- Per-tree cluster regex:
  - ultimate → `/^branch(?:\d{3})?3$/` (3-suffix needle clusters)
  - sketch → `/^sketchBranch/` (broad prefix match covers original + runtime quadrant clones)
- **Robust cluster discovery for sketchTree**: walks INTO matched parents and collects all descendant meshes (handles both Mesh and Group cases — strict `instanceof Mesh` filter was rejecting Group parents)
- **Bounds-derived scatter shape**: for sketchTree, `Y_BASE / Y_TIP / BASE_R / TIP_R` computed from cluster AABB at runtime instead of hardcoded ultimate_tree_v2 values
  - `TIP_R / BASE_R = 0.21` ratio borrowed from ultimate's tuned defaults
- Diagnostic console.info logs added (cluster count + bounds) for future debugging

---

## Camera Enclosure Constraint

- `OrbitControls.maxPolarAngle = Math.PI * 115 / 180` (loosened from 110° to allow floor-level access)
- Change-event listener clamps target + position to env.glb AABB
- Wall buffer: 10cm; Floor buffer: 5cm (prevents camera from poking through scene geometry)

---

## Cart Preview Card UI Tweak

- White card background + slate-700 product-name chip with slate-50 text
- Matches client screenshot 132319

---

## Thumbnail Folder Reorganization

- Flat `/public/thumbnails/` reorganized into 4 subfolders:
  - `tree/` — tree button thumbnails
  - `lights/` — light product thumbnails
  - `ornament/` — ornament thumbnails
  - `point/` — point ornament thumbnails
- All 18 path references in code updated accordingly

---

## Ornament Catalog Expansion

- Expanded from 4 → 11 ornaments
- All new entries with Korean filenames
- `ornamentThumbnails` + `ornamentNames` records grown
- Grid render now uses `Object.keys(...).map(Number).sort((a, b) => a - b)` to handle non-contiguous keys safely

---

## Files Changed
| File | Change |
|------|--------|
| `src/app/components/Scene.tsx` | Major: sketchTree quadrant clone block, light scatter expanded to sketchTree (robust mesh discovery + bounds-derived shape), jopsal_fish blocks removed, Material.006 global override removed, `isFrontForTree` router added, ornament count bug fix, camera enclosure clamp |
| `src/app/App.tsx` | 장식 범위 selector, 전구 감기 옵션 with state sync, tree slot wiring + renames, ornament catalog expansion, cart preview UI, thumbnail path migration |
| `public/models/trees/sketchTree_olive150.glb` | New: 4-quadrant sketch tree (올리브/스노우) |
| `public/thumbnails/{tree,lights,ornament,point}/` | New: reorganized into 4 subfolders, 11 ornament thumbnails total |

---

## Open Items (carried into v5)
- Slot 1 ('피시본 트리') still loads `ultimate_tree_v2.glb` — labeled inconsistently
- Slot 2 ('더퍼스트 트리') still loads `ultimate_tree_v2.glb` as placeholder — needs proper model
- Slot 4 ('스케치 트리(로즈/핑크)') needs proper sketch tree model
- Trees 3 & 4 sub-variant toggles (올리브/스노우, 로즈/핑크) for 2 thumbnails each — not yet wired
- PDF spec lookup table for recommended light + ornament counts per (tree × size × light × wrap)
- Product-specific light visuals (per-product color/size/blink/material)
- Bloom performance optimization for weaker machines
- Rearrange occlusion click-through improvement
- Strip diagnostic `console.info` lines in Scene.tsx light scatter once verified
