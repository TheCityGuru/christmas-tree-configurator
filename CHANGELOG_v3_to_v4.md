# Changelog: v3 → v4

**v3 archived:** 2026-05-06  
**v4 archived:** 2026-06-05  

---

## Tree Models

### 피시본 트리 (tree3) — New Model
- Replaced `/models/fishbone_150.glb` with `/models/trees/fishbone_150_ultimate_v1_draco.glb`
- User rebuilt Blender hierarchy: Cube.009 exposed as proper object with correct material assignment
- Draco-compressed for web performance (2.14MB → 1.74MB, using `gltf-transform draco`)
- Runtime material swap: meshes using `Material.004` reassigned to PE's `Material`
- Tuned defaults for `Material.001`: color=#042b03, metalness=0.24, roughness=0.78, envMapIntensity=1
- 5-instance 72° rotation system preserved (clone `tree` + `spot*` nodes only)

---

## Light System — 3-State Toggle

- **Replaced** binary on/off (`lightsOn: boolean`) with 3-state cycle (`lightMode: 'on' | 'blink' | 'off'`)
- **Blink mode**: alternates individual Bézier curve meshes in jopsal_light at 500ms intervals
- Materials cloned per mesh for independent emissive control (shared material caused all curves to toggle together)
- UI button cycles: 켜기 → 점멸 → 끄기 → 켜기

---

## HDRI
- Removed multi-HDRI selector (3 lighting presets)
- Hardcoded to `brown_photostudio_02_1k.exr`

---

## 오너먼트 보관함 (Storage Panel) — New Feature + Bug Fixes

### New Feature
- Ornaments can be stored (removed from tree) and retrieved via UI panel
- `SceneActions` imperative ref: `storeCurrentPick()`, `retrieveFromStorage(key)`
- `StoredOrnamentInfo` with thumbnail data URL for panel display
- Storage state communicated to App via `onStorageChange` / `onPickStateChange` callbacks

### Bug Fixes
- **Thumbnail rendering**: Fixed blank thumbnails — reparent ornament to thumbScene BEFORE computing bounding box (was computing in wrong coordinate space)
- **Blue glow persisting**: Two fixes:
  1. `retrieveFromStorage` now restores previous pick's materials before setting new pick
  2. PLACE handler emissive clear changed from hue-detection to unconditional `mat.emissive.set(0x000000)`

---

## 오너먼트 디폴트 배치 (Placement Presets) — New Feature

- Admin UI: "오너먼트 디폴트 배치" toggle + "배치 셋팅 저장" button (top-right of viewport)
- `exportPlacement()` reads current ornament positions → `PlacementPreset` JSON
- Vite dev plugin (`placementSavePlugin`): POST `/api/save-placement` merges preset into `public/settings/placements.json` (keyed by tree model path)
- Scene loads presets via `placementPresetPath` prop → two-phase placement:
  - Phase 1: apply saved preset positions
  - Phase 2: fill remaining with stratified random placement
- New types exported: `PlacementEntry`, `PlacementPreset`, `SceneActions`

---

## 재배치 (Rearrange) Mode UX Improvements

- **Blocked multi-select**: when an ornament is selected (blue glow), clicking other ornaments is now ignored
- Only two actions while selected: click same ornament (cancel) or click gray spot (place)
- **Spot markers** changed from neon blue (`0x00ccff`) to gray (`0x999999`)
- **Occlusion check**: raycasts against tree meshes first; if tree geometry is closer than ornament hit, click is ignored (prevents picking ornaments on the far side of the tree)

---

## Ornament Placement Refactor

- Extracted `placeOrnament()` helper for placing a single ornament clone at a beacon position
- `beaconLookup` map (key → Vector3) for preset-based placement
- `clone.userData._ornamentPath` stored on each placed ornament for export/preset tracking

---

## Help Guide
- Removed "이동" (pan) instruction from rearrange help overlay

---

## Files Changed
| File | Change |
|------|--------|
| `src/app/components/Scene.tsx` | Major: storage, presets, light toggle, rearrange UX, occlusion, bug fixes |
| `src/app/App.tsx` | Storage panel state, admin placement UI, 3-state light, tree3 model path |
| `vite.config.ts` | Added `placementSavePlugin()` Vite dev server middleware |
| `public/settings/placements.json` | New: merged placement preset data (keyed by tree path) |
| `public/models/trees/fishbone_150_ultimate_v1_draco.glb` | New: Draco-compressed tree3 model |
| `public/models/trees/fishbone_150_ultimate_v1.glb` | New: uncompressed source model |
| `public/models/ornaments/pink/Meshy_AI_Glitter_Snowflake_Key.glb` | New: ornament model |
| `public/models/ornaments/pink/unicorn.glb` | New: ornament model |
