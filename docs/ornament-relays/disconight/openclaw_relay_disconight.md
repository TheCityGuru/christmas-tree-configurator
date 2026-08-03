# RELAY — discoNight Ornament Models (2 crystal models, for OpenClaw agent)

Copy everything below this line into the OpenClaw agent.

---

## Mission

Integrate TWO new crystal models for the discoNight (디스코나잇) set:

- `Crystal_Fairy` — clear crystal body with pink/mint GLITTER ON THE WINGS ONLY
  (sparkle enabled, same mechanism as the Pink Lucé family)
- `Crystal_Reindeer` — pure clear crystal, NO glitter (same treatment as the
  snowCrystal/ice sets)

PM-approved; integration only. These join whatever other discoNight assets the
set already has (tinsel balls etc.) — those existing items keep their current
materials; only these two GLBs get the crystal factory treatment.

## Files you receive (17)

- `Crystal_Fairy.glb`, `Crystal_Reindeer.glb`
- 14 PNGs — the standard 7-map set per model, usual naming scheme.
  - Fairy maps are REAL 2048 textures: the glitter mask/dots live only in the
    wing UV region (the wing area was isolated geometrically and rasterized
    into UV space — do not regenerate or "simplify" these maps).
  - Reindeer maps are the small uniform pure-crystal set (same as snowCrystal).
- `viewer.html` — acceptance reference (`viewer.html?model=Crystal_Fairy`).

## Integration

1. **No factory changes.** Current `ornament_material.js` works as-is.
   One material per model via `makeSparkleCrystal(renderer, { model, ... })`,
   basePath scoped to the discoNight asset directory. No per-model overrides.
2. **Assignment rule:** both models are texture-less transmissive crystals
   (same as snowCrystal/ice) — the `transmission > 0` branch of the rule
   matches them. Hanger meshes keep their originals as always.
3. **Sparkle registration is SPLIT for this set:**
   - `Crystal_Fairy`: sparkle ENABLED — register in the sparkle-only bloom
     prepass and call `updateSparkle(camera)`, exactly like the Pink Lucé
     models. Glints will fire only on the wings (mask-driven).
   - `Crystal_Reindeer`: sparkle DISABLED — do NOT register in the prepass,
     skip `updateSparkle`, same as the snowCrystal/ice models.
   If your `sparkleSpecFor` logic is set-level, it needs to be per-model here.
4. Keying reminder: continue keying materials/paths by `(set, model)` — these
   names don't collide with other sets today, but keep the convention.

## Acceptance criteria (vs viewer.html?model={name}, camera orbiting)

1. Fairy: body/arms/legs/hair read as clear colorless crystal; the four wing
   lobes carry pink/mint sprayed dots with soft sparkle glints + bloom halos
   ON THE WINGS ONLY. If glitter appears on the body or leg, wrong maps.
2. Reindeer: pure clear crystal, zero glitter, zero sparkle/bloom.
3. Metal hangers keep their original silver materials.
4. All previously integrated sets render unchanged.
5. No console shader errors.
