// ============================================================================
// Pink Lucé ornament family — sparkle crystal material factory (app port)
// ----------------------------------------------------------------------------
// Ported from the PM-approved `ornament_material.js` delivered by the material
// author. The approved BEAUTY material + shader are unchanged. Added for THIS
// app's selective-bloom pipeline: a `bloomMaterial` variant used ONLY during the
// darken-prepass so that ONLY the sparkle glints halo (not the whole crystal).
//
// The app's bloom pass has no HDR threshold (threshold 0, strength 0.3); it
// isolates bloom by swapping every non-tagged mesh to flat black in a prepass.
// A plain tag would bloom the whole lit crystal. Instead we swap the crystal to
// this variant: same approved glint shader (SAME uniform + texture instances so
// glints fire at identical texels/frames), base color forced black, transmission
// off, opaque — so the bloom buffer receives the sparkle emissive alone.
// ============================================================================
import * as THREE from 'three';

export type PinkLuceModel =
  | 'carousel' | 'dress' | 'flakeStar' | 'floral' | 'key' | 'shell'
  | 'snowFlake' | 'sphere' | 'train' | 'unicorn' | 'wing'
  | 'white_glitter_ball_L' | 'white_glitter_ball_S';

// per-model physical overrides. Smooth thick volumes need a larger `thickness`
// so refraction reads as solid crystal instead of chrome (PM-approved).
const OVERRIDES: Partial<Record<PinkLuceModel, { thickness?: number; transmission?: number }>> = {
  unicorn: { thickness: 1.4 },
  // opaque models: disable transmission entirely (visually identical to the
  // all-black transmission map, but skips the costly transmission pass).
  white_glitter_ball_L: { transmission: 0 },
  white_glitter_ball_S: { transmission: 0 },
};

export interface SparkleCrystal {
  /** Beauty-pass material (approved look). Assign to the crystal InstancedMesh. */
  material: THREE.MeshPhysicalMaterial;
  /** Bloom-prepass variant — sparkle emissive only, opaque black base. */
  bloomMaterial: THREE.MeshStandardMaterial;
  sparkleUniforms: Record<string, { value: unknown }>;
  /** Halo-only strength knob (bloom variant). Does NOT affect beauty glints. */
  bloomScaleUniform: { value: number };
  /** Call once per model per frame (before render). Syncs BOTH materials. */
  updateSparkle: (camera: THREE.Camera) => void;
  /** Dispose both materials and all textures. */
  dispose: () => void;
}

// Shared GLSL: the approved glint term. `EXTRA` lets the bloom variant scale the
// emissive contribution without touching beauty-pass brightness.
const commonDecl = `#include <common>
        uniform sampler2D uGlitterMask;
        uniform sampler2D uDotData;
        uniform float uSparkleIntensity, uGlintSharp, uTiltAmp;
        uniform vec3 uSunDirView;`;

const sparkleBlock = (emissiveScaleExpr: string) => `#include <emissivemap_fragment>
        #ifdef USE_MAP
        {
          float gmask = texture2D(uGlitterMask, vMapUv).r;
          if (gmask > 0.15) {
            vec3 dd = texture2D(uDotData, vMapUv).rgb;   // per-dot constants
            vec3 fn = normalize(normal + vec3((dd.rg - 0.5) * uTiltAmp, 0.0));
            vec3 vDir = normalize(vViewPosition);
            vec3 h = normalize(vDir + normalize(uSunDirView));
            float gSun  = smoothstep(uGlintSharp, 1.0, dot(fn, h));
            float gView = smoothstep(uGlintSharp, 1.0, dot(fn, vDir));
            float g = max(gSun, gView);   // camera-only motion must sparkle
            // dot color kind from dotdata B: 0=pink, ~0.5=white, 1=green
            // (legacy maps use only 0/255 -> the 11 crystal models are unchanged)
            vec3 pinkC  = vec3(1.00, 0.62, 0.86);
            vec3 greenC = vec3(0.55, 1.00, 0.75);
            vec3 whiteC = vec3(1.00, 0.98, 1.00);
            vec3 c = dd.b < 0.25 ? pinkC : (dd.b > 0.75 ? greenC : whiteC);
            totalEmissiveRadiance += c * g * uSparkleIntensity * gmask${emissiveScaleExpr};
          }
        }
        #endif`;

export function makeSparkleCrystal(
  renderer: THREE.WebGLRenderer,
  { model, sunWorldDir = new THREE.Vector3(4, 6, 3).normalize(), basePath = '' }:
    { model: PinkLuceModel; sunWorldDir?: THREE.Vector3; basePath?: string },
): SparkleCrystal {
  const tl = new THREE.TextureLoader();
  const textures: THREE.Texture[] = [];
  const load = (name: string, srgb = false) => {
    const t = tl.load(`${basePath}${model}_${name}.png`);
    t.flipY = false;                          // glTF UV convention
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; // some models (balls) tile their UVs ~6x
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    textures.push(t);
    return t;
  };

  // Shared texture instances (reused by both beauty + bloom variant).
  const baseColorMap = load('basecolor', true);
  const mrMap = load('metalRough');
  const normalMap = load('normal');
  const glitterMask = load('glittermask');
  // dot data: NEAREST so every pixel of a dot shares one value -> whole dot flashes
  const dotData = load('dotdata');
  dotData.minFilter = THREE.NearestFilter;
  dotData.magFilter = THREE.NearestFilter;
  dotData.generateMipmaps = false;

  const material = new THREE.MeshPhysicalMaterial({
    map: baseColorMap,
    metalnessMap: mrMap, metalness: 1.0,
    roughnessMap: mrMap, roughness: 1.0,
    normalMap,
    transmission: 1.0, transmissionMap: load('transmission'),
    ior: 1.4, thickness: 0.35, transparent: true, side: THREE.DoubleSide,
    iridescence: 1.0, iridescenceMap: load('iridescence'),
    iridescenceIOR: 1.3, iridescenceThicknessRange: [150, 450],
    envMapIntensity: 1.2,
    ...(OVERRIDES[model] || {}),
  });

  const sparkleUniforms: Record<string, { value: unknown }> = {
    uGlitterMask:      { value: glitterMask },
    uDotData:          { value: dotData },
    uSparkleIntensity: { value: 4.5 },    // HDR glint brightness (feeds bloom)
    uGlintSharp:       { value: 0.982 },  // higher = rarer/smaller flashes
    uTiltAmp:          { value: 1.1 },    // per-dot tilt spread
    uSunDirView:       { value: new THREE.Vector3(0, 0, 1) },
  };

  // Beauty pass — approved, unchanged.
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sparkleUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', commonDecl)
      .replace('#include <emissivemap_fragment>', sparkleBlock(''));
  };

  // Bloom prepass variant — sparkle emissive only, opaque black base.
  // Shares the SAME sparkleUniforms + texture instances (glints stay in sync),
  // keeps the normalMap (glint reads the perturbed normal). `uBloomScale`
  // decouples halo strength from beauty-pass glint brightness.
  const bloomScaleUniform = { value: 1.0 };
  const bloomMaterial = new THREE.MeshStandardMaterial({
    map: baseColorMap,          // needed for vMapUv; color black => diffuse black
    color: 0x000000,
    normalMap,                  // keep: glint reads perturbed normal (in-sync)
    metalness: 0.0, roughness: 1.0, envMapIntensity: 0.0,
    emissive: 0x000000,
    transparent: false,         // opaque: no sort-order ghosting in bloom buffer
    side: THREE.DoubleSide,     // match beauty-pass coverage
  });
  bloomMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sparkleUniforms, { uBloomScale: bloomScaleUniform });
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `${commonDecl}
        uniform float uBloomScale;`)
      .replace('#include <emissivemap_fragment>', sparkleBlock(' * uBloomScale'));
  };

  const updateSparkle = (camera: THREE.Camera) => {
    (sparkleUniforms.uSunDirView.value as THREE.Vector3)
      .copy(sunWorldDir)
      .transformDirection(camera.matrixWorldInverse);
  };

  const dispose = () => {
    material.dispose();
    bloomMaterial.dispose();
    textures.forEach((t) => t.dispose());
  };

  return { material, bloomMaterial, sparkleUniforms, bloomScaleUniform, updateSparkle, dispose };
}
