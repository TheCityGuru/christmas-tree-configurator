# Changelog

Running log of changes pushed to `main`. Newest at the top.
Format: each push = one dated section. Commit hash linked for diff drill-down.
For the v4 → v5 transition history, see `CHANGELOG_v4_to_v5.md`.

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
