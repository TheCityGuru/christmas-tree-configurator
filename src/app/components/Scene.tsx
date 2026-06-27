import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import GUI from 'lil-gui';

// ---------- Types ----------
export interface PlacementEntry {
  ornamentPath: string;
  beaconKey: string;
  rotation: [number, number, number];
}

export interface PlacementPreset {
  tree: string;
  placements: PlacementEntry[];
}

export interface SceneActions {
  storeCurrentPick: () => string | null;
  retrieveFromStorage: (key: string) => void;
  exportPlacement: () => PlacementPreset | null;
  captureScreenshot: () => string | null;
}

export interface StoredOrnamentInfo {
  key: string;
  thumbnail?: string; // data URL of a mini render
}

// ---------- Instanced Ornament Registry ----------

/** One InstancedMesh per unique (ornamentPath, childMeshIndex) */
interface InstanceGroup {
  ornamentPath: string;
  childMeshName: string;
  instancedMesh: THREE.InstancedMesh;
  /** The shared material (silver override or original) */
  sharedMaterial: THREE.Material;
  /**
   * Mesh local-to-srcModel-root matrix, capturing the cumulative transform
   * (scale, rotation, translation) of the mesh's ancestor chain inside the
   * source GLB. Pre-multiplied into per-instance matrices so the Blender-
   * authored size/orientation is preserved when the geometry is moved into
   * an InstancedMesh (which otherwise drops the GLB parent transforms).
   */
  meshLocalMatrix: THREE.Matrix4;
}

/** Logical ornament instance — spans 1+ InstanceGroup entries */
interface OrnamentRecord {
  id: string;                // unique key (beaconKey or storageKey)
  ornamentPath: string;
  beaconKey: string;
  beaconPos: THREE.Vector3;
  rotation: THREE.Euler;
  /** Index within each InstanceGroup's InstancedMesh for this ornament */
  instances: { group: InstanceGroup; instanceId: number }[];
  visible: boolean;
  storedInBox: boolean;
  /** String node offset baked into position (for Bezier hanging strings) */
  stringOffset: THREE.Vector3;
}

interface OrnamentRegistry {
  groups: InstanceGroup[];
  /** All ornament records keyed by their current id (beaconKey or storageKey) */
  ornaments: Map<string, OrnamentRecord>;
  /** Reverse lookup: InstancedMesh → (instanceId → ornament id) */
  reverseLookup: Map<THREE.InstancedMesh, Map<number, string>>;
}

interface SceneProps {
  /** Path to the currently selected tree GLB model */
  treeModelPath?: string;
  /** Tree color — applied to foliage materials */
  treeColor?: string;

  /** Light mode: 'on' = steady, 'blink' = alternating curves, 'off' = no emission */
  lightMode?: 'on' | 'blink' | 'off';
  /** Ornament config: each entry has a GLB path and how many to place */
  ornamentConfig?: { path: string; qty: number }[];
  /** Rearrange mode: user can click-to-pick and click-to-place ornaments */
  rearrangeMode?: boolean;
  /** HDRI environment map path */
  hdriPath?: string;
  /** Path to a static ornament GLB (e.g. bead_string) — loaded at model origin, not movable */
  beadStringPath?: string;
  /** Path to a placement preset JSON (admin-saved default positions) */
  placementPresetPath?: string;
  /** Ref for imperative storage actions (store/retrieve ornaments) */
  actionsRef?: React.MutableRefObject<SceneActions | null>;
  /** Called when storage contents change */
  onStorageChange?: (items: StoredOrnamentInfo[]) => void;
  /** Called when an ornament is picked/unpicked in rearrange mode */
  onPickStateChange?: (hasPick: boolean) => void;
  /** Front-only mode: restrict ornaments to front 3 quintants (0°, 72°, 144°) */
  frontOnly?: boolean;
  /** Light layers — one per cart row (committed) plus an optional trailing preview layer.
   *  Each layer is scattered independently and stacks visually on the tree. */
  lightLayers?: LightLayer[];
}

/** A single light layer: scatter `bulbCount` emissive bulbs cycling through `palette`. */
export type LightLayer = {
  /** Stable identifier (cart-uid or 'preview') — used for React-equivalent layer tracking */
  layerId: string;
  /** Which light product this layer is (1-5). Currently unused at render time but kept for future per-product visuals. */
  lightId: number;
  /** How many bulbs to scatter for this layer */
  bulbCount: number;
  /** Emissive palette — round-robin assigned per bulb (i % palette.length) */
  palette: string[];
}

// ---------- Helpers ----------

// Shadows disabled for performance

/** Dispose all geometries and materials inside a group */
function disposeGroup(group: THREE.Object3D) {
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else {
        mesh.material?.dispose();
      }
    }
  });
}

// Shared loader instance (reused across loads, has built-in cache)
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

// Shared ornament normal map
const textureLoader = new THREE.TextureLoader();
const ornamentNormalMap = textureLoader.load('/models/textures/glitter_normal.jpeg');
ornamentNormalMap.wrapS = THREE.RepeatWrapping;
ornamentNormalMap.wrapT = THREE.RepeatWrapping;
ornamentNormalMap.repeat.set(3.5, 3.5);

// Dark material used to hide non-emissive objects during bloom pass
const darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });

// Gray sphere markers for rearrange-mode spot positions
const spotMarkerGeo = new THREE.SphereGeometry(0.024, 12, 12);
const spotMarkerMat = new THREE.MeshBasicMaterial({
  color: 0x999999,
  transparent: true,
  opacity: 0.85,
  depthTest: true,
});

// Storage key prefix for ornaments stored via the UI panel
const STORAGE_KEY_PREFIX = '__storage_';

/**
 * Return the quintant index (1–5) for a beacon in model-local space.
 * Quintants are 72° sectors: Q1 centered at 0°, Q2 at 72°, Q3 at 144°, Q4 at 216°, Q5 at 288°.
 * "Front 3" = quintants 1, 2, 5 (the three sectors facing the default camera at +Z).
 * Wait — user said "consecutive" 1,2,3 (0°,72°,144°). We'll define front as Q1–Q3.
 */
function beaconQuintant(p: THREE.Vector3): number {
  let angle = Math.atan2(p.x, p.z); // angle from +Z axis, CW positive
  if (angle < 0) angle += 2 * Math.PI;
  // Each quintant spans 72° (π/2.5 rad). Offset by half-sector so Q1 is centered at 0°.
  const sector = Math.floor(((angle + Math.PI / 5) % (2 * Math.PI)) / (2 * Math.PI / 5));
  return sector + 1; // 1-based
}

/** Check if a beacon is in the front 3 quintants (Q1=0°, Q2=72°, Q3=144°).
 *  Used for trees with 5-arm radial branch layout (e.g. fishbone). */
function isFrontQuintant(p: THREE.Vector3): boolean {
  const q = beaconQuintant(p);
  return q <= 3;
}

/** Check if a beacon is in the front-half hemisphere (z >= 0).
 *  Used for trees with 4-arm radial branch layout (e.g. ultimate_tree_v2),
 *  where "front 3 of 5 quintants" mis-aligns with the actual 4-arm geometry. */
function isFrontQuadrant(p: THREE.Vector3): boolean {
  return p.z >= 0;
}

/** Router: pick the right front-check helper based on the active tree model.
 *  - fishbone* → quintant (5-arm tree)
 *  - everything else (incl. ultimate_tree_v2*) → quadrant (4-arm tree) */
function isFrontForTree(p: THREE.Vector3, treeModelPath?: string): boolean {
  if (treeModelPath && treeModelPath.includes('fishbone')) return isFrontQuintant(p);
  return isFrontQuadrant(p);
}

/** Stable string key for a beacon position (rounded to avoid float drift) */
function beaconKey(v: THREE.Vector3): string {
  return `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
}

// Shader that additively blends bloom texture over the base scene
const bloomCompositeShader = {
  uniforms: {
    baseTexture: { value: null as THREE.Texture | null },
    bloomTexture: { value: null as THREE.Texture | null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D baseTexture;
    uniform sampler2D bloomTexture;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(baseTexture, vUv);
      vec4 bloom = texture2D(bloomTexture, vUv);
      gl_FragColor = base + bloom;
    }
  `,
};

/**
 * Extract beacon positions from a loaded tree GLB.
 * Beacons are objects whose name starts with "Plane".
 * The quarter-tree beacons are rotated ×4 (0°, 90°, 180°, 270°) to fill the full tree.
 * Beacon meshes are hidden. Returns positions in model-local space.
 */
/**
 * Extract beacon positions from a loaded tree GLB and mirror ×4 for the full tree.
 * Beacons are Plane* objects. Positions are returned in the model's local coordinate
 * system (before any Scene.tsx scale/position transforms), matching the space where
 * branch clones are rotated. The caller must place ornaments as children of the model
 * or account for the model's transform.
 */
function extractBeaconPositions(model: THREE.Object3D): THREE.Vector3[] {
  const quarterPositions: THREE.Vector3[] = [];

  // Collect beacon positions in model-local space by walking up to model root
  model.updateMatrixWorld(true);
  const modelMatInv = new THREE.Matrix4().copy(model.matrixWorld).invert();

  model.traverse((child) => {
    if (child.name.startsWith('Plane') || child.name.startsWith('spot')) {
      const worldPos = new THREE.Vector3();
      child.getWorldPosition(worldPos);
      // Convert to model-local space (raw GLB coordinates)
      worldPos.applyMatrix4(modelMatInv);
      quarterPositions.push(worldPos);
      // Visibility controlled by showBeacons prop via useEffect
    }
  });

  // Beacons are already cloned ×4 in the model loading step (for fishbone trees),
  // so quarterPositions actually contains ALL beacon positions (original + clones).
  return quarterPositions;
}

/** Create the shared silver override material for instanced ornaments */
function createSilverMaterial(hasUVs: boolean): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#e5e7e7'),
    metalness: 0.75,
    roughness: 0.087,
    envMapIntensity: 1.0,
    emissive: new THREE.Color('#000000'),
    emissiveIntensity: 1.0,
    side: THREE.DoubleSide,
    clearcoat: 1.0,
    clearcoatRoughness: 1.0,
    ior: 2.33,
    specularIntensity: 1.0,
  });
  if (hasUVs) {
    mat.normalMap = ornamentNormalMap;
    mat.normalScale.set(0.6, -0.6);
  }
  return mat;
}

/** Compute the string-node offset for an ornament model (Bezier hanging string) */
function computeStringOffset(srcModel: THREE.Group): THREE.Vector3 {
  let stringNode: THREE.Object3D | null = null;
  srcModel.traverse((child) => {
    if (!stringNode && (child.name.startsWith('Bézier') || child.name.startsWith('BezierCurve') || child.name.startsWith('Bezier'))) {
      stringNode = child;
    }
  });
  if (!stringNode) return new THREE.Vector3();
  const stringOrigin = new THREE.Vector3();
  (stringNode as THREE.Object3D).getWorldPosition(stringOrigin);
  const modelWorldPos = new THREE.Vector3();
  srcModel.getWorldPosition(modelWorldPos);
  return stringOrigin.clone().sub(modelWorldPos);
}

/** Compose an instance matrix for an ornament at a beacon position */
/**
 * Compose the cumulative local transform from `node` up to (but not including)
 * `root`. The resulting matrix maps points in `node`'s local space into `root`'s
 * local space — i.e., it captures every scale/rotation/translation baked into
 * the GLB hierarchy above the mesh. Needed because InstancedMesh ignores any
 * parent transforms — they must be baked into each per-instance matrix instead.
 */
function getLocalToRootMatrix(node: THREE.Object3D, root: THREE.Object3D): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  let n: THREE.Object3D | null = node;
  while (n && n !== root) {
    n.updateMatrix();
    m.premultiply(n.matrix);
    n = n.parent;
  }
  return m;
}

function composeOrnamentMatrix(
  beaconPos: THREE.Vector3,
  rotation: THREE.Euler,
  stringOffset: THREE.Vector3,
  modelMatrixWorld: THREE.Matrix4,
  ornGroup: THREE.Group,
): THREE.Matrix4 {
  const worldPos = beaconPos.clone().applyMatrix4(modelMatrixWorld);
  const localPos = ornGroup.worldToLocal(worldPos);
  // Apply string offset
  localPos.sub(stringOffset);
  const mat4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion().setFromEuler(rotation);
  mat4.compose(localPos, quat, new THREE.Vector3(1, 1, 1));
  return mat4;
}

/** Seeded shuffle (Fisher-Yates with mulberry32 PRNG) */
function seededShuffle<T>(arr: T[], seed: number = 42): T[] {
  const result = [...arr];
  let s = seed;
  const rand = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ---------- Component ----------
export default function Scene({
  treeModelPath,
  treeColor = '#2d5a27',

  lightMode = 'on',
  ornamentConfig = [],
  rearrangeMode = false,
  hdriPath = '/models/hdri/brown_photostudio_02_1k.exr',
  beadStringPath,
  placementPresetPath,
  actionsRef,
  onStorageChange,
  onPickStateChange,
  frontOnly = false,
  lightLayers = [],
}: SceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  // Refs to mutable scene objects so we can update them without re-creating the scene
  const sceneRef = useRef<THREE.Scene | null>(null);
  const treeGroupRef = useRef<THREE.Group>(new THREE.Group());
  const loadedModelRef = useRef<THREE.Group | null>(null);
  /** Two emissive-bulb groups (A and B) for alternating blink. */
  const treeLightGroupsRef = useRef<THREE.InstancedMesh[]>([]);
  /** Active blink interval (cleared on rerun / unmount). */
  const blinkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** World-space AABB of the loaded env.glb — used to clamp camera inside the room. */
  const envBoxRef = useRef<THREE.Box3 | null>(null);
  const ornamentGroupRef = useRef<THREE.Group>(new THREE.Group());
  // Cache loaded ornament GLTF scenes keyed by path
  const ornamentCacheRef = useRef<Map<string, THREE.Group>>(new Map());
  // Instanced ornament registry
  const ornRegistryRef = useRef<OrnamentRegistry | null>(null);
  const guiRef = useRef<GUI | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const dirLightRef = useRef<THREE.DirectionalLight | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animFrameRef = useRef<number>(0);
  const clockRef = useRef(new THREE.Clock());
  const [treeReady, setTreeReady] = useState(0); // bumped when tree model finishes loading
  const [loadProgress, setLoadProgress] = useState<number | 'indeterminate' | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beadStringGroupRef = useRef<THREE.Group | null>(null);

  // ---- Rearrange mode state ----
  const rearrangeRef = useRef({
    active: false,
    /** Temp highlight clone (only exists while an ornament is picked) */
    pickedOrnament: null as THREE.Object3D | null,
    /** Registry record ID of the currently picked ornament */
    pickedRecordId: null as string | null,
    pickedSourceBeacon: null as THREE.Vector3 | null,
    // Map: beacon position key → dummy object (tracks occupied spots for spot markers)
    beaconOrnamentMap: new Map<string, THREE.Object3D>(),
    // All beacon positions (model-local space)
    allBeacons: [] as THREE.Vector3[],
    // Spot marker meshes for visual feedback
    spotMarkers: [] as THREE.Mesh[],
    // Storage: storageKey set (records live in registry)
    storageKeys: new Set<string>(),
    storageCounter: 0,
  });
  const showSpotMarkersRef = useRef<(() => void) | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());

  // ---- Initial scene setup (runs once) ----
  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      100,
    );
    camera.position.set(-1.4, 0.5, 1.2);
    cameraRef.current = camera;

    // Renderer — prefer discrete GPU, cap pixel ratio for perf
    const isMobile = /Mobi|Android/i.test(navigator.userAgent);
    const renderer = new THREE.WebGLRenderer({
      antialias: !isMobile,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // needed for canvas.toDataURL() screenshot capture
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ---- Selective bloom post-processing ----
    // Bloom composer: renders scene with non-emissive objects blacked out.
    // Use MSAA + HalfFloat render target to eliminate sub-pixel aliasing flicker
    // on small emissive meshes (tree lights) when the camera moves.
    const bloomRT = new THREE.WebGLRenderTarget(
      container.clientWidth,
      container.clientHeight,
      {
        type: THREE.HalfFloatType,
        samples: isMobile ? 0 : 4,
      },
    );
    const bloomComposer = new EffectComposer(renderer, bloomRT);
    bloomComposer.renderToScreen = false;
    bloomComposer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.8,  // strength
      1.0,   // radius
      0.0,   // threshold
    );
    bloomComposer.addPass(bloomPass);

    composerRef.current = bloomComposer;
    bloomPassRef.current = bloomPass;

    // Fullscreen quad to overlay bloom additively
    const bloomOverlayMat = new THREE.ShaderMaterial({
      uniforms: {
        bloomTexture: { value: null },
      },
      vertexShader: bloomCompositeShader.vertexShader,
      fragmentShader: /* glsl */ `
        uniform sampler2D bloomTexture;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(bloomTexture, vUv);
        }
      `,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    });
    const bloomOverlayQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      bloomOverlayMat,
    );
    const bloomOverlayScene = new THREE.Scene();
    bloomOverlayScene.add(bloomOverlayQuad);
    const bloomOverlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Store for animation loop
    const bloomState = { bloomComposer, bloomOverlayScene, bloomOverlayCamera, bloomOverlayMat };
    const materialCache = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.target.set(0, 0.65, 0);
    controls.minDistance = 1.5;
    controls.maxDistance = 4;
    controls.minPolarAngle = Math.PI * 7 / 36;   // 35°
    controls.maxPolarAngle = Math.PI * 115 / 180;   // 115° (loosened so camera can dip to floor; AABB clamp does hard enforcement)
    controlsRef.current = controls;

    // Clamp camera inside env.glb AABB so it can't pass through walls/floor.
    // envBoxRef is populated when env.glb finishes loading.
    const WALL_BUFFER = 0.10;  // 10cm clearance from walls/ceiling
    const FLOOR_BUFFER = 0.05; // 5cm clearance above floor
    controls.addEventListener('change', () => {
      const box = envBoxRef.current;
      if (!box) return;
      const p = camera.position;
      if (p.x < box.min.x + WALL_BUFFER) p.x = box.min.x + WALL_BUFFER;
      if (p.x > box.max.x - WALL_BUFFER) p.x = box.max.x - WALL_BUFFER;
      if (p.y < box.min.y + FLOOR_BUFFER) p.y = box.min.y + FLOOR_BUFFER;
      if (p.y > box.max.y - WALL_BUFFER) p.y = box.max.y - WALL_BUFFER;
      if (p.z < box.min.z + WALL_BUFFER) p.z = box.min.z + WALL_BUFFER;
      if (p.z > box.max.z - WALL_BUFFER) p.z = box.max.z - WALL_BUFFER;
    });

    // ---- HDRI Environment (loaded via separate useEffect) ----

    // ---- Directional Light ----
    {
      const dirLight = new THREE.DirectionalLight(new THREE.Color('#ffffff'), 6.5);
      dirLight.position.set(-0.9, 20, 3.2);
      // Need intensity > 0 so MeshStandardMaterial floors (env.glb) get a real lit/unlit ratio.
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.set(2048, 2048);
      dirLight.shadow.camera.near = 0.5;
      dirLight.shadow.camera.far = 30;
      // Frustum sized to cover tree + env floor area (env is ~ a few meters across)
      dirLight.shadow.camera.left = -5;
      dirLight.shadow.camera.right = 5;
      dirLight.shadow.camera.top = 5;
      dirLight.shadow.camera.bottom = -5;
      dirLight.shadow.bias = -0.0005;
      dirLight.shadow.radius = 4; // soft edge
      scene.add(dirLight);
      dirLightRef.current = dirLight;
    }

    // ---- Tree group ----
    const treeGroup = treeGroupRef.current;
    treeGroup.position.y = 0;
    scene.add(treeGroup);

    // ---- Ornament group (child of tree group so it moves/scales with the tree) ----
    const ornGroup = ornamentGroupRef.current;
    treeGroup.add(ornGroup);

    // Shadow-receiving ground plane (transparent — only darkens where shadow falls)
    {
      const groundGeo = new THREE.PlaneGeometry(20, 20);
      const groundMat = new THREE.ShadowMaterial({ opacity: 0.25 });
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = 0;
      ground.receiveShadow = true;
      scene.add(ground);
    }

    // ---- Animation loop ----
    const clock = clockRef.current;
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();

      // Pass 1: Render bloom — swap non-emissive materials to black
      const prevBg = scene.background;
      const prevEnv = scene.environment;
      scene.background = null;
      scene.environment = null;
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (mat.isMeshStandardMaterial && mat.emissiveIntensity > 0 && mat.emissive && mat.emissive.getHSL({ h: 0, s: 0, l: 0 }).l > 0) {
            // Emissive — keep for bloom
          } else {
            materialCache.set(mesh, mesh.material);
            mesh.material = darkMaterial;
          }
        }
      });
      // Disable tone mapping for bloom pass (avoid double tone mapping)
      const prevToneMapping = renderer.toneMapping;
      renderer.toneMapping = THREE.NoToneMapping;
      bloomState.bloomComposer.render();
      renderer.toneMapping = prevToneMapping;

      // Update bloom texture uniform to match composer's current read buffer
      bloomState.bloomOverlayMat.uniforms.bloomTexture.value =
        bloomState.bloomComposer.readBuffer.texture;

      // Restore materials and environment
      materialCache.forEach((mat, mesh) => { mesh.material = mat; });
      materialCache.clear();
      scene.background = prevBg;
      scene.environment = prevEnv;

      // Pass 2: Render normal scene, then overlay bloom additively
      renderer.render(scene, camera);
      renderer.autoClear = false;
      renderer.render(bloomState.bloomOverlayScene, bloomState.bloomOverlayCamera);
      renderer.autoClear = true;
    };
    animate();

    // ---- Resize ----
    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      bloomState.bloomComposer.setSize(w, h);
    });
    resizeObserver.observe(container);

    // ---- Cleanup ----
    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(animFrameRef.current);
      container.removeChild(renderer.domElement);
      renderer.dispose();
      disposeGroup(treeGroup);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Load HDRI environment when hdriPath changes ----
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !hdriPath) return;
    new EXRLoader().load(hdriPath, (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      // Dispose previous environment texture
      if (scene.environment) scene.environment.dispose();
      scene.environment = texture;
      scene.environmentIntensity = 0.88;
    });
  }, [hdriPath]);

  // ---- Load GLB model when treeModelPath changes ----
  useEffect(() => {
    if (!treeModelPath) return;
    const treeGroup = treeGroupRef.current;
    console.info('[tree] effect fired for:', treeModelPath);

    // Clear any previous fade timer and show loading bar
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    setLoadProgress(0);

    // Stale-callback guard: GLB loads are async + uncached on first hit, cached on subsequent.
    // When user toggles model A → B → A, browser cache makes the second A load complete first
    // while B is still inflight. Without this flag, B's callback then overwrites A in scene.
    let cancelled = false;
    gltfLoader.load(
      treeModelPath,
      (gltf) => {
        if (cancelled) {
          console.info('[tree] load cancelled for:', treeModelPath);
          disposeGroup(gltf.scene);
          return;
        }
        console.info('[tree] load applied for:', treeModelPath);
        // Briefly show 100% then fade out
        setLoadProgress(100);
        fadeTimerRef.current = setTimeout(() => setLoadProgress(null), 400);
        // Remove previously loaded model
        if (loadedModelRef.current) {
          disposeGroup(loadedModelRef.current);
          treeGroup.remove(loadedModelRef.current);
        }

        const model = gltf.scene;

        // Use original GLB scale (models are pre-scaled in Blender)
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());

        // Center horizontally, sit on ground
        model.position.x = -center.x;
        model.position.z = -center.z;
        model.position.y = -box.min.y;

        // For treeV3test: clone "Cube" and "Cube001" at 90° intervals
        if (treeModelPath.includes('treeV3test') && !treeModelPath.includes('treeV3test2')) {
          const rotations = [Math.PI / 2, Math.PI, Math.PI * 3 / 2]; // 90°, 180°, 270°
          const nodesToClone = ['Cube', 'Cube001'];
          const clones: THREE.Object3D[] = [];
          model.traverse((child) => {
            if (nodesToClone.includes(child.name)) {
              rotations.forEach((angle, idx) => {
                const clone = child.clone(true);
                clone.name = `${child.name}_clone_${idx}`;
                clone.rotateY(angle);
                clones.push(clone);
              });
            }
          });
          clones.forEach((c) => model.add(c));
        }

        // For treeV3test2/treeV3test3: clone "Cube" and "Cube001" at 90° intervals (keep originals)
        if (treeModelPath.includes('treeV3test2') || treeModelPath.includes('treeV3test3')) {
          const rotations = [Math.PI / 2, Math.PI, Math.PI * 3 / 2]; // 90°, 180°, 270°
          const nodesToClone = ['Cube', 'Cube001'];
          const clones: THREE.Object3D[] = [];
          model.traverse((child) => {
            if (nodesToClone.includes(child.name)) {
              rotations.forEach((angle, idx) => {
                const clone = child.clone(true);
                clone.name = `${child.name}_clone_${idx}`;
                clone.rotateY(angle);
                clones.push(clone);
              });
            }
          });
          clones.forEach((c) => model.add(c));
        }

        // For fishbone_plane_work: clone branches + beacon planes at 90° intervals
        if (treeModelPath.includes('fishbone_plane_work')) {
          const rotations = [Math.PI / 2, Math.PI, Math.PI * 3 / 2];
          // Clone branch groups (Three.js strips dots from GLB names: Cube.001 → Cube001)
          const nodesToClone = ['Cube', 'Cube001'];
          const clones: THREE.Object3D[] = [];
          model.traverse((child) => {
            if (nodesToClone.includes(child.name)) {
              rotations.forEach((angle, idx) => {
                const clone = child.clone(true);
                clone.name = `${child.name}_clone_${idx}`;
                clone.rotateY(angle);
                clones.push(clone);
              });
            }
          });
          // Clone all Plane beacons at each rotation (they're top-level, not children of Cube)
          const beaconNodes: THREE.Object3D[] = [];
          model.traverse((child) => {
            if (child.name.startsWith('Plane')) {
              beaconNodes.push(child);
            }
          });
          beaconNodes.forEach((beacon) => {
            rotations.forEach((angle, idx) => {
              const clone = beacon.clone(true);
              clone.name = `${beacon.name}_rot_${idx}`;
              // Rotate position around Y axis
              const pos = clone.position.clone();
              const cos = Math.cos(angle);
              const sin = Math.sin(angle);
              clone.position.set(
                pos.x * cos + pos.z * sin,
                pos.y,
                -pos.x * sin + pos.z * cos,
              );
              clones.push(clone);
            });
          });
          clones.forEach((c) => model.add(c));
        }

        // For fishbone_150_ultimate: 5-instance tree (72° rotations)
        // Clone only 'tree' node + spot beacons.
        if (treeModelPath.includes('fishbone_150_ultimate')) {
          const rotations = [
            (2 * Math.PI) / 5,      // 72°
            (4 * Math.PI) / 5,      // 144°
            (6 * Math.PI) / 5,      // 216°
            (8 * Math.PI) / 5,      // 288°
          ];
          const clones: THREE.Object3D[] = [];

          // Clone 'tree' node at each rotation
          model.traverse((child) => {
            if (child.name === 'tree') {
              rotations.forEach((angle, idx) => {
                const clone = child.clone(true);
                clone.name = `${child.name}_clone_${idx}`;
                clone.rotateY(angle);
                clones.push(clone);
              });
            }
          });

          // Clone spot beacons at each rotation
          const beaconNodes: THREE.Object3D[] = [];
          model.traverse((child) => {
            if (child.name.startsWith('spot')) {
              beaconNodes.push(child);
            }
          });
          beaconNodes.forEach((beacon) => {
            rotations.forEach((angle, idx) => {
              const clone = beacon.clone(true);
              clone.name = `${beacon.name}_rot_${idx}`;
              const pos = clone.position.clone();
              const cos = Math.cos(angle);
              const sin = Math.sin(angle);
              clone.position.set(
                pos.x * cos + pos.z * sin,
                pos.y,
                -pos.x * sin + pos.z * cos,
              );
              clones.push(clone);
            });
          });
          clones.forEach((c) => model.add(c));

          // Reassign all meshes using Material.004 to the shared 'Material' (PE's material)
          // so lil-gui changes to 'Material' affect Cube.009 geometry too.
          let peMaterial: THREE.Material | null = null;
          model.traverse((child) => {
            if (child.name === 'PE' && (child as THREE.Mesh).isMesh) {
              peMaterial = (child as THREE.Mesh).material as THREE.Material;
            }
          });
          if (peMaterial) {
            model.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                const mat = mesh.material as THREE.Material;
                if (mat.name === 'Material.004') {
                  mesh.material = peMaterial!;
                }
              }
            });
          }

          // Apply tuned defaults for Material.001
          model.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
              if (mat.isMeshStandardMaterial && mat.name === 'Material.001') {
                mat.color.set(0x042b03);
                mat.metalness = 0.24;
                mat.roughness = 0.78;
                mat.envMapIntensity = 1;
                mat.needsUpdate = true;
              }
            }
          });
        }

        // For ultimate_tree_v2: 4-quadrant tree (90° rotations).
        // Clone every `branch.NNN` node and every `spot.NNN` beacon at 90°, 180°, 270°.
        // NOTE: branch.NNN nodes have non-identity quaternions baked from Blender, so
        // `rotateY` (local) would spin them around the wrong axis. Pre-multiply the
        // quaternion with a world-Y rotation so each branch swings around world Y.
        if (treeModelPath.includes('ultimate_tree_v2') || treeModelPath.includes('fishboneTree')) {
          const rotations = [Math.PI / 2, Math.PI, Math.PI * 3 / 2];
          const branchRe = /^branch\d{3}$/;
          const yAxis = new THREE.Vector3(0, 1, 0);
          const clones: THREE.Object3D[] = [];

          // Clone branch.NNN nodes at each rotation (rotate around world Y)
          const branchNodes: THREE.Object3D[] = [];
          model.traverse((child) => {
            if (branchRe.test(child.name)) branchNodes.push(child);
          });
          branchNodes.forEach((branch) => {
            rotations.forEach((angle, idx) => {
              const clone = branch.clone(true);
              clone.name = `${branch.name}_rot_${idx}`;
              const qy = new THREE.Quaternion().setFromAxisAngle(yAxis, angle);
              clone.quaternion.premultiply(qy);
              // Position is on the Y axis (x=z=0), but rotate it anyway for robustness
              const pos = clone.position.clone();
              const cos = Math.cos(angle);
              const sin = Math.sin(angle);
              clone.position.set(
                pos.x * cos + pos.z * sin,
                pos.y,
                -pos.x * sin + pos.z * cos,
              );
              clones.push(clone);
            });
          });

          // Clone spot beacons at each rotation (rotate position around Y)
          const beaconNodes: THREE.Object3D[] = [];
          model.traverse((child) => {
            if (child.name.startsWith('spot')) beaconNodes.push(child);
          });
          beaconNodes.forEach((beacon) => {
            rotations.forEach((angle, idx) => {
              const clone = beacon.clone(true);
              clone.name = `${beacon.name}_rot_${idx}`;
              const pos = clone.position.clone();
              const cos = Math.cos(angle);
              const sin = Math.sin(angle);
              clone.position.set(
                pos.x * cos + pos.z * sin,
                pos.y,
                -pos.x * sin + pos.z * cos,
              );
              clones.push(clone);
            });
          });
          clones.forEach((c) => model.add(c));
        }

        // For sketchTree: 4-quadrant tree (same pattern as ultimate_tree_v2).
        // Clone every `sketchBranch[.NNN]` node and every `spot.NNN` beacon at 90°, 180°, 270°.
        if (treeModelPath.includes('sketchTree')) {
          const rotations = [Math.PI / 2, Math.PI, Math.PI * 3 / 2];
          // Blender may export "sketchBranch.001" as either "sketchBranch.001" or "sketchBranch001"
          const sketchBranchRe = /^sketchBranch(\.\d{3}|\d{3})?$/;
          const yAxis = new THREE.Vector3(0, 1, 0);
          const clones: THREE.Object3D[] = [];

          // Clone sketchBranch nodes at each rotation (rotate around world Y)
          const branchNodes: THREE.Object3D[] = [];
          model.traverse((child) => {
            if (sketchBranchRe.test(child.name)) branchNodes.push(child);
          });
          branchNodes.forEach((branch) => {
            rotations.forEach((angle, idx) => {
              const clone = branch.clone(true);
              clone.name = `${branch.name}_rot_${idx}`;
              const qy = new THREE.Quaternion().setFromAxisAngle(yAxis, angle);
              clone.quaternion.premultiply(qy);
              const pos = clone.position.clone();
              const cos = Math.cos(angle);
              const sin = Math.sin(angle);
              clone.position.set(
                pos.x * cos + pos.z * sin,
                pos.y,
                -pos.x * sin + pos.z * cos,
              );
              clones.push(clone);
            });
          });

          // Clone spot beacons at each rotation (rotate position around Y)
          const beaconNodes: THREE.Object3D[] = [];
          model.traverse((child) => {
            if (child.name.startsWith('spot')) beaconNodes.push(child);
          });
          beaconNodes.forEach((beacon) => {
            rotations.forEach((angle, idx) => {
              const clone = beacon.clone(true);
              clone.name = `${beacon.name}_rot_${idx}`;
              const pos = clone.position.clone();
              const cos = Math.cos(angle);
              const sin = Math.sin(angle);
              clone.position.set(
                pos.x * cos + pos.z * sin,
                pos.y,
                -pos.x * sin + pos.z * cos,
              );
              clones.push(clone);
            });
          });
          clones.forEach((c) => model.add(c));
        }

        // Light scatter runs in its own effect (see "Emissive lights" useEffect below)
        // so changes to selectedLight / lightCount don't require a full tree reload.

        // Re-center after any cloning to ensure consistent origin
        // Reset position first so bbox is in local space, then re-center
        {
          model.position.set(0, 0, 0);
          const box2 = new THREE.Box3().setFromObject(model);
          const center2 = box2.getCenter(new THREE.Vector3());
          model.position.x = -center2.x;
          model.position.z = -center2.z;
          model.position.y = -box2.min.y;
        }

        // Load default environment model for every scene
        gltfLoader.load('/models/env/env.glb', (envGltf) => {
          const envModel = envGltf.scene;
          envModel.position.set(0, 0, 0);
          envModel.name = 'defaultEnv';
          envModel.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              child.receiveShadow = true;
            }
          });
          model.add(envModel);
          // Bake parent transforms into world matrices so the AABB is in world space,
          // then capture the env bounding box — drives the camera clamp.
          model.updateMatrixWorld(true);
          envBoxRef.current = new THREE.Box3().setFromObject(envModel);
        });

        // Tree casts shadows onto the ground plane (does not receive — keeps cost low)
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            child.castShadow = true;
          }
        });

        // Tag foliage materials ONCE at load time so the treeColor effect can find them
        // by intent rather than by current hue. Without this, switching to a non-greenish
        // color (e.g. 스노우 white) drops the material out of the hue gate, and the next
        // color change has nothing to recolor → tree stays the previous color forever.
        const hsl = { h: 0, s: 0, l: 0 };
        model.traverse((child) => {
          if (!(child as THREE.Mesh).isMesh) return;
          const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
          const mats = Array.isArray(mat) ? mat : [mat];
          mats.forEach((m) => {
            if (!m?.color) return;
            m.color.getHSL(hsl);
            if (hsl.h > 0.2 && hsl.h < 0.45) {
              m.userData.isFoliage = true;
            }
          });
        });

        // Twotone fishbone accent override — the authored `Material.005` baseColor is
        // nearly identical to the base `Material` (#0d1104 vs #030d03), so the intended
        // two-tone effect is imperceptible. Hard-set Material.005 to a brighter olive
        // (#5d8132) so the 믹스 투톤 variant actually reads as multi-tone in the viewport.
        // Scoped by `twotone` substring → green variants untouched.
        // (Three.js GLTFLoader may either preserve or strip the dot from material names,
        // so match both 'Material.005' and 'Material005'.)
        if (treeModelPath.includes('twotone')) {
          const accentColor = new THREE.Color('#5d8132');
          model.traverse((child) => {
            if (!(child as THREE.Mesh).isMesh) return;
            const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
            const mats = Array.isArray(mat) ? mat : [mat];
            mats.forEach((m) => {
              if (!m?.color) return;
              if (m.name === 'Material.005' || m.name === 'Material005') {
                m.color.copy(accentColor);
                m.needsUpdate = true;
                // Ensure this accent doesn't get swept up by the foliage recolor effect later
                m.userData.isFoliage = false;
              }
            });
          });
        }

        treeGroup.add(model);
        loadedModelRef.current = model;
        setTreeReady((n) => n + 1); // signal ornament effect to re-run
      },
      (event) => {
        if (event.lengthComputable && event.total > 0) {
          setLoadProgress(Math.round((event.loaded / event.total) * 100));
        } else {
          setLoadProgress('indeterminate');
        }
      },
      (error) => {
        if (cancelled) return;
        console.error('Failed to load tree model:', error);
        setLoadProgress(null);
      },
    );
    return () => { cancelled = true; };
  }, [treeModelPath]);

  // ---- Emissive lights scatter (Tree 1 / Tree 4, ultimate_tree_v2 family) ----
  // Re-runs whenever any layer (cart commit or preview) changes. Each layer is scattered
  // independently and stacks on top of the others — supports persistence (committed lights
  // stay visible while a new preview is being configured) and multi-product layering.
  useEffect(() => {
    const model = loadedModelRef.current;
    if (!model) return;

    // Remove existing light groups (if any) — disposes geometry + material per mesh
    treeLightGroupsRef.current.forEach((old) => {
      model.remove(old);
      old.geometry.dispose();
      if (Array.isArray(old.material)) old.material.forEach((m) => m.dispose());
      else (old.material as THREE.Material).dispose();
    });
    treeLightGroupsRef.current = [];

    // Gate: ultimate_tree_v2 + sketchTree families; require ≥1 layer with nonzero count.
    // "ultimate" gate matches both the legacy ultimate_tree_v2[_test].glb and the new
    // fishboneTree_*.glb family (same 4-quadrant Blender source, renamed per new convention).
    const isUltimate = (treeModelPath?.includes('ultimate_tree_v2') || treeModelPath?.includes('fishboneTree')) ?? false;
    const isSketch = treeModelPath?.includes('sketchTree') ?? false;
    if (!treeModelPath || (!isUltimate && !isSketch)) return;
    const renderableLayers = lightLayers.filter((l) => l.bulbCount > 0);
    if (renderableLayers.length === 0) return;
    // Aggregate count drives the global oversample/safety budget (clusters/PER_BRANCH math).
    const totalLightCount = renderableLayers.reduce((s, l) => s + l.bulbCount, 0);

    // Cluster discovery regex per family:
    //   - ultimate/fishbone: needle clusters live on `branchNNN3` (nested .3 sub-mesh)
    //     OR `Cube022` / `Cube022_N` (when the Blender source has Cube.022 at top level
    //     instead of nested — as in the fishboneTree_twotone* variants).
    //     Note: Three.js GLTFLoader STRIPS DOTS from node names, so `branch.001.3` →
    //     `branch0013` and `Cube.022_1` → `Cube022_1`.
    //   - sketch: scatter on any `sketchBranch*` (parent may be a Group → walk into descendants)
    const clusterRe = isUltimate
      ? /^(?:branch(?:\d{3})?3|Cube022(?:_\d+)?)$/
      : /^sketchBranch/;
    model.updateMatrixWorld(true);
    const modelInverse = new THREE.Matrix4().copy(model.matrixWorld).invert();

    // First pass: collect all matching needle clusters so we can size PER_BRANCH dynamically.
    const clusters: THREE.Mesh[] = [];
    if (isSketch) {
      // sketchTree: parent may be a Group; walk into matched parents + collect descendant meshes.
      const matchedParents: THREE.Object3D[] = [];
      model.traverse((child) => {
        if (clusterRe.test(child.name)) matchedParents.push(child);
      });
      matchedParents.forEach((parent) => {
        parent.traverse((descendant) => {
          if (descendant instanceof THREE.Mesh) clusters.push(descendant);
        });
      });
    } else {
      // ultimate/fishbone: branchNNN3 IS a Mesh, direct match.
      model.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        if (!clusterRe.test(child.name)) return;
        clusters.push(child);
      });
    }
    if (clusters.length === 0) return;

    // Bounds-derived scatter shape — auto-adapts to any tree size (120/150/180/210).
    //
    // Critical: the BBOX SOURCE differs by family because the geometry/foliage relationship
    // is fundamentally different:
    //   - sketchTree: cluster meshes ARE the visible foliage → cluster bbox is correct
    //   - fishboneTree: cluster meshes (`branchNNN3`) are JUST the needle armature, the
    //     visible alpha-textured foliage (PE_bunch / PE) extends well beyond them. Using
    //     cluster bbox here buries lights inside the geometry (original bug pre-2026-06-17).
    //     Use the FULL model bbox (minus the metal Stand) to capture visible foliage extent.
    //
    // Percentages then differ accordingly:
    //   - fishbone: BASE_R PUSHES past foliage (>100% × maxR) since maxR ≈ visible edge
    //   - sketch:   BASE_R STAYS WITHIN cluster bbox (<100% × maxR) since maxR ≈ cluster edge
    type ScatterTuning = {
      yBasePct: number;   // Y_BASE = bbox.min.y + this × fullHeight
      yTipPct: number;    // Y_TIP  = bbox.min.y + this × fullHeight
      baseRPct: number;   // BASE_R = this × maxR
      tipRPct: number;    // TIP_R  = this × maxR
      yMinKeepPct: number;// per-sample reject below this
      yMaxKeepPct: number;// per-sample reject above this
      rMaxKeepPct: number;// per-sample reject if vertex curR > this × maxR
    };
    const TUNING: ScatterTuning = isUltimate
      // baseR 1.45 × maxR pushes lights to the visible foliage edge. Was 1.30; bumped to
      // sit further outward per user feedback. Per-sample rMaxKeep loosened to 1.75 to
      // ensure even the widest vertex picks remain inside the silhouette after push.
      ? { yBasePct: 0.20, yTipPct: 0.95, baseRPct: 1.45, tipRPct: 0.32, yMinKeepPct: 0.05, yMaxKeepPct: 1.00, rMaxKeepPct: 1.75 }
      : { yBasePct: 0.05, yTipPct: 0.90, baseRPct: 0.85, tipRPct: 0.12, yMinKeepPct: 0.02, yMaxKeepPct: 0.92, rMaxKeepPct: 0.95 };

    const bbox = new THREE.Box3();
    const tmpBox = new THREE.Box3();
    const toModelM = new THREE.Matrix4();
    if (isUltimate) {
      // Full-tree bbox excluding (a) structural / non-foliage meshes (Stand, PVC pole),
      // and (b) the studio env room (`defaultEnv` group) which is added as a child of `model`
      // and would otherwise expand maxR to ~2m → scatter onto walls.
      // Captures the visible alpha-textured foliage extent — clusters alone are too narrow.
      model.traverse((child) => {
        if (!(child as THREE.Mesh).isMesh) return;
        const mesh = child as THREE.Mesh;
        // Skip anything under the env group (env walls/floor/ceiling).
        let p: THREE.Object3D | null = mesh.parent;
        while (p) {
          if (p.name === 'defaultEnv') return;
          p = p.parent;
        }
        // Skip the metal Stand (X-frame base) and PVC trunk — they're either wider than the
        // foliage (Stand) or irrelevant to the silhouette.
        const n = mesh.name;
        if (n.startsWith('Stand') || n === 'PVC' || n.startsWith('Cube.003')) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        tmpBox.copy(mesh.geometry.boundingBox!);
        toModelM.multiplyMatrices(modelInverse, mesh.matrixWorld);
        tmpBox.applyMatrix4(toModelM);
        bbox.union(tmpBox);
      });
    } else {
      for (const c of clusters) {
        if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
        tmpBox.copy(c.geometry.boundingBox!);
        toModelM.multiplyMatrices(modelInverse, c.matrixWorld);
        tmpBox.applyMatrix4(toModelM);
        bbox.union(tmpBox);
      }
    }
    const fullHeight = bbox.max.y - bbox.min.y;
    const maxR = Math.max(
      Math.abs(bbox.max.x), Math.abs(bbox.min.x),
      Math.abs(bbox.max.z), Math.abs(bbox.min.z),
    );

    const Y_BASE     = bbox.min.y + fullHeight * TUNING.yBasePct;
    const Y_TIP      = bbox.min.y + fullHeight * TUNING.yTipPct;
    const BASE_R     = maxR * TUNING.baseRPct;
    const TIP_R      = maxR * TUNING.tipRPct;
    const yMinKeep   = bbox.min.y + fullHeight * TUNING.yMinKeepPct;
    const yMaxKeep   = bbox.min.y + fullHeight * TUNING.yMaxKeepPct;
    const rMaxKeep   = maxR * TUNING.rMaxKeepPct;
    // Jitter ~3% of maxR keeps the per-bulb perturbation visually consistent across sizes
    // (ultimate@150 used 0.015 ≈ 3% × ~0.5 maxR; sketch was already 2.5%).
    const JITTER     = maxR * (isSketch ? 0.025 : 0.030);

    console.info(`[${isUltimate ? 'fishbone' : 'sketch'} lights] bounds:`, { fullHeight, maxR, Y_BASE, Y_TIP, BASE_R, TIP_R, clusters: clusters.length });

    // Dynamic over-sampling: aim for ~totalLightCount × safetyFactor candidates AFTER all filters.
    // - 360 mode (ultimate): small headroom (1.2×) for shuffle/trim variance.
    // - sketchTree adds ~15-25% per-sample rejects (y-band + outlier guards) → bump to 1.5× / 4×.
    // - Front-only: ~half the tree is rejected → bump further.
    // Layered budget: each scatter() call below produces fresh candidates up to the layer's quota,
    // so we size PER_BRANCH against the *sum* across layers — keeps any single big layer fed.
    // Clamped [12, 60] to avoid wasted work or runaway loops.
    let safetyFactor: number;
    if (frontOnly) safetyFactor = isSketch ? 4 : 3;
    else           safetyFactor = isSketch ? 1.5 : 1.2;
    const PER_BRANCH = Math.min(
      60,
      Math.max(12, Math.ceil((totalLightCount * safetyFactor) / clusters.length)),
    );

    const tmpV = new THREE.Vector3();
    const tmpPerp = new THREE.Vector3();
    const tmpUp = new THREE.Vector3(0, 1, 0);

    // Per-layer scatter: vertex pick → radial push → jitter → optional front-only filter.
    // Each call produces a fresh batch of `targetCount` positions independent of prior layers.
    const scatterPositions = (targetCount: number): THREE.Vector3[] => {
      const positions: THREE.Vector3[] = [];
      for (const child of clusters) {
        const g = child.geometry;
        const posAttr = g.attributes.position;
        if (!posAttr) continue;
        const toModel = new THREE.Matrix4().multiplyMatrices(modelInverse, child.matrixWorld);
        const pivot = new THREE.Vector3();
        const parent = child.parent;
        if (parent) {
          pivot.setFromMatrixPosition(parent.matrixWorld).applyMatrix4(modelInverse);
        }
        const vCount = posAttr.count;
        for (let i = 0; i < PER_BRANCH; i++) {
          const idx = Math.floor(Math.random() * vCount);
          tmpV.fromBufferAttribute(posAttr, idx).applyMatrix4(toModel);
          const vertex = tmpV.clone();
          const curR = Math.hypot(vertex.x, vertex.z);
          // Per-sample acceptance guards — applied uniformly across both families now that
          // bounds are bbox-derived. Kills hovering bulbs above the trimmed tip and outlier
          // wide-branch picks beyond the silhouette.
          if (vertex.y > yMaxKeep || vertex.y < yMinKeep) continue;
          if (curR > rMaxKeep) continue;
          const dir = vertex.clone().sub(pivot);
          if (dir.lengthSq() < 1e-8) dir.set(vertex.x, 0, vertex.z);
          dir.normalize();
          const y = vertex.y;
          const t = Math.min(1, Math.max(0, (y - Y_BASE) / (Y_TIP - Y_BASE)));
          const baseTargetR = BASE_R * (1 - t) + TIP_R * t;
          const DEPTH_MIN = 0.35;
          const randF = DEPTH_MIN + Math.random() * (1.0 - DEPTH_MIN);
          const targetR = baseTargetR * randF;
          const push = Math.max(0, targetR - curR);
          const finalPos = vertex.clone().addScaledVector(dir, push);
          tmpPerp.crossVectors(dir, tmpUp);
          if (tmpPerp.lengthSq() < 1e-6) tmpPerp.set(1, 0, 0);
          tmpPerp.normalize();
          const jx = (Math.random() * 2 - 1) * JITTER;
          const jy = (Math.random() * 2 - 1) * JITTER;
          const tmpPerp2 = new THREE.Vector3().crossVectors(dir, tmpPerp).normalize();
          finalPos.addScaledVector(tmpPerp, jx).addScaledVector(tmpPerp2, jy);
          if (frontOnly && !isFrontForTree(finalPos, treeModelPath)) continue;
          positions.push(finalPos);
        }
      }
      // Shuffle + trim to target
      for (let i = positions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [positions[i], positions[j]] = [positions[j], positions[i]];
      }
      if (positions.length > targetCount) positions.length = targetCount;
      return positions;
    };

    // Helper: build an InstancedMesh + its own MeshStandardMaterial for one (color, blinkGroup) bucket
    const buildGroup = (
      positions: THREE.Vector3[],
      colorHex: string,
      blinkGroup: 'A' | 'B',
      name: string,
    ): THREE.InstancedMesh | null => {
      if (positions.length === 0) return null;
      const geo = new THREE.SphereGeometry(0.003, 10, 8);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: new THREE.Color(colorHex),
        emissiveIntensity: 4.2,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, positions.length);
      mesh.name = name;
      mesh.userData.blinkGroup = blinkGroup;
      const tmpM = new THREE.Matrix4();
      const tmpS = new THREE.Vector3(1, 1, 1);
      const tmpQ = new THREE.Quaternion();
      positions.forEach((p, i) => {
        tmpM.compose(p, tmpQ, tmpS);
        mesh.setMatrixAt(i, tmpM);
      });
      mesh.instanceMatrix.needsUpdate = true;
      return mesh;
    };

    // Iterate layers: scatter independently, round-robin palette, split A/B per color, build meshes.
    // Total InstancedMeshes = Σ (layer.palette.length × 2) across all layers.
    renderableLayers.forEach((layer, layerIdx) => {
      const layerPositions = scatterPositions(layer.bulbCount);
      if (layerPositions.length === 0) return;
      const palette = layer.palette.length > 0 ? layer.palette : ['#fff5cc'];
      type Bucket = { color: string; A: THREE.Vector3[]; B: THREE.Vector3[] };
      const buckets: Bucket[] = palette.map((c) => ({ color: c, A: [], B: [] }));
      layerPositions.forEach((p, i) => {
        const bucket = buckets[i % palette.length];
        (Math.random() < 0.5 ? bucket.A : bucket.B).push(p);
      });
      buckets.forEach((bucket, idx) => {
        const meshA = buildGroup(bucket.A, bucket.color, 'A', `lights_L${layerIdx}_C${idx}_A`);
        const meshB = buildGroup(bucket.B, bucket.color, 'B', `lights_L${layerIdx}_C${idx}_B`);
        [meshA, meshB].forEach((mesh) => {
          if (!mesh) return;
          model.add(mesh);
          treeLightGroupsRef.current.push(mesh);
        });
      });
    });
  }, [treeReady, treeModelPath, lightLayers, frontOnly]);

  // ---- Update tree color on foliage materials ----
  // Uses the load-time `userData.isFoliage` tag (set during tree load) instead of a hue gate.
  // The old hue gate was stateful: after switching to a non-greenish color (e.g. 스노우),
  // the gate could never reverse the change. treeReady is in deps so newly loaded trees
  // pick up the current treeColor immediately.
  //
  // When treeColor is undefined (App passes `undefined` for variant-specific GLBs whose
  // authored materials should be preserved — e.g. fishbone twotone), skip recoloring entirely
  // so the authored multi-tone look survives.
  useEffect(() => {
    const target = loadedModelRef.current;
    if (!target || !treeColor) return;

    const color = new THREE.Color(treeColor);
    target.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
      const mats = Array.isArray(mat) ? mat : [mat];
      mats.forEach((m) => {
        if (!m?.userData?.isFoliage || !m.color) return;
        m.color.copy(color);
        m.needsUpdate = true;
      });
    });
  }, [treeColor, treeReady]);

  // ---- Toggle light emission: on / blink / off ----
  useEffect(() => {
    const model = loadedModelRef.current;
    if (!model) return;

    // Helper: set every mesh tagged with `blinkGroup === tag` to lit/unlit.
    // With multi-color palettes there can be N meshes per blink group (one per color).
    const setBlinkGroupLit = (tag: 'A' | 'B', lit: boolean) => {
      treeLightGroupsRef.current.forEach((mesh) => {
        if (mesh.userData.blinkGroup !== tag) return;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = lit ? 4.2 : 0;
        mat.needsUpdate = true;
      });
    };

    // Clear any prior blink interval before reapplying
    if (blinkIntervalRef.current) {
      clearInterval(blinkIntervalRef.current);
      blinkIntervalRef.current = null;
    }

    if (lightMode === 'off') {
      setBlinkGroupLit('A', false);
      setBlinkGroupLit('B', false);
    } else if (lightMode === 'on') {
      setBlinkGroupLit('A', true);
      setBlinkGroupLit('B', true);
    } else {
      // 'blink' — alternate A/B every 500ms
      let aLit = true;
      setBlinkGroupLit('A', aLit);
      setBlinkGroupLit('B', !aLit);
      blinkIntervalRef.current = setInterval(() => {
        aLit = !aLit;
        setBlinkGroupLit('A', aLit);
        setBlinkGroupLit('B', !aLit);
      }, 500);
    }

    return () => {
      if (blinkIntervalRef.current) {
        clearInterval(blinkIntervalRef.current);
        blinkIntervalRef.current = null;
      }
    };
  }, [lightMode, treeReady, treeModelPath, lightLayers]);

  // ---- Load static ornament (bead_string) at model origin ----
  useEffect(() => {
    const model = loadedModelRef.current;

    // Clean up previous
    if (beadStringGroupRef.current) {
      disposeGroup(beadStringGroupRef.current);
      if (beadStringGroupRef.current.parent) beadStringGroupRef.current.parent.remove(beadStringGroupRef.current);
      beadStringGroupRef.current = null;
    }

    if (!model || !beadStringPath) return;

    gltfLoader.load(beadStringPath, (gltf) => {
      if (loadedModelRef.current !== model) return;
      const beadModel = gltf.scene;
      beadModel.position.set(0, 0, 0);
      beadModel.userData._isBeadString = true;
      beadModel.userData._isStatic = true;
      model.add(beadModel);
      beadStringGroupRef.current = beadModel;
    });

    return () => {
      if (beadStringGroupRef.current) {
        disposeGroup(beadStringGroupRef.current);
        if (beadStringGroupRef.current.parent) beadStringGroupRef.current.parent.remove(beadStringGroupRef.current);
        beadStringGroupRef.current = null;
      }
    };
  }, [beadStringPath, treeReady]);

  // ---- Place ornaments on the tree (INSTANCED) ----
  useEffect(() => {
    const model = loadedModelRef.current;
    const ornGroup = ornamentGroupRef.current;

    // Dispose previous registry
    if (ornRegistryRef.current) {
      ornRegistryRef.current.groups.forEach(g => {
        g.instancedMesh.dispose();
        g.sharedMaterial.dispose();
      });
      ornRegistryRef.current = null;
    }

    if (!model || ornamentConfig.length === 0) {
      ornGroup.clear();
      return;
    }

    // Unique paths for loading
    const uniquePaths = ornamentConfig.map(c => c.path);

    // Extract beacon positions in model-local space
    const allBeacons = extractBeaconPositions(model);
    if (allBeacons.length === 0) {
      console.warn('No beacon positions found in tree model (no Plane* objects)');
      return;
    }

    const beaconLookup = new Map<string, THREE.Vector3>();
    allBeacons.forEach(p => beaconLookup.set(beaconKey(p), p));

    // ---- Load preset + ornament models ----
    const presetKey = frontOnly ? `${treeModelPath}:front` : treeModelPath;
    const presetPromise: Promise<PlacementPreset | null> = (placementPresetPath && treeModelPath)
      ? fetch(placementPresetPath)
          .then(r => r.ok ? r.json() : null)
          .then(data => data?.[presetKey] ?? null)
          .catch(() => null)
      : Promise.resolve(null);

    const loadPromises = uniquePaths.map((path) => {
      if (ornamentCacheRef.current.has(path)) {
        return Promise.resolve(ornamentCacheRef.current.get(path)!);
      }
      return new Promise<THREE.Group>((resolve, reject) => {
        gltfLoader.load(
          path,
          (gltf) => {
            ornamentCacheRef.current.set(path, gltf.scene);
            resolve(gltf.scene);
          },
          undefined,
          reject,
        );
      });
    });

    Promise.all([presetPromise, Promise.all(loadPromises)]).then(([preset, ornamentModels]) => {
      // Clear previous scene objects
      ornGroup.clear();

      const modelByPath = new Map<string, THREE.Group>();
      uniquePaths.forEach((p, i) => modelByPath.set(p, ornamentModels[i]));

      // ---- Determine all placement tuples: { ornPath, beaconPos, rotation } ----
      type PlaceTuple = { ornPath: string; pos: THREE.Vector3; rotation: [number, number, number] };
      const placements: PlaceTuple[] = [];
      const occupiedKeys = new Set<string>();

      // Phase 1: preset
      if (preset?.placements) {
        const presetByPath = new Map<string, PlacementEntry[]>();
        preset.placements.forEach(e => {
          if (!presetByPath.has(e.ornamentPath)) presetByPath.set(e.ornamentPath, []);
          presetByPath.get(e.ornamentPath)!.push(e);
        });

        ornamentConfig.forEach((cfg) => {
          const entries = presetByPath.get(cfg.path);
          if (!entries) return;
          const presetCount = Math.min(entries.length, cfg.qty);
          for (let i = 0; i < presetCount; i++) {
            const entry = entries[i];
            const pos = beaconLookup.get(entry.beaconKey);
            if (!pos || occupiedKeys.has(entry.beaconKey)) continue;
            if (frontOnly && !isFrontForTree(pos, treeModelPath)) continue;
            placements.push({ ornPath: cfg.path, pos, rotation: entry.rotation });
            occupiedKeys.add(entry.beaconKey);
          }
        });
      }

      // Phase 2: random fill
      const placedCountByPath = new Map<string, number>();
      placements.forEach(p => placedCountByPath.set(p.ornPath, (placedCountByPath.get(p.ornPath) || 0) + 1));
      const remainingByIdx = ornamentConfig.map(cfg => cfg.qty - (placedCountByPath.get(cfg.path) || 0));
      const totalRemaining = remainingByIdx.reduce((s, n) => s + Math.max(0, n), 0);

      if (totalRemaining > 0) {
        const availableBeacons = allBeacons.filter(p =>
          !occupiedKeys.has(beaconKey(p)) && (!frontOnly || isFrontForTree(p, treeModelPath))
        );
        const quadrantBuckets: THREE.Vector3[][] = [[], [], [], []];
        availableBeacons.forEach(p => {
          const angle = Math.atan2(p.z, p.x);
          const q = angle < 0 ? (angle < -Math.PI / 2 ? 2 : 3) : (angle < Math.PI / 2 ? 0 : 1);
          quadrantBuckets[q].push(p);
        });
        // Divide remaining quota among NON-EMPTY buckets only. In front-only mode the
        // front-filter at line ~1462 leaves 2/4 buckets empty (or 3/5 for fishbone);
        // dividing by a hardcoded 4 would silently halve the placed count.
        const nonEmptyBuckets = quadrantBuckets.filter((b) => b.length > 0).length || 1;
        const perQuadrant = Math.ceil(Math.min(totalRemaining, availableBeacons.length) / nonEmptyBuckets);
        const positions: THREE.Vector3[] = [];
        quadrantBuckets.forEach((bucket, i) => {
          positions.push(...seededShuffle(bucket, 42 + i).slice(0, perQuadrant));
        });
        const finalPositions = seededShuffle(positions, 99).slice(0, Math.min(totalRemaining, availableBeacons.length));

        const assignmentList: number[] = [];
        remainingByIdx.forEach((rem, idx) => {
          for (let i = 0; i < Math.max(0, rem); i++) assignmentList.push(idx);
        });
        const shuffledAssignments = seededShuffle(assignmentList, 12345);

        let sSeed = 12345;
        const ornRand = () => {
          sSeed |= 0; sSeed = (sSeed + 0x6D2B79F5) | 0;
          let t = Math.imul(sSeed ^ (sSeed >>> 15), 1 | sSeed);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };

        finalPositions.forEach((pos, posIdx) => {
          const cfgIdx = posIdx < shuffledAssignments.length
            ? shuffledAssignments[posIdx]
            : Math.floor(ornRand() * ornamentModels.length);
          const ornPath = uniquePaths[cfgIdx];

          const worldPos = pos.clone().applyMatrix4(model.matrixWorld);
          const ornLocalPos = ornGroup.worldToLocal(worldPos);
          const outwardAngle = Math.atan2(ornLocalPos.x, ornLocalPos.z);
          const jitter = (ornRand() - 0.5) * 2 * (Math.PI / 12);

          placements.push({ ornPath, pos, rotation: [0, outwardAngle + jitter, 0] });
        });
      }

      // ---- Build InstancedMesh groups from placements ----
      // Group placements by ornament path
      const placementsByPath = new Map<string, PlaceTuple[]>();
      placements.forEach(p => {
        if (!placementsByPath.has(p.ornPath)) placementsByPath.set(p.ornPath, []);
        placementsByPath.get(p.ornPath)!.push(p);
      });

      const registry: OrnamentRegistry = {
        groups: [],
        ornaments: new Map(),
        reverseLookup: new Map(),
      };

      // Pre-compute string offsets per ornament type
      const stringOffsetByPath = new Map<string, THREE.Vector3>();
      modelByPath.forEach((srcModel, path) => {
        stringOffsetByPath.set(path, computeStringOffset(srcModel));
      });

      placementsByPath.forEach((pathPlacements, ornPath) => {
        const srcModel = modelByPath.get(ornPath);
        if (!srcModel) return;
        const keepOriginalMaterial = ornPath.includes('ribon_custom_material')
          || ornPath.includes('Silver_Ornament_Ball_');
        const strOffset = stringOffsetByPath.get(ornPath) || new THREE.Vector3();
        const count = pathPlacements.length;

        // Collect child meshes from the source model
        const childMeshes: THREE.Mesh[] = [];
        srcModel.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) childMeshes.push(child as THREE.Mesh);
        });

        // Create one InstancedMesh per child mesh
        const groupsForPath: InstanceGroup[] = [];
        childMeshes.forEach((srcMesh) => {
          // Some ornament GLBs ship primitives without a NORMAL attribute
          // (e.g., Trumpeting_Angel mesh0 has only POSITION + TEXCOORD_0).
          // MeshPhysicalMaterial can't shade without normals, so the mesh
          // would render solid black. Compute flat vertex normals once,
          // mutating the cached geometry — subsequent loads will see them.
          if (srcMesh.geometry && !srcMesh.geometry.attributes.normal) {
            srcMesh.geometry.computeVertexNormals();
          }
          let material: THREE.Material;
          if (keepOriginalMaterial) {
            material = (srcMesh.material as THREE.Material).clone();
          } else {
            const hasUVs = !!srcMesh.geometry?.attributes?.uv;
            material = createSilverMaterial(hasUVs);
          }

          const instMesh = new THREE.InstancedMesh(srcMesh.geometry, material, count);
          instMesh.castShadow = false;
          instMesh.receiveShadow = false;
          instMesh.frustumCulled = false; // ornaments spread across tree

          // Capture the mesh's cumulative transform inside the source GLB.
          // Baked into every per-instance matrix below so Blender-authored
          // scale survives the move to InstancedMesh.
          const meshLocalMatrix = getLocalToRootMatrix(srcMesh, srcModel);

          const group: InstanceGroup = {
            ornamentPath: ornPath,
            childMeshName: srcMesh.name,
            instancedMesh: instMesh,
            sharedMaterial: material,
            meshLocalMatrix,
          };
          groupsForPath.push(group);
          registry.groups.push(group);

          // Init reverse lookup
          registry.reverseLookup.set(instMesh, new Map());
        });

        // Set instance matrices and build OrnamentRecords
        pathPlacements.forEach((pt, idx) => {
          const rot = new THREE.Euler(pt.rotation[0], pt.rotation[1], pt.rotation[2]);
          const mat4 = composeOrnamentMatrix(pt.pos, rot, strOffset, model.matrixWorld, ornGroup);

          const bKey = beaconKey(pt.pos);
          const record: OrnamentRecord = {
            id: bKey,
            ornamentPath: ornPath,
            beaconKey: bKey,
            beaconPos: pt.pos.clone(),
            rotation: rot,
            instances: [],
            visible: true,
            storedInBox: false,
            stringOffset: strOffset.clone(),
          };

          groupsForPath.forEach((group) => {
            // Bake the mesh's GLB-hierarchy transform into the instance matrix.
            const finalMat = new THREE.Matrix4().multiplyMatrices(mat4, group.meshLocalMatrix);
            group.instancedMesh.setMatrixAt(idx, finalMat);
            record.instances.push({ group, instanceId: idx });
            registry.reverseLookup.get(group.instancedMesh)!.set(idx, bKey);
          });

          registry.ornaments.set(bKey, record);
        });

        // Finalize instance matrices
        groupsForPath.forEach((g) => {
          g.instancedMesh.instanceMatrix.needsUpdate = true;
          ornGroup.add(g.instancedMesh);
        });
      });

      ornRegistryRef.current = registry;

      // Rebuild rearrange beacon-ornament map (now keyed to ornament IDs)
      const rState = rearrangeRef.current;
      rState.beaconOrnamentMap.clear();
      rState.allBeacons = allBeacons;
      registry.ornaments.forEach((record, key) => {
        // Store a dummy object reference for compatibility; rearrange will use registry
        rState.beaconOrnamentMap.set(key, new THREE.Object3D());
      });
    });
  }, [ornamentConfig, treeReady, placementPresetPath, frontOnly]);

  // ---- Hide beacon plane meshes (always hidden now) ----
  useEffect(() => {
    const model = loadedModelRef.current;
    if (!model) return;
    model.traverse((child) => {
      if (child.name.startsWith('Plane') || child.name.startsWith('spot')) {
        child.visible = false;
      }
    });
  }, [treeReady]);

  // ---- Rearrange mode: spot markers + click handler (INSTANCED) ----
  useEffect(() => {
    const rState = rearrangeRef.current;
    const model = loadedModelRef.current;
    const ornGroup = ornamentGroupRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    const controls = controlsRef.current;
    const registry = ornRegistryRef.current;

    rState.active = rearrangeMode;

    // ---- Clean up spot markers ----
    rState.spotMarkers.forEach((m) => {
      m.parent?.remove(m);
      m.geometry?.dispose();
    });
    rState.spotMarkers = [];

    // Hidden matrix: moves instance off-screen with zero scale
    const HIDDEN_MATRIX = new THREE.Matrix4().compose(
      new THREE.Vector3(0, -9999, 0),
      new THREE.Quaternion(),
      new THREE.Vector3(0, 0, 0),
    );

    /** Restore a record's instances to their proper visible matrix */
    const restoreInstanceMatrix = (record: OrnamentRecord) => {
      if (!model) return;
      const mat4 = composeOrnamentMatrix(record.beaconPos, record.rotation, record.stringOffset, model.matrixWorld, ornGroup);
      record.instances.forEach(({ group, instanceId }) => {
        const finalMat = new THREE.Matrix4().multiplyMatrices(mat4, group.meshLocalMatrix);
        group.instancedMesh.setMatrixAt(instanceId, finalMat);
        group.instancedMesh.instanceMatrix.needsUpdate = true;
      });
    };

    /** Hide a record's instances (zero-scale off-screen) */
    const hideInstance = (record: OrnamentRecord) => {
      record.instances.forEach(({ group, instanceId }) => {
        group.instancedMesh.setMatrixAt(instanceId, HIDDEN_MATRIX);
        group.instancedMesh.instanceMatrix.needsUpdate = true;
      });
    };

    /** Create a temporary highlighted clone from source model cache */
    const createHighlightClone = (record: OrnamentRecord): THREE.Group | null => {
      const srcModel = ornamentCacheRef.current.get(record.ornamentPath);
      if (!srcModel || !model) return null;

      const keepOriginal = record.ornamentPath.includes('ribon_custom_material')
        || record.ornamentPath.includes('Silver_Ornament_Ball_');

      const clone = srcModel.clone(true);
      clone.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          let mat: THREE.Material;
          if (keepOriginal) {
            mat = (mesh.material as THREE.Material).clone();
          } else {
            const hasUVs = !!mesh.geometry?.attributes?.uv;
            mat = createSilverMaterial(hasUVs);
          }
          const stdMat = mat as THREE.MeshStandardMaterial;
          if (stdMat.isMeshStandardMaterial) {
            stdMat.emissive = new THREE.Color(0x00ccff);
            stdMat.emissiveIntensity = 0.6;
          }
          mesh.material = mat;
        }
      });

      // Position using same logic as instance matrix
      const worldPos = record.beaconPos.clone().applyMatrix4(model.matrixWorld);
      const localPos = ornGroup.worldToLocal(worldPos);
      localPos.sub(record.stringOffset);
      clone.position.copy(localPos);
      clone.rotation.copy(record.rotation);
      clone.userData._isTempClone = true;
      clone.userData._recordId = record.id;
      return clone;
    };

    // Clean up any existing temp highlight clone
    if (rState.pickedOrnament) {
      disposeGroup(rState.pickedOrnament);
      ornGroup.remove(rState.pickedOrnament);

      // Restore hidden instance if record is still visible (not stored)
      if (rState.pickedRecordId && registry) {
        const record = registry.ornaments.get(rState.pickedRecordId);
        if (record && record.visible && !record.storedInBox) {
          restoreInstanceMatrix(record);
        }
      }
      rState.pickedOrnament = null;
      rState.pickedRecordId = null;
      rState.pickedSourceBeacon = null;
      onPickStateChange?.(false);
    }

    if (!rearrangeMode) {
      showSpotMarkersRef.current = null;
      return;
    }

    if (!model || !scene || !camera || !renderer || !controls || !registry) return;

    // ---- Create spot markers for unoccupied tree beacons ----
    const showSpotMarkers = () => {
      rState.spotMarkers.forEach((m) => m.parent?.remove(m));
      rState.spotMarkers = [];

      const modelMat = model.matrixWorld;

      rState.allBeacons.forEach((bPos) => {
        if (frontOnly && !isFrontForTree(bPos, treeModelPath)) return;
        const key = beaconKey(bPos);
        const occupied = rState.beaconOrnamentMap.has(key);
        if (occupied && !(rState.pickedRecordId && rState.pickedSourceBeacon && beaconKey(rState.pickedSourceBeacon) === key)) return;

        const marker = new THREE.Mesh(spotMarkerGeo, spotMarkerMat.clone());
        const worldPos = bPos.clone().applyMatrix4(modelMat);
        const localPos = ornGroup.worldToLocal(worldPos);
        marker.position.copy(localPos);
        marker.userData._isSpotMarker = true;
        marker.userData._beaconPos = bPos.clone();
        marker.userData._beaconKey = key;
        ornGroup.add(marker);
        rState.spotMarkers.push(marker);
      });
    };

    showSpotMarkers();
    showSpotMarkersRef.current = showSpotMarkers;

    // ---- Click handler ----
    const canvas = renderer.domElement;
    const raycaster = raycasterRef.current;
    const mouse = mouseRef.current;

    const onClick = (event: MouseEvent) => {
      if (!rState.active) return;

      const rect = canvas.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      if (!rState.pickedOrnament) {
        // ---- PICK phase: raycast against InstancedMesh objects ----
        const instMeshes = registry.groups.map(g => g.instancedMesh);
        const hits = raycaster.intersectObjects(instMeshes, false);
        if (hits.length === 0) return;

        // Occlusion check
        const treeModel = loadedModelRef.current;
        if (treeModel) {
          const treeMeshes: THREE.Mesh[] = [];
          treeModel.traverse((c) => {
            if ((c as THREE.Mesh).isMesh) treeMeshes.push(c as THREE.Mesh);
          });
          const treeHits = raycaster.intersectObjects(treeMeshes, false);
          if (treeHits.length > 0 && treeHits[0].distance < hits[0].distance) return;
        }

        // Look up ornament record via reverse lookup
        const hitMesh = hits[0].object as THREE.InstancedMesh;
        const hitInstanceId = (hits[0] as { instanceId?: number }).instanceId;
        if (hitInstanceId == null) return;
        const lookupMap = registry.reverseLookup.get(hitMesh);
        if (!lookupMap) return;
        const recordId = lookupMap.get(hitInstanceId);
        if (!recordId) return;
        const record = registry.ornaments.get(recordId);
        if (!record || !record.visible || record.storedInBox) return;

        // Hide the instanced ornament
        hideInstance(record);

        // Create temp highlight clone
        const clone = createHighlightClone(record);
        if (!clone) return;
        ornGroup.add(clone);

        rState.pickedOrnament = clone;
        rState.pickedRecordId = recordId;
        rState.pickedSourceBeacon = record.beaconPos.clone();
        onPickStateChange?.(true);
        showSpotMarkers();
      } else {
        // ---- PLACE phase ----
        // Check if user clicked the temp clone to cancel
        const pickMeshes: THREE.Mesh[] = [];
        rState.pickedOrnament!.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) pickMeshes.push(c as THREE.Mesh);
        });
        const selfHits = raycaster.intersectObjects(pickMeshes, false);
        if (selfHits.length > 0) {
          // Cancel: dispose temp clone, restore instance
          const recordId = rState.pickedRecordId!;
          const record = registry.ornaments.get(recordId);

          disposeGroup(rState.pickedOrnament!);
          ornGroup.remove(rState.pickedOrnament!);

          if (record) restoreInstanceMatrix(record);

          rState.pickedOrnament = null;
          rState.pickedRecordId = null;
          rState.pickedSourceBeacon = null;
          onPickStateChange?.(false);
          showSpotMarkers();
          return;
        }

        // Check spot markers
        const markerMeshes = rState.spotMarkers;
        const hits = raycaster.intersectObjects(markerMeshes, false);
        if (hits.length === 0) return;

        const targetMarker = hits[0].object as THREE.Mesh;
        const targetKey: string = targetMarker.userData._beaconKey;
        const targetBeaconPos: THREE.Vector3 = targetMarker.userData._beaconPos;
        const recordId = rState.pickedRecordId!;
        const record = registry.ornaments.get(recordId);
        if (!record) return;
        const sourceKey = record.beaconKey;

        // Dispose temp clone
        disposeGroup(rState.pickedOrnament!);
        ornGroup.remove(rState.pickedOrnament!);

        // Compute new outward-facing rotation at target
        const worldPos = targetBeaconPos.clone().applyMatrix4(model.matrixWorld);
        const ornLocalPos = ornGroup.worldToLocal(worldPos);
        const outwardAngle = Math.atan2(ornLocalPos.x, ornLocalPos.z);
        const newRotation = new THREE.Euler(0, outwardAngle, 0);

        // Update record
        record.beaconPos = targetBeaconPos.clone();
        record.beaconKey = targetKey;
        record.rotation = newRotation;
        record.storedInBox = false;

        // Re-key record in registry maps
        registry.ornaments.delete(sourceKey);
        record.id = targetKey;
        registry.ornaments.set(targetKey, record);

        // Update reverse lookups
        record.instances.forEach(({ group, instanceId }) => {
          registry.reverseLookup.get(group.instancedMesh)!.set(instanceId, targetKey);
        });

        // Restore instance at new position
        restoreInstanceMatrix(record);

        // Update beacon tracking
        rState.beaconOrnamentMap.delete(sourceKey);
        rState.beaconOrnamentMap.set(targetKey, new THREE.Object3D());

        rState.pickedOrnament = null;
        rState.pickedRecordId = null;
        rState.pickedSourceBeacon = null;
        onPickStateChange?.(false);
        showSpotMarkers();
      }
    };

    canvas.addEventListener('click', onClick);

    return () => {
      canvas.removeEventListener('click', onClick);
      showSpotMarkersRef.current = null;
      rState.spotMarkers.forEach((m) => {
        m.parent?.remove(m);
        (m.material as THREE.Material).dispose();
      });
      rState.spotMarkers = [];
      // Clean up temp clone on effect teardown
      if (rState.pickedOrnament) {
        disposeGroup(rState.pickedOrnament);
        ornGroup.remove(rState.pickedOrnament);
        // Restore instance
        if (rState.pickedRecordId && registry) {
          const record = registry.ornaments.get(rState.pickedRecordId);
          if (record && record.visible && !record.storedInBox) {
            restoreInstanceMatrix(record);
          }
        }
        rState.pickedOrnament = null;
        rState.pickedRecordId = null;
        rState.pickedSourceBeacon = null;
      }
    };
  }, [rearrangeMode, treeReady]);

  // ---- Storage actions for parent UI panel (INSTANCED) ----
  // Thumbnail cache: storageKey → dataURL
  const storageThumbnailsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!actionsRef) return;
    const rState = rearrangeRef.current;
    const ornGroup = ornamentGroupRef.current;
    const renderer = rendererRef.current;
    const model = loadedModelRef.current;

    // Hidden matrix for hiding instances
    const HIDDEN_MATRIX = new THREE.Matrix4().compose(
      new THREE.Vector3(0, -9999, 0),
      new THREE.Quaternion(),
      new THREE.Vector3(0, 0, 0),
    );

    /** Create a fresh non-highlight clone for thumbnail rendering */
    const createThumbClone = (ornPath: string): THREE.Group | null => {
      const srcModel = ornamentCacheRef.current.get(ornPath);
      if (!srcModel) return null;
      const keepOriginal = ornPath.includes('ribon_custom_material')
        || ornPath.includes('Silver_Ornament_Ball_');
      const clone = srcModel.clone(true);
      clone.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          if (keepOriginal) {
            mesh.material = (mesh.material as THREE.Material).clone();
          } else {
            const hasUVs = !!mesh.geometry?.attributes?.uv;
            mesh.material = createSilverMaterial(hasUVs);
          }
        }
      });
      return clone;
    };

    /** Render a thumbnail of an ornament type to a data URL */
    const renderThumbnail = (ornPath: string): string | undefined => {
      if (!renderer) return undefined;
      const clone = createThumbClone(ornPath);
      if (!clone) return undefined;

      const size = 128;
      const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType });
      const thumbScene = new THREE.Scene();
      thumbScene.background = new THREE.Color(0xf1f5f9);

      const ambLight = new THREE.AmbientLight(0xffffff, 0.8);
      thumbScene.add(ambLight);
      const tDirLight = new THREE.DirectionalLight(0xffffff, 1.2);
      tDirLight.position.set(2, 3, 4);
      thumbScene.add(tDirLight);

      thumbScene.add(clone);
      clone.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(clone);
      const center = box.getCenter(new THREE.Vector3());
      const bSize = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(bSize.x, bSize.y, bSize.z);

      clone.position.x -= center.x;
      clone.position.y -= center.y;
      clone.position.z -= center.z;

      const thumbCam = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
      thumbCam.position.set(0, maxDim * 0.3, maxDim * 2.0);
      thumbCam.lookAt(0, 0, 0);

      const prevRT = renderer.getRenderTarget();
      const prevToneMapping = renderer.toneMapping;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(thumbScene, thumbCam);
      renderer.setRenderTarget(prevRT);
      renderer.toneMapping = prevToneMapping;

      const buf = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
      rt.dispose();

      const cvs = document.createElement('canvas');
      cvs.width = size;
      cvs.height = size;
      const ctx = cvs.getContext('2d')!;
      const imgData = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const srcIdx = ((size - 1 - y) * size + x) * 4;
          const dstIdx = (y * size + x) * 4;
          imgData.data[dstIdx] = buf[srcIdx];
          imgData.data[dstIdx + 1] = buf[srcIdx + 1];
          imgData.data[dstIdx + 2] = buf[srcIdx + 2];
          imgData.data[dstIdx + 3] = buf[srcIdx + 3];
        }
      }
      ctx.putImageData(imgData, 0, 0);

      // Clean up
      disposeGroup(clone);
      ambLight.dispose();
      tDirLight.dispose();

      return cvs.toDataURL('image/png');
    };

    const notifyStorage = () => {
      const items = Array.from(rState.storageKeys).map(k => ({
        key: k,
        thumbnail: storageThumbnailsRef.current.get(k),
      }));
      onStorageChange?.(items);
    };

    actionsRef.current = {
      storeCurrentPick: () => {
        const registry = ornRegistryRef.current;
        if (!rState.pickedOrnament || !rState.pickedRecordId || !registry) return null;
        const recordId = rState.pickedRecordId;
        const record = registry.ornaments.get(recordId);
        if (!record) return null;

        const storageKey = STORAGE_KEY_PREFIX + (rState.storageCounter++);

        // Render thumbnail from source model (clean, no highlight)
        const thumb = renderThumbnail(record.ornamentPath);
        if (thumb) storageThumbnailsRef.current.set(storageKey, thumb);

        // Dispose temp highlight clone
        disposeGroup(rState.pickedOrnament);
        ornGroup.remove(rState.pickedOrnament);

        // Instance stays hidden (already zero-scaled when picked)
        record.storedInBox = true;
        record.visible = false;

        // Re-key record to storage key
        const sourceKey = record.beaconKey;
        registry.ornaments.delete(recordId);
        record.id = storageKey;
        registry.ornaments.set(storageKey, record);

        // Update reverse lookups
        record.instances.forEach(({ group, instanceId }) => {
          registry.reverseLookup.get(group.instancedMesh)!.set(instanceId, storageKey);
        });

        // Update beacon tracking
        if (sourceKey) rState.beaconOrnamentMap.delete(sourceKey);
        rState.storageKeys.add(storageKey);

        rState.pickedOrnament = null;
        rState.pickedRecordId = null;
        rState.pickedSourceBeacon = null;
        onPickStateChange?.(false);
        notifyStorage();
        showSpotMarkersRef.current?.();

        return storageKey;
      },

      retrieveFromStorage: (key: string) => {
        const registry = ornRegistryRef.current;
        if (!registry || !rState.storageKeys.has(key)) return;
        const record = registry.ornaments.get(key);
        if (!record) return;

        // Clean up any existing pick first
        if (rState.pickedOrnament) {
          disposeGroup(rState.pickedOrnament);
          ornGroup.remove(rState.pickedOrnament);
          // If previous pick was a tree ornament (not stored), restore its instance
          if (rState.pickedRecordId && rState.pickedRecordId !== key) {
            const prevRecord = registry.ornaments.get(rState.pickedRecordId);
            if (prevRecord && !prevRecord.storedInBox && model) {
              const mat4 = composeOrnamentMatrix(prevRecord.beaconPos, prevRecord.rotation, prevRecord.stringOffset, model.matrixWorld, ornGroup);
              prevRecord.instances.forEach(({ group, instanceId }) => {
                const finalMat = new THREE.Matrix4().multiplyMatrices(mat4, group.meshLocalMatrix);
                group.instancedMesh.setMatrixAt(instanceId, finalMat);
                group.instancedMesh.instanceMatrix.needsUpdate = true;
              });
            }
          }
          rState.pickedOrnament = null;
          rState.pickedRecordId = null;
          rState.pickedSourceBeacon = null;
        }

        rState.storageKeys.delete(key);
        storageThumbnailsRef.current.delete(key);

        // Mark record as no longer stored
        record.storedInBox = false;
        // Instance stays hidden — user will place it via click handler

        // Create temp highlight clone as picked ornament
        const srcModel = ornamentCacheRef.current.get(record.ornamentPath);
        if (!srcModel || !model) return;
        const keepOriginal = record.ornamentPath.includes('ribon_custom_material')
          || record.ornamentPath.includes('Silver_Ornament_Ball_');
        const clone = srcModel.clone(true);
        clone.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            let mat: THREE.Material;
            if (keepOriginal) {
              mat = (mesh.material as THREE.Material).clone();
            } else {
              const hasUVs = !!mesh.geometry?.attributes?.uv;
              mat = createSilverMaterial(hasUVs);
            }
            const stdMat = mat as THREE.MeshStandardMaterial;
            if (stdMat.isMeshStandardMaterial) {
              stdMat.emissive = new THREE.Color(0x00ccff);
              stdMat.emissiveIntensity = 0.6;
            }
            mesh.material = mat;
          }
        });

        // Position at last known location
        const worldPos = record.beaconPos.clone().applyMatrix4(model.matrixWorld);
        const localPos = ornGroup.worldToLocal(worldPos);
        localPos.sub(record.stringOffset);
        clone.position.copy(localPos);
        clone.rotation.copy(record.rotation);
        clone.userData._isTempClone = true;
        clone.userData._recordId = key;
        ornGroup.add(clone);

        rState.pickedOrnament = clone;
        rState.pickedRecordId = key;
        rState.pickedSourceBeacon = null; // came from storage, no source beacon

        onPickStateChange?.(true);
        notifyStorage();
        showSpotMarkersRef.current?.();
      },

      exportPlacement: () => {
        const registry = ornRegistryRef.current;
        if (!treeModelPath || !registry) return null;
        const placements: PlacementEntry[] = [];
        registry.ornaments.forEach((record) => {
          if (record.storedInBox || !record.visible) return;
          // Skip storage-keyed records (shouldn't happen if storedInBox is correct)
          if (record.id.startsWith(STORAGE_KEY_PREFIX)) return;
          placements.push({
            ornamentPath: record.ornamentPath,
            beaconKey: record.beaconKey,
            rotation: [record.rotation.x, record.rotation.y, record.rotation.z],
          });
        });
        const treeKey = frontOnly ? `${treeModelPath}:front` : treeModelPath;
        return { tree: treeKey, placements };
      },

      captureScreenshot: () => {
        const renderer = rendererRef.current;
        if (!renderer) return null;
        try {
          return renderer.domElement.toDataURL('image/png');
        } catch {
          return null;
        }
      },
    };
  }, [rearrangeMode, treeReady, actionsRef, onStorageChange, onPickStateChange, treeModelPath, frontOnly]);

  // ---- lil-gui material tweaker ----
  useEffect(() => {
    const model = loadedModelRef.current;
    if (!model) return;

    // Destroy previous GUI
    if (guiRef.current) {
      guiRef.current.destroy();
      guiRef.current = null;
    }

    const gui = new GUI({ title: 'Material Editor' });
    guiRef.current = gui;

    // Helper to add a material folder
    const addMatFolder = (parent: GUI, mat: THREE.MeshStandardMaterial, label: string) => {
      const folder = parent.addFolder(label);
      const params = {
        color: '#' + mat.color.getHexString(),
        metalness: mat.metalness,
        roughness: mat.roughness,
        envMapIntensity: mat.envMapIntensity,
        emissive: '#' + mat.emissive.getHexString(),
        emissiveIntensity: mat.emissiveIntensity,
        opacity: mat.opacity,
      };
      folder.addColor(params, 'color').onChange((v: string) => { mat.color.set(v); mat.needsUpdate = true; });
      folder.add(params, 'metalness', 0, 1, 0.01).onChange((v: number) => { mat.metalness = v; mat.needsUpdate = true; });
      folder.add(params, 'roughness', 0, 1, 0.01).onChange((v: number) => { mat.roughness = v; mat.needsUpdate = true; });
      folder.add(params, 'envMapIntensity', 0, 5, 0.1).onChange((v: number) => { mat.envMapIntensity = v; mat.needsUpdate = true; });
      folder.addColor(params, 'emissive').onChange((v: string) => { mat.emissive.set(v); mat.needsUpdate = true; });
      folder.add(params, 'emissiveIntensity', 0, 50, 0.1).onChange((v: number) => { mat.emissiveIntensity = v; mat.needsUpdate = true; });
      folder.add(params, 'opacity', 0, 1, 0.01).onChange((v: number) => { mat.opacity = v; mat.transparent = v < 1; mat.needsUpdate = true; });
      folder.close();
      return folder;
    };

    // --- Bloom controls ---
    const bloom = bloomPassRef.current;
    if (bloom) {
      const bloomSection = gui.addFolder('Bloom');
      const bloomParams = {
        strength: bloom.strength,
        radius: bloom.radius,
        threshold: bloom.threshold,
      };
      bloomSection.add(bloomParams, 'strength', 0, 3, 0.01).onChange((v: number) => { bloom.strength = v; });
      bloomSection.add(bloomParams, 'radius', 0, 1, 0.01).onChange((v: number) => { bloom.radius = v; });
      bloomSection.add(bloomParams, 'threshold', 0, 1, 0.01).onChange((v: number) => { bloom.threshold = v; });
      bloomSection.open();
    }

    // --- Lights controls ---
    const lightsSection = gui.addFolder('Lights');
    const renderer = rendererRef.current;
    if (renderer) {
      const rendererParams = {
        exposure: renderer.toneMappingExposure,
      };
      lightsSection.add(rendererParams, 'exposure', 0, 5, 0.01).name('Tone Map Exposure').onChange((v: number) => { renderer.toneMappingExposure = v; });
    }
    const scene = sceneRef.current;
    if (scene) {
      const envParams = {
        envIntensity: scene.environmentIntensity ?? 1.1,
      };
      lightsSection.add(envParams, 'envIntensity', 0, 5, 0.01).name('HDRI Intensity').onChange((v: number) => { scene.environmentIntensity = v; });
    }
    const dirLight = dirLightRef.current;
    if (dirLight) {
      const dirFolder = lightsSection.addFolder('Directional');
      const dirParams = {
        color: '#' + dirLight.color.getHexString(),
        intensity: dirLight.intensity,
        posX: dirLight.position.x,
        posY: dirLight.position.y,
        posZ: dirLight.position.z,
      };
      dirFolder.addColor(dirParams, 'color').onChange((v: string) => { dirLight.color.set(v); });
      dirFolder.add(dirParams, 'intensity', 0, 20, 0.01).onChange((v: number) => { dirLight.intensity = v; });
      dirFolder.add(dirParams, 'posX', -20, 20, 0.1).name('pos X').onChange((v: number) => { dirLight.position.x = v; });
      dirFolder.add(dirParams, 'posY', -20, 20, 0.1).name('pos Y').onChange((v: number) => { dirLight.position.y = v; });
      dirFolder.add(dirParams, 'posZ', -20, 20, 0.1).name('pos Z').onChange((v: number) => { dirLight.position.z = v; });
      dirFolder.open();
    }
    lightsSection.open();

    // --- Tree materials ---
    const treeSection = gui.addFolder('Tree');
    const treeMatMap = new Map<string, THREE.MeshStandardMaterial>();
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        // Skip beacon planes
        if (child.name.startsWith('Plane') || child.name.startsWith('spot')) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => {
          const mat = m as THREE.MeshStandardMaterial;
          if (!mat.isMeshStandardMaterial) return;
          const name = mat.name || `mesh_${child.name}_${mat.uuid.slice(0, 6)}`;
          if (!treeMatMap.has(name)) treeMatMap.set(name, mat);
        });
      }
    });
    treeMatMap.forEach((mat, name) => addMatFolder(treeSection, mat, name));
    treeSection.open();

    // --- Ornament materials ---
    const ornGroup = ornamentGroupRef.current;
    if (ornGroup.children.length > 0) {
      const ornSection = gui.addFolder('Ornaments');
      const ornMatMap = new Map<string, THREE.MeshStandardMaterial>();
      ornGroup.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => {
            const mat = m as THREE.MeshStandardMaterial;
            if (!mat.isMeshStandardMaterial) return;
            const name = mat.name || mat.uuid.slice(0, 8);
            if (!ornMatMap.has(name)) ornMatMap.set(name, mat);
          });
        }
      });
      ornMatMap.forEach((mat, name) => addMatFolder(ornSection, mat, name));
      ornSection.close();
    }

    return () => {
      if (guiRef.current) {
        guiRef.current.destroy();
        guiRef.current = null;
      }
    };
  }, [treeReady, ornamentConfig]);

  // ---- Loading progress bar ----
  const progressPercent = typeof loadProgress === 'number' ? Math.round(loadProgress) : null;
  const isIndeterminate = loadProgress === 'indeterminate';
  const showBar = loadProgress !== null;

  return (
    <div ref={mountRef} className="w-full h-full relative">
      {showBar && (
        <div
          className="absolute inset-0 flex items-center justify-center z-10 transition-opacity duration-300"
          style={{ opacity: progressPercent === 100 ? 0 : 1, pointerEvents: 'none' }}
        >
          <div className="w-[300px] h-[8px] bg-gray-200 rounded-full overflow-hidden relative">
            {isIndeterminate ? (
              <div
                className="h-full bg-blue-500 rounded-full animate-pulse"
                style={{ width: '60%', marginLeft: '20%' }}
              />
            ) : (
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-200 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            )}
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-gray-600 leading-none"
              style={{ top: '12px' }}>
              {isIndeterminate ? '로딩 중...' : `${progressPercent}%`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
