# Changelog

Running log of changes pushed to `main`. Newest at the top.
Format: each push = one dated section. Commit hash linked for diff drill-down.
For the v4 → v5 transition history, see `CHANGELOG_v4_to_v5.md`.

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
