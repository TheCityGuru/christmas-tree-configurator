# RELAY — ice Ornament Set (5 pure-crystal models, for OpenClaw agent)

Copy everything below this line into the OpenClaw agent.

---

## Mission

Integrate a NEW ornament set, "ice": FIVE pure clear-crystal models —

`Bead_Tassel, Crystal_Pendant, Crystal_prism, Crystal_Teardrop, Faceted_Crystal`

NAMING CAUTION: these model names overlap with the snowCrystal set, but the
GLBs are DIFFERENT (higher-poly "ice" variants with volume+clearcoat
extensions). Keep the two sets in separate asset directories (e.g.
/models/ornaments/ice/ vs /models/ornaments/snowcrystal/) and scope texture
basePath per set — do not let the files collide.

Same material system as the Pink Lucé family, but with ZERO glitter and ZERO
sparkle — plain clear crystal. PM-approved; integration only.

## Files you receive (41)

- 5 × `{model}.glb`
- 35 × PNG — standard 7-map set per model, same naming scheme as always.
  NOTE: these are small uniform-color textures (the models carry no baked
  textures; the maps just drive the factory: transmission=1 everywhere,
  roughness 0.03, glittermask all-black). Don't be surprised by the tiny sizes.
- `viewer.html` — reference; open `viewer.html?model=Crystal_prism` etc.
- This document.

## Integration

1. **No factory changes.** Your current `ornament_material.js` (the version
   from the glitter-ball patch) works as-is. Create one material per model via
   `makeSparkleCrystal(renderer, { model: '<name>', ... })` exactly like the
   other sets. No per-model overrides for this set (default thickness 0.35).

2. **Assignment rule extension (REQUIRED).** These crystal materials carry NO
   textures at all — only a glTF transmission extension — so both earlier match
   rules miss them. Extend the rule (everywhere it appears) to:
   ```js
   gltf.scene.traverse(o => {
     if (o.isMesh && o.material &&
         (o.material.map || o.material.normalMap || o.material.transmission > 0)) {
       o.material = material;
     }
   });
   ```
   Hanger materials never have transmission, so this stays safe for every set
   (Pink Lucé crystals match via map; glitter balls via normalMap; snowCrystal
   via transmission).

3. **Skip the sparkle machinery for this set (perf).** The glitter mask is
   all-black, so the sparkle term is always zero:
   - Do NOT register these models in the sparkle-only bloom prepass set —
     let the standard darken prepass black them out like any non-bloom object.
   - Skipping their `updateSparkle()` calls is also fine (the uniform is never
     visible). Calling it anyway is harmless, just wasted work.

4. Transmission cost note: all 11 are transmissive. They share the scene's
   single transmission pass with the Pink Lucé crystals, so the incremental
   cost is per-pixel, not per-set — but if the tree gets heavy, the usual
   fallback ladder applies.

## Acceptance criteria (vs viewer.html?model={name}, camera orbiting)

1. Every model reads as bright CLEAR colorless crystal (these are thicker, higher-poly cuts — expect stronger internal refraction than snowCrystal) — background refracts
   through; no gray/chrome, no tint.
2. NO sparkle glints and NO bloom halos on any ice model (if you see
   sparkles, the wrong maps or a Pink Lucé material got attached).
3. Metal hanger keeps its original silver material on every model.
4. The existing Pink Lucé, glitter-ball, and snowCrystal sets render unchanged.
5. No console shader errors across all 5.
