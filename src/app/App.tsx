import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, Save, FolderOpen, Monitor, Globe, GripVertical, Wrench, ShoppingBag, Ruler, Palette, Gem, Lightbulb, Check, RotateCw, RefreshCw, Camera, MousePointer2, Hand, Grip, LayoutGrid, Mouse, ZoomIn, HelpCircle, Package, Eye, Info, TreePine } from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';
import Scene from '@/app/components/Scene';
import type { SceneActions, StoredOrnamentInfo, PlacementPreset } from '@/app/components/Scene';

// Import light images for page 2
// Light thumbnails now served from /public/thumbnails/ (dynamic paths in lightOptionsMap)

// Module-level constant so the array reference stays stable across re-renders
// (prevents ornament placement effect from re-firing on every App state change).
// Each entry: { path, qty } — qty controls exact number placed on the tree.
const ORNAMENT_CONFIG: { path: string; qty: number }[] = [
  { path: '/models/Snowflake_Radiance.glb', qty: 2 },
  { path: '/models/Gingko_Charm.glb', qty: 2 },
  { path: '/models/Ornate_Chalice.glb', qty: 2 },
  { path: '/models/Trumpeting_Angel_predraco.glb', qty: 2 },
  { path: '/models/Spiral_star.glb', qty: 2 },
  { path: '/models/Reindeer.glb', qty: 1 },
  { path: '/models/Silver_Ornament_Ball_smooth.glb', qty: 6 },
  { path: '/models/Silver_Ornament_Ball_mat.glb', qty: 6 },
  { path: '/models/ribon_custom_material.glb', qty: 10 },
  { path: '/models/Frosted_Leaf_Charm.glb', qty: 2 },
  // Silver_Branch removed
  { path: '/models/Silver_Ribbon.glb', qty: 2 },
  { path: '/models/Bronchial_Tree.glb', qty: 2 },
  { path: '/models/Icicle_ornament.glb', qty: 2 },
  { path: '/models/Silver_icicle_pendant.glb', qty: 2 },
  { path: '/models/Beaded_Diamond_Pendan.glb', qty: 2 },
  { path: '/models/Spiral_Faceted_Pendan.glb', qty: 2 },
  { path: '/models/Silver_Filigree_Duck.glb', qty: 2 },
];

// ============================================================================
// LIGHT RECOMMENDATION TABLES
// Two parallel lookups feed the wrap-mode buttons:
//   1. SCENE_COUNT_TABLE (#트리 PDF) — bulbs to RENDER in the viewport
//   2. CART_SET_COUNT_TABLE (#전구 PDF) — sets to BUY (cart row qty multiplier)
// Decoupled by design: a 150cm 스케치 with 쥬얼라이트 RENDERS 800 bulbs but the
// product comes in 500구 strings, so the cart buys 2 sets (= 1000 actual).
// ============================================================================

type LightFamily = 'wire' | 'led' | 'cluster';
type TreeColorGroup = 'fishbone' | 'sketch-olive' | 'sketch-pink' | 'deperse';
type WrapKey = 'front' | '360' | '360-dense';

// Tree slot id → color/family group used as #트리 row key.
// 더퍼스트 (2) is 'deperse' — the table has all dashes, so any lookup → 0.
const TREE_COLOR_GROUP: Record<number, TreeColorGroup> = {
  1: 'fishbone',      // 피시본 트리 — 그린/투톤 (same numbers as sketch-olive per #트리)
  2: 'deperse',       // 더퍼스트 트리 — table empty
  3: 'sketch-olive',  // 스케치 트리 (올리브/스노우)
  4: 'sketch-pink',   // 스케치 트리 (핑크/로즈) — no 120cm row
};

// Light product (selectedLight 1-5) → which #트리 column to use.
// Cluster has no "촘촘" column; LED collapses all wraps into one column.
const LIGHT_FAMILY: Record<number, LightFamily> = {
  1: 'wire',     // 팝팝
  2: 'wire',     // 파스텔팝
  3: 'led',      // 쥬얼라이트 (RGB)
  4: 'cluster',  // 클러스터
  5: 'wire',     // 좁쌀
};

// #트리 PDF — scene bulb counts. Shared base for fishbone + sketch-olive (identical rows).
// Cluster's '360-dense' = '360' (no distinct column in source).
// LED's three wrap entries are identical (single column).
const SCENE_COUNTS_BASE: Record<string, Record<LightFamily, Record<WrapKey, number>>> = {
  '120cm': {
    led:     { front: 500,  '360': 500,  '360-dense': 500 },
    wire:    { front: 500,  '360': 500,  '360-dense': 800 },
    cluster: { front: 1000, '360': 1000, '360-dense': 1000 },
  },
  '150cm': {
    led:     { front: 800,  '360': 800,  '360-dense': 800 },
    wire:    { front: 1000, '360': 1000, '360-dense': 1200 },
    cluster: { front: 1000, '360': 1000, '360-dense': 1000 },
  },
  '180cm': {
    led:     { front: 1500, '360': 1500, '360-dense': 1500 },
    wire:    { front: 1500, '360': 1500, '360-dense': 2000 },
    cluster: { front: 2000, '360': 2000, '360-dense': 2000 },
  },
  '210cm': {
    led:     { front: 2000, '360': 2000, '360-dense': 2000 },
    wire:    { front: 2000, '360': 2000, '360-dense': 3000 },
    cluster: { front: 3000, '360': 3000, '360-dense': 3000 },
  },
};

const SCENE_COUNT_TABLE: Record<TreeColorGroup, Record<string, Record<LightFamily, Record<WrapKey, number>>> | null> = {
  'fishbone':     SCENE_COUNTS_BASE,
  'sketch-olive': SCENE_COUNTS_BASE,
  'sketch-pink':  { // No 120cm — that row gets pruned via the size selector already
    '150cm': SCENE_COUNTS_BASE['150cm'],
    '180cm': SCENE_COUNTS_BASE['180cm'],
    '210cm': SCENE_COUNTS_BASE['210cm'],
  },
  'deperse': null, // 더퍼스트 — empty in source, returns 0 for all lookups
};

/** Returns the recommended scene-render bulb count from #트리. Returns 0 when no data. */
function getSceneBulbCount(treeId: number, size: string, lightId: number, wrap: WrapKey): number {
  const group = TREE_COLOR_GROUP[treeId];
  const family = LIGHT_FAMILY[lightId];
  if (!group || !family) return 0;
  const groupTable = SCENE_COUNT_TABLE[group];
  if (!groupTable) return 0;
  return groupTable[size]?.[family]?.[wrap] ?? 0;
}

// #전구 PDF — sets to buy per (light, qty-per-unit, size, wrap).
// Wire products: 3 wrap modes. LED + Cluster: collapsed (same number for all 3 wraps).
const CART_SET_COUNT_TABLE: Record<number, Record<number, Record<string, Record<WrapKey, number>>>> = {
  1: { // 팝팝
    200: {
      '120cm': { front: 3, '360': 3, '360-dense': 4 },
      '150cm': { front: 5, '360': 5, '360-dense': 6 },
      '180cm': { front: 8, '360': 8, '360-dense': 10 },
      '210cm': { front: 10, '360': 10, '360-dense': 15 },
    },
    500: {
      '120cm': { front: 1, '360': 1, '360-dense': 2 },
      '150cm': { front: 2, '360': 2, '360-dense': 3 },
      '180cm': { front: 3, '360': 3, '360-dense': 4 },
      '210cm': { front: 4, '360': 4, '360-dense': 6 },
    },
  },
  2: { // 파스텔팝
    500: {
      '120cm': { front: 1, '360': 1, '360-dense': 2 },
      '150cm': { front: 2, '360': 2, '360-dense': 3 },
      '180cm': { front: 3, '360': 3, '360-dense': 4 },
      '210cm': { front: 4, '360': 4, '360-dense': 6 },
    },
  },
  3: { // 쥬얼라이트 — wrap doesn't matter (single column collapsed)
    500: {
      '120cm': { front: 1, '360': 1, '360-dense': 1 },
      '150cm': { front: 2, '360': 2, '360-dense': 2 },
      '180cm': { front: 3, '360': 3, '360-dense': 3 },
      '210cm': { front: 4, '360': 4, '360-dense': 4 },
    },
    1000: {
      '120cm': { front: 1, '360': 1, '360-dense': 1 },
      '150cm': { front: 1, '360': 1, '360-dense': 1 },
      '180cm': { front: 2, '360': 2, '360-dense': 2 },
      '210cm': { front: 2, '360': 2, '360-dense': 2 },
    },
  },
  4: { // 클러스터 — no 촘촘 column; '360-dense' collapses to '360' value
    1000: {
      '120cm': { front: 1, '360': 1, '360-dense': 1 },
      '150cm': { front: 1, '360': 1, '360-dense': 1 },
      '180cm': { front: 2, '360': 2, '360-dense': 2 },
      '210cm': { front: 3, '360': 3, '360-dense': 3 },
    },
  },
  5: { // 좁쌀
    100: {
      '120cm': { front: 5, '360': 5, '360-dense': 8 },
      '150cm': { front: 10, '360': 10, '360-dense': 12 },
      '180cm': { front: 15, '360': 15, '360-dense': 20 },
      '210cm': { front: 20, '360': 20, '360-dense': 30 },
    },
    200: {
      '120cm': { front: 3, '360': 3, '360-dense': 4 },
      '150cm': { front: 5, '360': 5, '360-dense': 6 },
      '180cm': { front: 8, '360': 8, '360-dense': 10 },
      '210cm': { front: 10, '360': 10, '360-dense': 15 },
    },
    300: {
      '120cm': { front: 2, '360': 2, '360-dense': 3 },
      '150cm': { front: 4, '360': 4, '360-dense': 4 },
      '180cm': { front: 5, '360': 5, '360-dense': 7 },
      '210cm': { front: 7, '360': 7, '360-dense': 10 },
    },
    500: {
      '120cm': { front: 1, '360': 1, '360-dense': 2 },
      '150cm': { front: 2, '360': 2, '360-dense': 3 },
      '180cm': { front: 3, '360': 3, '360-dense': 4 },
      '210cm': { front: 4, '360': 4, '360-dense': 6 },
    },
    1000: {
      '120cm': { front: 1, '360': 1, '360-dense': 1 },
      '150cm': { front: 1, '360': 1, '360-dense': 2 },
      '180cm': { front: 2, '360': 2, '360-dense': 2 },
      '210cm': { front: 2, '360': 2, '360-dense': 3 },
    },
  },
};

/** Returns the recommended number of SKU units (sets) to buy from #전구. 0 when no data. */
function getCartSetCount(lightId: number, qtyUnit: number, size: string, wrap: WrapKey): number {
  return CART_SET_COUNT_TABLE[lightId]?.[qtyUnit]?.[size]?.[wrap] ?? 0;
}

const ToolbarButton = ({ icon: Icon, label, onClick }: { icon: any, label: string, onClick: () => void }) => (
  <Tooltip.Root delayDuration={300}>
    <Tooltip.Trigger asChild>
      <button 
        onClick={onClick} 
        className="p-2 hover:bg-slate-900/10 rounded-full transition-colors text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/50"
      >
        <Icon className="size-5" />
      </button>
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg shadow-xl z-50 select-none animate-in fade-in-0 zoom-in-95"
        sideOffset={5}
        side="top"
      >
        {label}
        <Tooltip.Arrow className="fill-gray-900" />
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
);

export default function App() {
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(true);

  // ---- Cart: discriminated union by `kind` ----
  // Common fields (name/thumbnail/qty) drive the cart UI tile;
  // kind-specific fields drive scene rendering (lightLayers / ornamentLayers / treeRender).
  // - tree: never merges; each commit = new row (Q5/Q10)
  // - light: merges when (lightId+bulbCount+bulbColor+wireColor) match; qty represents # of SKU units (e.g. 좁쌀 1000구 ×2 = 2000 bulbs)
  // - ornament/point: merges by id; qty bumps
  type CartItem =
    | { uid: number; kind: 'tree'; treeId: number; treePath: string; size: string; color: string; name: string; thumbnail: string; qty: 1 }
    | { uid: number; kind: 'light'; lightId: number; bulbCount: number; bulbColor: string; wireColor: string; palette: string[]; name: string; thumbnail: string; qty: number }
    | { uid: number; kind: 'ornament'; ornamentId: number; name: string; thumbnail: string; qty: number }
    | { uid: number; kind: 'point'; pointId: number; name: string; thumbnail: string; qty: number };

  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const cartUidRef = useRef(1);
  const nextUid = () => cartUidRef.current++;
  const [cartJingle, setCartJingle] = useState(false);

  // 더퍼스트 (treeId=2) is 전구 일체형 — built-in baked lights, no additional light products allowed.
  // Surfaces a modal when the user tries to interact with any light item on page 2.
  const [showDeperseAlert, setShowDeperseAlert] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = 4;

  // Side Button States
  const [selectedSize, setSelectedSize] = useState("150cm");
  const [selectedColor, setSelectedColor] = useState("olive");
  // Light mode: 'on' | 'blink' | 'off'
  const [lightMode, setLightMode] = useState<'on' | 'blink' | 'off'>('on');
  const cycleLightMode = () => setLightMode((prev) => prev === 'on' ? 'blink' : prev === 'blink' ? 'off' : 'on');
  const [rearrangeMode, setRearrangeMode] = useState(false);
  const [frontOnlyMode, setFrontOnlyMode] = useState(false);
  // Light wrap mode: 'front' (앞면), '360' (360도 보통), '360-dense' (360도 촘촘)
  // Tied to frontOnlyMode: front-only → 'front'; 360 → '360' or '360-dense' user choice
  const [lightWrapMode, setLightWrapMode] = useState<'front' | '360' | '360-dense'>('360');
  const [showRearrangeGuide, setShowRearrangeGuide] = useState(false);
  const [rearrangeGuideHideToday, setRearrangeGuideHideToday] = useState(() => {
    const stored = localStorage.getItem('rearrangeGuideHideUntil');
    return stored ? Date.now() < Number(stored) : false;
  });
  const [lightQuantity, setLightQuantity] = useState<string>('');
  const [lightBulbColor, setLightBulbColor] = useState<string>('');
  const [lightWireColor, setLightWireColor] = useState<string>('');

  // Per-light config: available options vary by selected light type
  // thumbnailKey: which option type drives the thumbnail change ('bulbColor' | 'wireColor' | null)
  // colorsByBulbColor: emissive palette keyed by the bulbColor option value.
  //   Length 1 = single-color (uniform). Length >1 = multi-color cycled per-bulb (i % N).
  //   Round-robin means the array's *ratio* drives the distribution:
  //     ['a','a','a','b'] → 75% a, 25% b.
  const lightOptionsMap: Record<number, { qty: string[]; bulbColor: string[]; wireColor: string[]; thumbnailKey: 'bulbColor' | 'wireColor' | null; thumbnails: Record<string, string>; colorsByBulbColor: Record<string, string[]> }> = {
    1: { // 팝팝 — thumbnail changes by 전구 색상
      qty: ['200구', '500구'], bulbColor: ['전구색', '혼합색'], wireColor: ['녹색', '투명'],
      thumbnailKey: 'bulbColor',
      thumbnails: { '전구색': '/thumbnails/lights/popop_light_warm.jpg', '혼합색': '/thumbnails/lights/popop_light_multiColor.jpg' },
      colorsByBulbColor: {
        '전구색': ['#fff5cc'],
        // 혼합색: 3/4 warm white + 1/4 powdery sky blue (soft pale)
        '혼합색': ['#fff5cc', '#fff5cc', '#fff5cc', '#b8d4e8'],
      },
    },
    2: { // 파스텔팝 — warm-white center with orange/green/purple harmoniously mixed (per #전구 PDF note)
      qty: ['500구'], bulbColor: ['파스텔톤'], wireColor: ['녹색', '투명'],
      thumbnailKey: 'wireColor',
      thumbnails: { '녹색': '/thumbnails/lights/pastelpop_light_green.webp', '투명': '/thumbnails/lights/pastelpop_light_trans.webp' },
      colorsByBulbColor: {
        // 6-cycle: 3 warm + 1 each accent → 50% warm, 16.7% each accent
        '파스텔톤': ['#fff5cc', '#ff9a3d', '#fff5cc', '#7fcc7f', '#fff5cc', '#b48dd6'],
      },
    },
    3: { // 쥬얼라이트 (RGB) — warm + 다홍(scarlet) per #전구 PDF note
      qty: ['500구', '1000구'], bulbColor: ['전구색'], wireColor: ['녹색'],
      thumbnailKey: null,
      thumbnails: { '_default': '/thumbnails/lights/jewel_light_color.jpg' },
      colorsByBulbColor: {
        // 4-cycle: 75% warm + 25% scarlet ("다홍 빛이 부분적으로 섞여")
        '전구색': ['#fff5cc', '#fff5cc', '#fff5cc', '#e63946'],
      },
    },
    4: { // 클러스터 — thumbnail changes by 선 색상
      qty: ['1000구'], bulbColor: ['전구색'], wireColor: ['녹색', '투명'],
      thumbnailKey: 'wireColor',
      thumbnails: { '녹색': '/thumbnails/lights/cluster_light_green.jpg', '투명': '/thumbnails/lights/cluster_light_trans.jpg' },
      colorsByBulbColor: { '전구색': ['#fff5cc'] },
    },
    5: { // 좁쌀 — thumbnail changes by 선 색상
      qty: ['100구', '200구', '300구', '500구', '1000구'], bulbColor: ['전구색'], wireColor: ['검정', '투명'],
      thumbnailKey: 'wireColor',
      thumbnails: { '검정': '/thumbnails/lights/jopsal_light_black.jpg', '투명': '/thumbnails/lights/jopsal_light_trans.jpg' },
      colorsByBulbColor: { '전구색': ['#fff5cc'] },
    },
  };

  // Get the current thumbnail for a given light index (1-based)
  const getLightThumbnail = (lightIdx: number): string => {
    const opts = lightOptionsMap[lightIdx];
    if (!opts) return '';
    if (opts.thumbnailKey === null) return opts.thumbnails['_default'] || '';
    const key = opts.thumbnailKey === 'bulbColor' ? lightBulbColor : lightWireColor;
    return opts.thumbnails[key] || Object.values(opts.thumbnails)[0] || '';
  };
  const [selectedTree, setSelectedTree] = useState(1);
  const [selectedLight, setSelectedLight] = useState(0);
  const [selectedOrnament, setSelectedOrnament] = useState(0);
  const [selectedPointOrnament, setSelectedPointOrnament] = useState(0);
  const [ornamentQty, setOrnamentQty] = useState(1);
  const [pointOrnamentQty, setPointOrnamentQty] = useState(1);
  const [showHint, setShowHint] = useState(() => {
    const stored = localStorage.getItem('viewGuideHideUntil');
    return stored ? Date.now() >= Number(stored) : true;
  });
  const [helpIconGlow, setHelpIconGlow] = useState(false);

  // ---- Ornament storage panel state ----
  const sceneActionsRef = useRef<SceneActions | null>(null);
  const [storageItems, setStorageItems] = useState<StoredOrnamentInfo[]>([]);
  const [hasPickedOrnament, setHasPickedOrnament] = useState(false);
  const handleStorageChange = useCallback((items: StoredOrnamentInfo[]) => setStorageItems(items), []);
  const handlePickStateChange = useCallback((hasPick: boolean) => setHasPickedOrnament(hasPick), []);

  // ---- Admin default placement state ----
  const [adminPlacementMode, setAdminPlacementMode] = useState(false);

  const handleSavePlacement = useCallback(async () => {
    const preset = sceneActionsRef.current?.exportPlacement();
    if (!preset) return;
    try {
      const res = await fetch('/api/save-placement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preset),
      });
      if (res.ok) {
        alert('배치 설정이 저장되었습니다.');
      } else {
        alert('저장 실패: ' + (await res.text()));
      }
    } catch (e) {
      alert('저장 실패: ' + String(e));
    }
  }, []);

  // Reset light sub-options when light type changes — pick MAX qty by default
  useEffect(() => {
    const opts = lightOptionsMap[selectedLight];
    if (opts) {
      const maxQ = opts.qty.reduce(
        (best, q) => (parseInt(q, 10) > parseInt(best, 10) ? q : best),
        opts.qty[0],
      );
      setLightQuantity(maxQ);
      setLightBulbColor(opts.bulbColor[0]);
      setLightWireColor(opts.wireColor[0]);
    }
  }, [selectedLight]);

  // Numeric light count parsed from '구수 선택' (e.g. '500구' → 500). 0 when nothing selected.
  const lightCount = selectedLight > 0 ? parseInt(lightQuantity, 10) || 0 : 0;

  // Emissive palette for the currently-selected light + bulbColor combination.
  // Defaults to warm white if no light selected or no palette entry found.
  // Length 1 = single-color, Length >1 = multi-color cycled around the tree.
  // Memoized so the Scene's scatter useEffect doesn't re-fire on every parent render
  // (lightOptionsMap is rebuilt each render, so its array refs are fresh too).
  const lightColors = useMemo(
    () => {
      if (selectedLight <= 0) return ['#fff5cc'];
      const entry = lightOptionsMap[selectedLight];
      if (!entry) return ['#fff5cc'];
      return entry.colorsByBulbColor[lightBulbColor] || entry.colorsByBulbColor[entry.bulbColor[0]] || ['#fff5cc'];
    },
    [selectedLight, lightBulbColor],
  );

  // Sync light wrap mode with 장식 범위 (Step 1 selector) AND with the selected light family:
  //   - front-only → force 'front'
  //   - 360 mode → 'front' becomes '360'; '360-dense' demotes to '360' if the new family
  //     doesn't expose a 촘촘 option (LED / cluster).
  useEffect(() => {
    const family = selectedLight > 0 ? LIGHT_FAMILY[selectedLight] : null;
    if (frontOnlyMode) {
      setLightWrapMode('front');
      return;
    }
    setLightWrapMode((prev) => {
      let next: WrapKey = prev === 'front' ? '360' : prev;
      if (next === '360-dense' && (family === 'led' || family === 'cluster')) {
        next = '360';
      }
      return next;
    });
  }, [frontOnlyMode, selectedLight]);

  // Per-tree size + color options. Drives both the Step 1 selectors and the cart commit snapshot.
  //   sizes: string[] of cm-stripped labels (e.g. '150') — UI suffixes 'cm' for display + state
  //   colors: TreeColorOption[] — one entry per swatch button. `kind:'none'` renders gray "없음" placeholder
  //           (cart name skips color suffix for 'none').
  type TreeColorOption = {
    name: string;           // internal id (stored in cart row's `color` field)
    label: string;          // display label
    swatch:
      | { kind: 'solid'; color: string }
      | { kind: 'gradient'; from: string; to: string }
      | { kind: 'none' };
    sceneColor: string;     // hex passed to Scene's treeColor prop
  };
  type TreeOptions = { sizes: string[]; colors: TreeColorOption[] };
  const treeOptionsMap: Record<number, TreeOptions> = {
    1: { // 피시본 트리 — colors unchanged from prior UI (그린 + 믹스 투톤)
      sizes: ['120', '150', '180', '210'],
      colors: [
        { name: 'olive', label: '그린',     swatch: { kind: 'solid', color: '#4a5d23' }, sceneColor: '#4a5d23' },
        { name: 'mix',   label: '믹스 투톤', swatch: { kind: 'gradient', from: '#4a5d23', to: 'rgb(192, 207, 194)' }, sceneColor: '#4a5d23' },
      ],
    },
    2: { // 더퍼스트 트리 — no color options; single gray "없음" placeholder
      sizes: ['180', '210'],
      colors: [
        { name: 'none', label: '없음', swatch: { kind: 'none' }, sceneColor: '#4a5d23' },
      ],
    },
    3: { // 스케치 트리(올리브/스노우)
      sizes: ['120', '150', '180', '210'],
      colors: [
        { name: 'olive', label: '올리브', swatch: { kind: 'solid', color: '#4a5d23' }, sceneColor: '#4a5d23' },
        { name: 'snow',  label: '스노우', swatch: { kind: 'solid', color: '#f0f0f0' }, sceneColor: '#f0f0f0' },
      ],
    },
    4: { // 스케치 트리(핑크/로즈)
      sizes: ['150', '180', '210'],
      colors: [
        { name: 'pink', label: '핑크', swatch: { kind: 'solid', color: '#ffc0cb' }, sceneColor: '#ffc0cb' },
        { name: 'rose', label: '로즈', swatch: { kind: 'solid', color: '#c64073' }, sceneColor: '#c64073' },
      ],
    },
  };

  // Snap size/color to the new tree's first valid option whenever the tree changes
  // (prevents stale '150cm' selection when switching to a tree without that size, etc.)
  useEffect(() => {
    const opts = treeOptionsMap[selectedTree];
    if (!opts) return;
    const validSizes = opts.sizes.map(s => s + 'cm');
    if (!validSizes.includes(selectedSize)) setSelectedSize(validSizes[0]);
    const validColorNames = opts.colors.map(c => c.name);
    if (!validColorNames.includes(selectedColor)) setSelectedColor(opts.colors[0].name);
  }, [selectedTree]);

  const handlePageChange = (page: number) => {
    // Only allow going backwards via indicator
    if (page < currentPage) {
      setCurrentPage(page);
    }
  };

  const handleNext = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const handlePrev = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const addToCart = () => {
    // Build the commit candidate as a discriminated union, then per-kind merge.
    // After successful commit, clear the panel selection so the preview disappears
    // (otherwise the scene would render committed + an identical preview = visual doubling).
    let candidate: CartItem | null = null;

    if (currentPage === 1) {
      if (!selectedTree) return;
      const treePath = resolveTreeModel(selectedTree, selectedSize, selectedColor);
      const colorObj = treeOptionsMap[selectedTree]?.colors.find(c => c.name === selectedColor);
      const colorLabel = colorObj?.label || selectedColor;
      const baseName = treeNames[selectedTree] || `Tree ${selectedTree}`;
      // Skip color suffix when the tree has no real color choice (selectedColor === 'none')
      const nameTail = selectedColor === 'none' ? selectedSize : `${selectedSize} ${colorLabel}`;
      candidate = {
        uid: nextUid(),
        kind: 'tree',
        treeId: selectedTree,
        treePath,
        size: selectedSize,
        color: selectedColor,
        name: `${baseName} ${nameTail}`,
        thumbnail: treeThumbnails[selectedTree] || '',
        qty: 1,
      };
    } else if (currentPage === 2) {
      if (!selectedLight) return;
      const lightNames: Record<number, string> = { 1: '팝팝', 2: '파스텔팝', 3: '쥬얼라이트', 4: '클러스터', 5: '좁쌀' };
      const baseName = lightNames[selectedLight] || `Light ${selectedLight}`;
      // Cart qty = recommended SKU set count from #전구 PDF. Frozen at commit time.
      // Falls back to 1 when no recommendation is on file (e.g. an unmapped size/wrap combo).
      const setCount = getCartSetCount(selectedLight, lightCount, selectedSize, lightWrapMode) || 1;
      candidate = {
        uid: nextUid(),
        kind: 'light',
        lightId: selectedLight,
        bulbCount: lightCount,
        bulbColor: lightBulbColor,
        wireColor: lightWireColor,
        palette: lightColors,
        name: `${baseName} ${lightQuantity} ${lightBulbColor}`,
        thumbnail: getLightThumbnail(selectedLight),
        qty: setCount,
      };
    } else if (currentPage === 3) {
      if (!selectedOrnament) return;
      candidate = {
        uid: nextUid(),
        kind: 'ornament',
        ornamentId: selectedOrnament,
        name: ornamentNames[selectedOrnament] || `Ornament ${selectedOrnament}`,
        thumbnail: ornamentThumbnails[selectedOrnament] || '',
        qty: ornamentQty,
      };
    } else if (currentPage === 4) {
      if (!selectedPointOrnament) return;
      candidate = {
        uid: nextUid(),
        kind: 'point',
        pointId: selectedPointOrnament,
        name: pointOrnamentNames[selectedPointOrnament] || `Point ${selectedPointOrnament}`,
        thumbnail: pointOrnamentThumbnails[selectedPointOrnament] || '',
        qty: pointOrnamentQty,
      };
    }

    if (!candidate) return;

    setCartItems(prev => {
      // Merge rules per kind. Tree never merges.
      if (candidate.kind === 'light') {
        const idx = prev.findIndex(it =>
          it.kind === 'light' &&
          it.lightId === candidate.lightId &&
          it.bulbCount === candidate.bulbCount &&
          it.bulbColor === candidate.bulbColor &&
          it.wireColor === candidate.wireColor,
        );
        if (idx !== -1) {
          const updated = [...prev];
          const existing = updated[idx] as Extract<CartItem, { kind: 'light' }>;
          updated[idx] = { ...existing, qty: existing.qty + candidate.qty };
          return updated;
        }
      } else if (candidate.kind === 'ornament') {
        const idx = prev.findIndex(it => it.kind === 'ornament' && it.ornamentId === candidate.ornamentId);
        if (idx !== -1) {
          const updated = [...prev];
          const existing = updated[idx] as Extract<CartItem, { kind: 'ornament' }>;
          updated[idx] = { ...existing, qty: existing.qty + candidate.qty };
          return updated;
        }
      } else if (candidate.kind === 'point') {
        const idx = prev.findIndex(it => it.kind === 'point' && it.pointId === candidate.pointId);
        if (idx !== -1) {
          const updated = [...prev];
          const existing = updated[idx] as Extract<CartItem, { kind: 'point' }>;
          updated[idx] = { ...existing, qty: existing.qty + candidate.qty };
          return updated;
        }
      }
      // No merge → append as new row
      return [...prev, candidate];
    });

    setCartJingle(true);
    setIsCartOpen(true);

    // Clear the panel selection so the preview disappears (preview would otherwise visually
    // duplicate what's now in the cart). User re-clicks any thumbnail to preview again.
    if (candidate.kind === 'light')         setSelectedLight(0);
    else if (candidate.kind === 'ornament') setSelectedOrnament(0);
    else if (candidate.kind === 'point')    setSelectedPointOrnament(0);
    // Tree intentionally NOT cleared: panel selection drives the viewport tree (per Q6/Q10).
  };

  // Tree model resolution: specific (tree × size × color) variant first, then per-tree default,
  // then a global hard fallback. As real product variants are authored, drop them into treeVariantModels;
  // unmapped combos quietly fall back to the tree's default model so the UI never blanks out.
  const treeVariantModels: Record<string, string> = {
    '1-120cm-olive': '/models/trees/fishboneTree_green120.glb',
    '1-120cm-mix':   '/models/trees/fishboneTree_twotone120.glb',
    '1-150cm-olive': '/models/trees/fishboneTree_green150.glb',
    '1-150cm-mix':   '/models/trees/fishboneTree_twotone150.glb',
    '1-180cm-olive': '/models/trees/fishboneTree_green180.glb',
    '1-180cm-mix':   '/models/trees/fishboneTree_twotone180.glb',
    '3-150cm-olive': '/models/trees/sketchTree_olive150.glb',
    '3-180cm-olive': '/models/trees/sketchTree_olive180.glb',
    '3-180cm-snow':  '/models/trees/sketchTree_white180.glb',
  };
  const treeDefaultModel: Record<number, string> = {
    1: '/models/trees/fishboneTree_green150.glb',
    2: '/models/trees/fishboneTree_green150.glb', // placeholder until 더퍼스트 트리 model arrives
    3: '/models/trees/sketchTree_olive150.glb',
    4: '/models/trees/ultimate_tree_v2_test.glb',
  };
  const resolveTreeModel = (treeId: number, size: string, color: string): string => {
    return treeVariantModels[`${treeId}-${size}-${color}`]
        || treeDefaultModel[treeId]
        || '/models/trees/fishboneTree_green150.glb';
  };

  const treeNames: Record<number, string> = {
    1: '피시본 트리',
    2: '더퍼스트 트리',
    3: '스케치 트리(올리브/스노우)',
    4: '스케치 트리(로즈/핑크)',
  };

  const treeThumbnails: Record<number, string> = {
    1: '/thumbnails/tree/피시본 트리 그린 120 ~180cm.jpg',
    2: '/thumbnails/tree/최고급 PE100 전구 일체형 더퍼스트트리.jpg',
    3: '/thumbnails/tree/스케치 트리 올리브 120 ~ 210cm.jpg',
    4: '/thumbnails/tree/스케치 트리 로즈 150 ~ 210cm.jpg',
  };

  const ornamentNames: Record<number, string> = {
    1: '엔젤리나 50pcs',
    2: '레인보우캔디샵 70pcs',
    3: '디스코나잇 50pcs',
    4: '겨울숲 20pcs',
    5: '도트볼 18pcs',
    6: '아이스젬 18pcs',
    7: '발레프리즘 50pcs',
    8: '핑크루체 50pcs',
    9: '스노우 크리스탈 50pcs',
    10: '리치엘빈 70pcs',
    11: '코크베어 70pcs',
  };

  const ornamentThumbnails: Record<number, string> = {
    1: '/thumbnails/ornament/엔젤리나 50pcs.jpg',
    2: '/thumbnails/ornament/레인보우캔디샵 70pcs.jpg',
    3: '/thumbnails/ornament/디스코나잇 50pcs.jpg',
    4: '/thumbnails/ornament/겨울숲 20pcs.jpg',
    5: '/thumbnails/ornament/도트볼 18pcs.jpg',
    6: '/thumbnails/ornament/아이스젬 18pcs.jpg',
    7: '/thumbnails/ornament/발레프리즘 50pcs.jpg',
    8: '/thumbnails/ornament/핑크루체 50pcs.jpg',
    9: '/thumbnails/ornament/스노우 크리스탈 50pcs.jpg',
    10: '/thumbnails/ornament/리치엘빈 70pcs.jpg',
    11: '/thumbnails/ornament/코크베어 70pcs.jpg',
  };

  const pointOrnamentNames: Record<number, string> = {
    1: '리치알빈',
    2: '코크베어',
    3: '브라더스 루돌프',
    4: '브라더스 산타',
  };

  const pointOrnamentThumbnails: Record<number, string> = {
    1: '/thumbnails/point/alvin_point_thumbnail.jpg',
    2: '/thumbnails/point/cokebear_point_thumbnail.jpg',
    3: '/thumbnails/point/rudolf_point_thumbnail.jpg',
    4: '/thumbnails/point/santa_point_thumbnail.jpg',
  };

  // ---- Scene layer derivation (cart + preview) ----
  // Each panel's currently-selected item ("preview") is appended to the committed layers
  // from the cart. addToCart clears the preview after a commit, so the preview never
  // visually duplicates a freshly-committed row.

  // Lights: one layer per cart row + (optional) preview layer for the current panel selection.
  // Scene bulb counts come from the #트리 recommendation table — NOT the cart row's purchase
  // count. The cart row stores SKU info (qty unit + set multiplier) for purchase; the scene
  // renders whatever the table says looks right for current (tree, size, family, wrap).
  //
  // Reactive: any change to tree/size/wrap re-derives the scene count for every layer
  // (Q4 = re-apply). Cart purchase numbers stay frozen at commit time.
  type LightLayer = { layerId: string; lightId: number; bulbCount: number; palette: string[] };
  const lightLayers = useMemo<LightLayer[]>(() => {
    // 더퍼스트 — 전구 일체형 (built-in baked lights). Hard gate: no add-on lights render
    // regardless of cart contents. When the real 더퍼스트 model lands, its lights will
    // already be part of the GLB.
    if (selectedTree === 2) return [];
    const layers: LightLayer[] = [];
    cartItems.forEach(item => {
      if (item.kind !== 'light') return;
      const bulbCount = getSceneBulbCount(selectedTree, selectedSize, item.lightId, lightWrapMode);
      if (bulbCount <= 0) return; // no #트리 data (e.g. 더퍼스트) → skip rendering
      layers.push({
        layerId: `cart-${item.uid}`,
        lightId: item.lightId,
        bulbCount,
        palette: item.palette,
      });
    });
    if (selectedLight > 0) {
      const bulbCount = getSceneBulbCount(selectedTree, selectedSize, selectedLight, lightWrapMode);
      if (bulbCount > 0) {
        layers.push({
          layerId: 'preview',
          lightId: selectedLight,
          bulbCount,
          palette: lightColors,
        });
      }
    }
    return layers;
  }, [cartItems, selectedLight, lightColors, selectedTree, selectedSize, lightWrapMode]);

  // Bead string: active when any committed or preview layer references ornament#1.
  // Single instance regardless of stack depth — they'd all render at the same origin point.
  const beadStringActive = useMemo(() => {
    if (selectedOrnament === 1) return true;
    return cartItems.some(it => it.kind === 'ornament' && it.ornamentId === 1);
  }, [cartItems, selectedOrnament]);

  // Ornament render config — currently only ornament#1 has GLB wiring (ORNAMENT_CONFIG).
  // Other ornament catalog entries are placeholder UI; their cart commits persist in state
  // but contribute nothing to the scene until per-ornament GLB sets are wired in a follow-up.
  // For now: sum qty across all ornament#1 layers (committed + preview), scale ORNAMENT_CONFIG.
  const scaledOrnamentConfig = useMemo(() => {
    let totalQty = 0;
    cartItems.forEach(it => {
      if (it.kind === 'ornament' && it.ornamentId === 1) totalQty += it.qty;
    });
    if (selectedOrnament === 1) totalQty += ornamentQty;
    if (totalQty < 1) return [];
    return ORNAMENT_CONFIG.map(c => ({ path: c.path, qty: c.qty * totalQty }));
  }, [cartItems, selectedOrnament, ornamentQty]);

  const pageTitles = [
    "1. 트리를 선택하세요.",
    "2. 전구를 선택하세요.",
    "3. 오너먼트를 선택하세요.",
    "4. 포인트 오너먼트를 선택하세요."
  ];

  return (
    <Tooltip.Provider>
      <div className="flex h-screen w-full bg-white overflow-hidden">
        {/* 3D Viewer Area - Resizes when panel toggles */}
        <div 
          className="relative flex-1 min-w-0 transition-all duration-500 ease-in-out"
        >
          {/* 3D Canvas */}
          <div className="absolute inset-0 z-0">
            <Scene
              treeModelPath={resolveTreeModel(selectedTree, selectedSize, selectedColor)}
              treeColor={treeOptionsMap[selectedTree]?.colors.find(c => c.name === selectedColor)?.sceneColor || '#2d5a27'}
              lightMode={lightMode}
              ornamentConfig={scaledOrnamentConfig}
              rearrangeMode={rearrangeMode || adminPlacementMode}
              hdriPath="/models/hdri/brown_photostudio_02_1k.exr"
              beadStringPath={beadStringActive ? '/models/bead_string.glb' : undefined}
              placementPresetPath="/settings/placements.json"
              actionsRef={sceneActionsRef}
              onStorageChange={handleStorageChange}
              onPickStateChange={handlePickStateChange}
              frontOnly={frontOnlyMode}
              lightLayers={lightLayers}
            />
          </div>

          {/* Top Left Shopping Cart UI */}
          <motion.div
            initial={false}
            animate={{ 
              width: isCartOpen ? "auto" : 80,
              borderRadius: 20
            }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="absolute top-8 left-8 z-10 h-[122px] bg-white border border-slate-900/10 shadow-[0_8px_32px_0_rgba(31,38,135,0.1)] overflow-hidden origin-left"
          >
            <AnimatePresence mode="wait">
              {!isCartOpen ? (
                <motion.button
                  key="collapsed"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setIsCartOpen(true)}
                  className="w-full h-full flex flex-col items-center justify-center text-slate-600 hover:text-slate-800 gap-1"
                >
                  <motion.div
                    animate={cartJingle ? {
                      rotate: [0, -15, 15, -10, 10, -5, 5, 0],
                      scale: [1, 1.15, 1.15, 1.1, 1.1, 1.05, 1.05, 1],
                    } : {}}
                    transition={cartJingle ? { duration: 0.6, ease: 'easeInOut' } : {}}
                    onAnimationComplete={() => setCartJingle(false)}
                  >
                    <ShoppingBag className="size-9" />
                  </motion.div>
                  {cartItems.length > 0 && (
                    <span className="text-xs font-bold text-blue-600">{cartItems.length}</span>
                  )}
                </motion.button>
              ) : (
                <motion.div
                  key="expanded"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex items-center gap-4 px-6 min-w-max"
                >
                  <div className="flex items-center gap-3">
                    {/* Shopping Bag Icon (Visible in Expanded) */}
                    <motion.div
                      animate={cartJingle ? {
                        rotate: [0, -15, 15, -10, 10, -5, 5, 0],
                        scale: [1, 1.15, 1.15, 1.1, 1.1, 1.05, 1.05, 1],
                      } : {}}
                      transition={cartJingle ? { duration: 0.6, ease: 'easeInOut' } : {}}
                      onAnimationComplete={() => setCartJingle(false)}
                      className="mr-2 text-slate-700"
                    >
                      <ShoppingBag className="size-8" />
                    </motion.div>

                    {cartItems.length === 0 ? (
                      <div className="text-sm text-slate-400 font-medium px-4">장바구니가 비어있어요</div>
                    ) : (
                      <AnimatePresence mode="popLayout">
                      {cartItems.map((item, idx) => (
                        <motion.div
                          key={`${item.name}-${idx}`}
                          layout
                          initial={{ opacity: 0, scale: 0.5 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, y: 40, scale: 0.8 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                          className="relative w-20 h-[96px] rounded-xl bg-white border border-white/50 shadow-sm overflow-visible group cursor-pointer hover:border-blue-400 transition-colors flex flex-col items-center"
                          title={item.name}
                        >
                          <div className="w-20 h-20 relative rounded-t-xl overflow-hidden shrink-0">
                            {item.thumbnail ? (
                              <img
                                src={item.thumbnail}
                                alt={item.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xs text-slate-500 font-medium p-1 text-center">
                                {item.name}
                              </div>
                            )}
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                          </div>
                          <div className="w-full px-1 py-0.5 text-center overflow-hidden bg-[#334155] rounded-b-xl">
                            <span className="text-[10px] font-medium text-[#F8FAFC] leading-tight truncate block">{item.name}</span>
                          </div>
                          {item.qty > 1 && (
                            <div className="absolute top-0 right-0 min-w-[24px] h-[18px] px-1.5 bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-sm z-10">
                              {item.qty}
                            </div>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setCartItems(prev => prev.filter((_, i) => i !== idx));
                            }}
                            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-slate-800 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 shadow-md z-10"
                          >
                            <span className="text-xs font-bold leading-none">×</span>
                          </button>
                        </motion.div>
                      ))}
                      </AnimatePresence>
                    )}
                  </div>
                  
                  <div className="w-px h-12 bg-slate-300/50 mx-2" />
                  
                  <button 
                    onClick={() => setIsCartOpen(false)}
                    className="p-3 hover:bg-slate-900/10 rounded-full transition-colors text-slate-500 hover:text-slate-700 shrink-0"
                  >
                    <ChevronLeft className="size-6" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
          
          {/* Help Icon - Bottom Left */}
          <motion.button
            onClick={() => setShowHint(true)}
            animate={helpIconGlow ? {
              boxShadow: [
                '0 0 0px 0px rgba(59,130,246,0), 0 0 0px rgba(59,130,246,0)',
                '0 0 12px 6px rgba(59,130,246,0.6), 0 0 30px rgba(59,130,246,0.3)',
                '0 0 0px 0px rgba(59,130,246,0), 0 0 0px rgba(59,130,246,0)',
              ],
            } : {}}
            transition={helpIconGlow ? { duration: 0.7, repeat: 1, ease: 'easeInOut' } : {}}
            onAnimationComplete={() => setHelpIconGlow(false)}
            className="absolute bottom-6 left-6 z-40 w-11 h-11 rounded-full bg-white/60 backdrop-blur-xl border border-white/50 shadow-lg shadow-slate-200/50 flex items-center justify-center hover:bg-white/80 transition-colors cursor-pointer"
          >
            <HelpCircle className="size-5 text-slate-700" />
          </motion.button>

          {/* 3D Viewport Guide Popup */}
          <AnimatePresence>
            {showHint && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                  exit={{ 
                    opacity: 0, 
                    scale: 0.1,
                    x: '-40vw',
                    y: '40vh',
                  }}
                  transition={{ 
                    duration: 0.4, 
                    ease: [0.4, 0, 0.2, 1],
                  }}
                  className="bg-white/60 backdrop-blur-xl rounded-2xl shadow-lg shadow-slate-200/50 border border-white/50 p-8 max-w-sm w-[90%] mx-4 pointer-events-auto"
                >
                  <h2 className="text-lg font-bold text-black text-center mb-6">
                    🎄 3D 뷰 조작 가이드
                  </h2>

                  <div className="flex flex-col gap-4 mb-8">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                        <Mouse className="size-5 text-slate-600" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-black">회전</p>
                        <p className="text-sm text-black/80">마우스 왼쪽 버튼을 누른 채 드래그하면 트리를 돌려볼 수 있어요.</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                        <ZoomIn className="size-5 text-slate-600" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-black">확대/축소</p>
                        <p className="text-sm text-black/80">마우스 휠을 스크롤하면 가까이 또는 멀리 볼 수 있어요.</p>
                      </div>
                    </div>

                  </div>

                  <label className="flex items-center gap-2 mb-5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      onChange={(e) => {
                        if (e.target.checked) {
                          const endOfDay = new Date();
                          endOfDay.setHours(23, 59, 59, 999);
                          localStorage.setItem('viewGuideHideUntil', String(endOfDay.getTime()));
                        } else {
                          localStorage.removeItem('viewGuideHideUntil');
                        }
                      }}
                    />
                    <span className="text-sm text-black/70">오늘 하루 그만보기</span>
                  </label>

                  <button
                    onClick={() => {
                      setShowHint(false);
                      setHelpIconGlow(true);
                    }}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors shadow-md shadow-blue-500/20 active:scale-[0.98]"
                  >
                    확인
                  </button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Rearrange Mode Tutorial Modal */}
          <AnimatePresence>
            {showRearrangeGuide && (
              <motion.div
                key="rearrange-guide-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px] pointer-events-auto"
                onClick={(e) => e.target === e.currentTarget && setShowRearrangeGuide(false)}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                  className="bg-white/60 backdrop-blur-xl rounded-2xl shadow-lg shadow-slate-200/50 border border-white/50 p-8 max-w-sm w-[90%] mx-4 pointer-events-auto"
                >
                  <h2 className="text-lg font-bold text-black text-center mb-6">
                    ✨ 오너먼트 재배치 가이드
                  </h2>

                  <div className="flex flex-col gap-4 mb-6">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
                        <MousePointer2 className="size-5 text-blue-500" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-black">오너먼트 선택</p>
                        <p className="text-sm text-black/80">원하는 오너먼트를 클릭하면 선택됩니다. 선택된 오너먼트는 청록색으로 빛나요.</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
                        <Grip className="size-5 text-blue-500" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-black">빈 자리에 배치</p>
                        <p className="text-sm text-black/80">회색 점이 빈 자리예요. 원하는 위치를 클릭하면 오너먼트가 이동합니다.</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
                        <RotateCw className="size-5 text-blue-500" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-black">선택 취소</p>
                        <p className="text-sm text-black/80">선택된 오너먼트를 다시 클릭하면 선택이 취소되고 원래 자리로 돌아갑니다.</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
                        <Package className="size-5 text-blue-500" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-black">오너먼트 보관함</p>
                        <p className="text-sm text-black/80">오른쪽 보관함의 빈 칸을 클릭하면 선택한 오너먼트가 보관돼요. 보관된 오너먼트를 클릭하면 다시 꺼내서 트리에 배치할 수 있어요.</p>
                      </div>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 mb-5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      onChange={(e) => {
                        if (e.target.checked) {
                          const endOfDay = new Date();
                          endOfDay.setHours(23, 59, 59, 999);
                          localStorage.setItem('rearrangeGuideHideUntil', String(endOfDay.getTime()));
                          setRearrangeGuideHideToday(true);
                        } else {
                          localStorage.removeItem('rearrangeGuideHideUntil');
                          setRearrangeGuideHideToday(false);
                        }
                      }}
                    />
                    <span className="text-sm text-black/70">오늘 하루 그만보기</span>
                  </label>

                  <button
                    onClick={() => setShowRearrangeGuide(false)}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors shadow-md shadow-blue-500/20 active:scale-[0.98]"
                  >
                    확인
                  </button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Floating Toolbar & Price Indicator Container */}
        <div className="absolute bottom-[8%] left-1/2 -translate-x-1/2 z-10 w-full max-w-fit px-4">
          <motion.div 
            initial={false}
            className="h-[76px] bg-gray-100 backdrop-blur-xl border border-slate-200/60 shadow-[0_8px_32px_0_rgba(31,38,135,0.15)] rounded-[20px] flex items-center px-8 gap-2 whitespace-nowrap opacity-30 hover:opacity-100 transition-opacity duration-300"
          >
             {/* Action Buttons */}
             <div className="flex items-center gap-0">
               <button onClick={() => {}} className="flex flex-row items-center gap-2.5 px-4 py-2.5 hover:bg-slate-200/60 rounded-lg text-slate-700 hover:text-slate-900 transition-colors group">
                 <RefreshCw className="size-[18px] group-hover:rotate-180 transition-transform" />
                 <span className="text-[15px] font-semibold">초기화</span>
               </button>
               <div className="w-px h-6 bg-slate-300 mx-1" />
               
               <button onClick={() => {}} className="flex flex-row items-center gap-2.5 px-4 py-2.5 hover:bg-slate-200/60 rounded-lg text-slate-700 hover:text-slate-900 transition-colors">
                 <Save className="size-[18px]" />
                 <span className="text-[15px] font-semibold">저장</span>
               </button>
               <div className="w-px h-6 bg-slate-300 mx-1" />

               <button onClick={() => {}} className="flex flex-row items-center gap-2.5 px-4 py-2.5 hover:bg-slate-200/60 rounded-lg text-slate-700 hover:text-slate-900 transition-colors">
                 <FolderOpen className="size-[18px]" />
                 <span className="text-[15px] font-semibold">불러오기</span>
               </button>
               <div className="w-px h-6 bg-slate-300 mx-1" />

               <button
                 onClick={() => {
                   const dataUrl = sceneActionsRef.current?.captureScreenshot();
                   if (!dataUrl) return;
                   const now = new Date();
                   const hh = String(now.getHours()).padStart(2, '0');
                   const mm = String(now.getMinutes()).padStart(2, '0');
                   const ss = String(now.getSeconds()).padStart(2, '0');
                   const name = treeNames[selectedTree] || `Tree ${selectedTree}`;
                   const safeName = name.replace(/[^\p{L}\p{N}_-]+/gu, '_');
                   const a = document.createElement('a');
                   a.href = dataUrl;
                   a.download = `${safeName}-${hh}${mm}${ss}.png`;
                   document.body.appendChild(a);
                   a.click();
                   document.body.removeChild(a);
                 }}
                 className="flex flex-row items-center gap-2.5 px-4 py-2.5 hover:bg-slate-200/60 rounded-lg text-slate-700 hover:text-slate-900 transition-colors"
               >
                 <Camera className="size-[18px]" />
                 <span className="text-[15px] font-semibold">스크린샷</span>
               </button>
             </div>

             {/* Divider */}
             <div className="w-px h-10 bg-slate-300 mx-4" />

             {/* Price */}
             <div className="flex items-center gap-3">
                <span className="text-slate-500 text-[15px] font-semibold">총 금액</span>
                <span className="text-slate-900 font-bold text-xl tabular-nums">230,000<span className="text-[15px] font-semibold ml-0.5">원</span></span>
             </div>
          </motion.div>
        </div>

          {/* Toggle Button - Attached to the right edge of the viewer */}
          <button
            onClick={() => setIsPanelOpen(!isPanelOpen)}
            className="absolute right-0 top-24 z-30 flex items-center justify-center w-10 h-12 bg-gray-100 rounded-l-lg shadow-[-2px_0_5px_rgba(0,0,0,0.1)] hover:bg-white transition-colors border-y border-l border-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            aria-label={isPanelOpen ? "Enter full screen" : "Open controls"}
          >
            {isPanelOpen ? (
              <ChevronRight className="size-5 text-gray-600" />
            ) : (
              <ChevronLeft className="size-5 text-gray-600" />
            )}
          </button>

          {/* Admin: Default Placement Buttons */}
          <div className="absolute right-6 top-6 z-20 flex gap-2 items-center">
            <button
              onClick={() => {
                if (adminPlacementMode) {
                  setAdminPlacementMode(false);
                } else {
                  setAdminPlacementMode(true);
                }
              }}
              className={`h-9 px-4 rounded-[12px] backdrop-blur-xl border shadow-md transition-all flex items-center gap-2 text-xs font-bold ${
                adminPlacementMode
                  ? 'bg-orange-100/90 border-orange-300/60 text-orange-700'
                  : 'bg-gray-100/90 border-slate-200/60 text-slate-600 hover:bg-gray-200/70'
              }`}
            >
              <LayoutGrid className="size-3.5" />
              오너먼트 디폴트 배치
            </button>
            {adminPlacementMode && (
              <button
                onClick={handleSavePlacement}
                className="h-9 px-4 rounded-[12px] backdrop-blur-xl border shadow-md bg-green-100/90 border-green-300/60 text-green-700 hover:bg-green-200/70 transition-all flex items-center gap-2 text-xs font-bold"
              >
                <Save className="size-3.5" />
                배치 셋팅 저장
              </button>
            )}
          </div>

          {/* 2 Floating Buttons - Vertical Column next to panel */}
          <div className="absolute right-6 top-40 z-20 flex flex-col gap-3 items-end">

            {/* 1. Ornament Button */}
            <motion.div layout className="flex flex-col items-end">
              <button
                onClick={() => {
                  if (!rearrangeMode) {
                    // Entering rearrange mode
                    if (!rearrangeGuideHideToday) {
                      setShowRearrangeGuide(true);
                    }
                    setRearrangeMode(true);
                  } else {
                    setRearrangeMode(false);
                  }
                }}
                className={`w-[150px] h-10 px-4 rounded-[15px] backdrop-blur-xl border shadow-md hover:bg-gray-200/70 transition-all flex items-center justify-center gap-0 group ${rearrangeMode ? 'bg-blue-100/90 border-blue-300/60' : 'bg-gray-100/90 border-slate-200/60'}`}
              >
                <Gem className="size-4 text-slate-700" />
                <div className="w-px h-5 bg-slate-300/70 mx-2" />
                <span className="text-xs font-bold text-slate-700 whitespace-nowrap">오너먼트 재배치</span>
              </button>
            </motion.div>

            {/* 2. Lightbulb Button */}
            <motion.div layout className="flex flex-col items-end">
              <button
                onClick={cycleLightMode}
                className={`w-[150px] h-10 px-4 rounded-[15px] border shadow-md transition-all flex items-center justify-center gap-0 ${
                  lightMode === 'on'
                    ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
                    : lightMode === 'blink'
                    ? 'bg-green-50 text-green-700 border-green-200'
                    : 'bg-gray-100/90 backdrop-blur-xl border-slate-200/60 text-slate-700 hover:bg-gray-200/70'
                }`}
              >
                <Lightbulb className={`size-4 ${lightMode !== 'off' ? 'fill-yellow-500 text-yellow-500' : 'text-slate-700'}`} />
                <div className="w-px h-5 bg-slate-300/70 mx-2" />
                <span className="text-xs font-bold">
                  {lightMode === 'on' ? '전구 ON' : lightMode === 'blink' ? '점멸모드' : '전구 OFF'}
                </span>
              </button>
            </motion.div>


          </div>

          {/* Ornament Storage Panel — slides in during rearrange mode */}
          <AnimatePresence>
            {rearrangeMode && (
              <motion.div
                initial={{ x: 220, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 220, opacity: 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="absolute bottom-[18%] right-6 z-20 w-[180px] bg-white/80 backdrop-blur-xl rounded-2xl border border-slate-200/60 shadow-lg overflow-hidden"
              >
                {/* Header */}
                <div className="relative px-4 pt-4 pb-2 flex items-center gap-2">
                  <Package className="size-4 text-slate-500" />
                  <h4 className="text-sm font-bold text-slate-800">오너먼트 보관함</h4>
                  {storageItems.length > 0 && (
                    <div className="absolute top-3 right-3 min-w-[20px] h-[20px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
                      {storageItems.length}
                    </div>
                  )}
                </div>

                {/* Slots Grid — fixed height, scrollable */}
                <div className="px-4 pb-2 max-h-[240px] overflow-y-auto custom-scrollbar">
                  <div className="grid grid-cols-2 gap-2">
                    {/* Always show at least 6 slots; extra empty slot when items fill the grid */}
                    {Array.from({ length: Math.max(6, storageItems.length + (hasPickedOrnament ? 1 : 0)) }).map((_, idx) => {
                      const item = storageItems[idx] ?? null;
                      const isEmpty = !item;
                      const canStore = isEmpty && hasPickedOrnament;
                      return (
                        <button
                          key={idx}
                          onClick={() => {
                            if (item) {
                              sceneActionsRef.current?.retrieveFromStorage(item.key);
                            } else if (hasPickedOrnament) {
                              sceneActionsRef.current?.storeCurrentPick();
                            }
                          }}
                          className={`aspect-square rounded-xl transition-all duration-150 ${
                            item
                              ? 'bg-slate-200/90 border-2 border-slate-300/80 cursor-pointer hover:border-blue-400'
                              : canStore
                                ? 'bg-blue-50/60 border-2 border-dashed border-blue-300 cursor-pointer hover:bg-blue-100/60'
                                : 'bg-slate-100/60 border-2 border-dashed border-slate-200 cursor-default'
                          }`}
                          style={{ boxShadow: item ? 'inset 0 2px 8px rgba(0,0,0,0.12)' : 'inset 0 2px 4px rgba(0,0,0,0.06)' }}
                          disabled={isEmpty && !hasPickedOrnament}
                        >
                          {item?.thumbnail ? (
                            <img src={item.thumbnail} alt="" className="w-full h-full object-cover rounded-lg" />
                          ) : item ? (
                            <div className="w-full h-full flex items-center justify-center">
                              <Gem className="size-5 text-slate-500" />
                            </div>
                          ) : canStore ? (
                            <div className="w-full h-full flex items-center justify-center">
                              <span className="text-lg text-blue-400 font-light">+</span>
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Footer message */}
                <div className="px-4 pb-4 pt-1">
                  <p className="text-[10px] text-slate-400 leading-tight text-center">보관함에 담긴 오너먼트를 다시 트리에 배치할 수 있습니다.</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>

        {/* Retractable Control Panel - Layout Flow */}
        <motion.div
          initial={{ width: 384 }}
          animate={{ width: isPanelOpen ? 384 : 0 }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="relative bg-gray-100 shadow-2xl overflow-hidden border-l border-white/50 flex flex-col"
        >
          {/* Fixed width container to prevent content squishing during animation */}
          <div className="w-96 h-full flex flex-col relative">
             
             {/* 1. Header Area (Page Indicators) */}
             <div className="shrink-0 pt-8 pb-4 px-6 flex flex-col items-center gap-4">
               {/* Page Indicators */}
               <div className="flex items-center justify-center space-x-2">
                 {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                   const isActive = page === currentPage;
                   const isPast = page < currentPage;
                   
                   return (
                     <div key={page} className="flex items-center">
                        <button
                          onClick={() => handlePageChange(page)}
                          disabled={!isPast}
                          className={`
                            flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-colors
                            ${isActive ? 'bg-blue-600 text-white shadow-md' : ''}
                            ${isPast ? 'bg-white text-gray-700 hover:bg-gray-50 cursor-pointer border border-gray-200' : ''}
                            ${!isActive && !isPast ? 'bg-gray-200 text-gray-400 cursor-default' : ''}
                          `}
                        >
                          {page}
                        </button>
                        {page < totalPages && (
                          <div className="mx-2 text-slate-300 font-medium text-xs">
                            {isPast ? '>>' : '>>'}
                          </div>
                        )}
                     </div>
                   );
                 })}
               </div>
             </div>

             {/* 2. Main Container (Card UI) */}
             <div className="flex-1 mx-4 mb-4 bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden flex flex-col">

               {/* Decoration Range Selector — Page 1 only, above the Step Title */}
               {currentPage === 1 && (
                 <div className="shrink-0 pt-5 pb-4 px-6 border-b border-slate-100/50">
                   <h4 className="text-sm font-bold text-slate-600 mb-2.5">장식 범위</h4>
                   <div className="grid grid-cols-2 gap-2.5">
                     <button
                       onClick={() => setFrontOnlyMode(true)}
                       className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 transition-colors ${frontOnlyMode ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                     >
                       <TreePine className={`size-5 ${frontOnlyMode ? 'text-blue-600' : 'text-slate-600'}`} />
                       <span className={`text-sm font-semibold ${frontOnlyMode ? 'text-blue-700' : 'text-slate-700'}`}>앞면만 장식</span>
                     </button>
                     <button
                       onClick={() => setFrontOnlyMode(false)}
                       className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 transition-colors ${!frontOnlyMode ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                     >
                       <RotateCw className={`size-5 ${!frontOnlyMode ? 'text-blue-600' : 'text-slate-600'}`} />
                       <span className={`text-sm font-semibold ${!frontOnlyMode ? 'text-blue-700' : 'text-slate-700'}`}>360도 전체 장식</span>
                     </button>
                   </div>
                   <p className="mt-2.5 text-xs text-slate-500 flex items-start gap-1.5">
                     <Info className="size-3.5 mt-0.5 shrink-0" />
                     선택한 범위에 따라 전구와 오너먼트 권장 수량이 달라집니다.
                   </p>
                 </div>
               )}

               {/* Step Title (Inside Card) */}
               <div className="pt-6 pb-3 px-6 text-left border-b border-slate-100/50">
                 <h3 className="text-xl font-bold text-slate-800">{pageTitles[currentPage - 1]}</h3>
                 <p className="text-sm text-slate-500 mt-1.5">
                   {currentPage === 1 ? '원하시는 트리를 선택해주세요.' : currentPage === 2 ? '원하시는 전구를 선택해주세요.' : '원하시는 트리를 선택해주세요.'}
                 </p>
               </div>

               {currentPage === 1 ? (
                 <div className="flex flex-col h-full min-h-0">
                   
                   {/* Scrollable: Tree Selector */}
                   <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                     <div className="grid grid-cols-2 gap-3">
                       {[1, 2, 3, 4].map((i) => (
                         <button 
                           key={i}
                           onClick={() => setSelectedTree(i)}
                           className={`group relative flex flex-col rounded-xl overflow-hidden transition-all shadow-sm border-2 ${selectedTree === i ? 'border-blue-500 bg-blue-500' : 'border-transparent bg-white'}`}
                         >
                           {/* Checkbox (Top Right) */}
                           <div className={`absolute top-2 right-2 z-10 w-6 h-6 rounded border-2 flex items-center justify-center transition-all shadow-sm ${selectedTree === i ? 'bg-blue-500 border-blue-500' : 'bg-white/90 border-slate-300'}`}>
                              {selectedTree === i && <Check className="size-3.5 text-white" />}
                           </div>

                           {/* Image - Full Bleed */}
                           <div className="aspect-[5/4] w-full relative bg-white">
                             <img 
                               src={treeThumbnails[i] || "https://images.unsplash.com/photo-1576561121736-1fc8c3786b5a?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjaHJpc3RtYXMlMjB0cmVlJTIwaXNvbGF0ZWQlMjB3aGl0ZSUyMGJhY2tncm91bmR8ZW58MXx8fHwxNzcwMjA0NTk4fDA&ixlib=rb-4.1.0&q=80&w=1080"} 
                               alt={`Tree Option ${i}`}
                               className="w-full h-full object-cover mix-blend-multiply transition-transform duration-700 group-hover:scale-105"
                             />
                             <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                           </div>
                           
                           {/* Footer Label */}
                           <div className={`py-2.5 text-center text-sm font-semibold transition-colors ${selectedTree === i ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border-t border-slate-100'}`}>
                             {treeNames[i]}
                           </div>
                         </button>
                       ))}
                     </div>
                   </div>

                   {/* Separator */}
                   <div className="w-full h-px bg-slate-100 shrink-0" />

                   {/* Fixed Bottom Section: Colors, Sizes, Buttons */}
                   <div className="shrink-0 p-4 bg-gray-50/50 flex flex-col gap-5">
                     
                     {/* Color Selector — per-tree options */}
                     <div className="space-y-2.5">
                       <h4 className="text-sm font-bold text-slate-600 flex items-center gap-1.5">
                         <Palette className="size-4" /> 컬러 선택
                       </h4>
                       <div className="grid grid-cols-2 gap-2">
                          {(treeOptionsMap[selectedTree]?.colors ?? []).map((color) => {
                            const isSelected = selectedColor === color.name;
                            const isNone = color.swatch.kind === 'none';
                            const swatchStyle =
                              color.swatch.kind === 'gradient'
                                ? { background: `linear-gradient(to right, ${color.swatch.from} 50%, ${color.swatch.to} 50%)` }
                                : color.swatch.kind === 'solid'
                                  ? { backgroundColor: color.swatch.color }
                                  : { backgroundColor: '#cbd5e1' }; // slate-300 for "없음"
                            return (
                              <button
                                key={color.name}
                                onClick={() => setSelectedColor(color.name)}
                                className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group ${
                                  isNone
                                    ? 'bg-slate-100 border-2 border-slate-200'
                                    : 'bg-white ' + (isSelected
                                      ? 'border-2 border-blue-500 shadow-sm'
                                      : 'border-2 border-slate-200 hover:border-slate-300')
                                }`}
                              >
                                <div className="w-8 h-8 rounded-full" style={swatchStyle}></div>
                                <div className="text-left flex-1">
                                  <div className={`text-sm font-semibold ${isNone ? 'text-slate-400' : 'text-slate-800'}`}>{color.label}</div>
                                </div>
                                {isSelected && !isNone && <Check className="size-4 text-blue-500" />}
                              </button>
                            );
                          })}
                       </div>
                     </div>

                     {/* Size Selector — per-tree options */}
                     <div className="space-y-2.5">
                       <h4 className="text-sm font-bold text-slate-600 flex items-center gap-1.5">
                         <Ruler className="size-4" /> 사이즈 선택
                       </h4>
                       <div className="flex gap-2">
                          {(treeOptionsMap[selectedTree]?.sizes ?? []).map((label) => (
                            <button
                              key={label}
                              onClick={() => setSelectedSize(label + 'cm')}
                              className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
                                selectedSize === label + 'cm'
                                  ? 'bg-blue-600 text-white shadow-sm border-2 border-blue-600'
                                  : 'bg-white text-slate-600 border-2 border-slate-200 hover:border-slate-300'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                       </div>
                     </div>

                     {/* Footer Actions */}
                     <div className="pt-2 flex flex-col gap-3">
                       <div className="flex items-center gap-1.5 justify-center text-slate-500 py-1.5">
                         <Info className="size-4" />
                         <span className="text-sm font-medium">상품 담기를 누른 상품만 장바구니에 담깁니다.</span>
                       </div>

                       <div className="flex flex-col gap-2">
                         <button
                           onClick={addToCart}
                           className="w-full py-3 rounded-xl font-bold text-sm transition-all bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 shadow-sm active:scale-[0.98] flex items-center justify-center gap-1.5"
                         >
                           <ShoppingBag className="size-4" /> 상품 담기
                         </button>

                         <div className="flex gap-2">
                           <button
                             onClick={handlePrev}
                             disabled={currentPage === 1}
                             className={`
                               flex-1 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1
                               ${currentPage === 1 
                                 ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                                 : 'bg-slate-200 text-slate-700 hover:bg-slate-300 active:scale-[0.98]'}
                             `}
                           >
                             <ChevronLeft className="size-3.5" /> 이전 단계
                           </button>

                           <button
                             onClick={handleNext}
                             disabled={currentPage === totalPages}
                             className={`
                               flex-1 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1
                               ${currentPage === totalPages 
                                 ? 'bg-blue-300 text-white cursor-not-allowed' 
                                 : 'bg-blue-600 text-white shadow-md hover:bg-blue-700 shadow-blue-500/20 active:scale-[0.98]'}
                             `}
                           >
                             다음 단계 <ChevronRight className="size-3.5" />
                           </button>
                         </div>
                       </div>
                     </div>

                   </div>

                 </div>
               ) : currentPage === 2 ? (
                 <div className="flex flex-col h-full min-h-0">
                   
                   {/* Scrollable: Tree Selector */}
                   <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                     <div className="grid grid-cols-2 gap-3">
                       {[
                         { name: '팝팝', defaultImg: '/thumbnails/lights/popop_light_warm.jpg' },
                         { name: '파스텔팝', defaultImg: '/thumbnails/lights/pastelpop_light_green.webp' },
                         { name: '쥬얼라이트', defaultImg: '/thumbnails/lights/jewel_light_color.jpg' },
                         { name: '클러스터', defaultImg: '/thumbnails/lights/cluster_light_green.jpg' },
                         { name: '좁쌀', defaultImg: '/thumbnails/lights/jopsal_light_black.jpg' },
                       ].map(({ name: lightName, defaultImg }, i) => {
                         const lightImg = selectedLight === i + 1 ? getLightThumbnail(i + 1) : defaultImg;
                         return (
                         <button
                           key={i}
                           onClick={() => {
                             // 더퍼스트 (전구 일체형) — block any light selection and surface modal
                             if (selectedTree === 2) { setShowDeperseAlert(true); return; }
                             setSelectedLight(prev => prev === i + 1 ? 0 : i + 1);
                           }}
                           className={`group relative flex flex-col rounded-xl overflow-hidden transition-all shadow-sm border-2 ${selectedLight === i + 1 ? 'border-blue-500 bg-blue-500' : 'border-transparent bg-white'}`}
                         >
                           {/* Checkbox (Top Right) */}
                           <div className={`absolute top-2 right-2 z-10 w-6 h-6 rounded border-2 flex items-center justify-center transition-all shadow-sm ${selectedLight === i + 1 ? 'bg-blue-500 border-blue-500' : 'bg-white/90 border-slate-300'}`}>
                              {selectedLight === i + 1 && <Check className="size-3.5 text-white" />}
                           </div>

                           {/* Image - Full Bleed */}
                           <div className="aspect-[5/4] w-full relative bg-white">
                             <img 
                               src={lightImg}
                               alt={`Light Option ${i + 1}`}
                               className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                             />
                             <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                           </div>
                           
                           {/* Footer Label */}
                           <div className={`py-2.5 text-center text-sm font-semibold transition-colors ${selectedLight === i + 1 ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border-t border-slate-100'}`}>
                             {lightName}
                           </div>
                         </button>
                       );
                       })}
                     </div>
                   </div>

                   {/* Separator */}
                   <div className="w-full h-px bg-slate-100 shrink-0" />

                   {/* Fixed Bottom Section: Colors, Sizes, Buttons */}
                   <div className="shrink-0 max-h-[20vh] overflow-y-auto custom-scrollbar p-4 bg-gray-50/50 flex flex-col gap-5">
                     
                     {/* Light Wrap Mode — recommendation-driven.
                         Buttons shown depend on the selected light's FAMILY:
                           - wire (팝팝/파스텔팝/좁쌀): front=[앞면], 360=[360도, 360도 촘촘]
                           - led (쥬얼라이트):           front=[앞면], 360=[360도]
                           - cluster:                  front=[앞면], 360=[360도]
                         Clicking sets lightWrapMode → scene re-scatters with #트리 recommendation
                         for current (tree, size, family, wrap). Hover tooltip shows scene count
                         + cart set count for the current (light, qty, size, wrap). */}
                     <div className="space-y-2.5">
                       <h4 className="text-sm font-bold text-slate-600 flex items-center gap-1.5">
                         <Lightbulb className="size-4" /> 전구 감기 옵션
                       </h4>
                       {(() => {
                         const family = selectedLight > 0 ? LIGHT_FAMILY[selectedLight] : null;
                         // Non-front options vary by family. Default (no light selected) = wire layout.
                         const non360: Array<{ key: WrapKey; label: string; icon: any }> =
                           family === 'led' || family === 'cluster'
                             ? [{ key: '360', label: '360도', icon: LayoutGrid }]
                             : [
                                 { key: '360', label: '360도', icon: LayoutGrid },
                                 { key: '360-dense', label: '360도 촘촘', icon: Grip },
                               ];
                         const items = frontOnlyMode
                           ? [{ key: 'front' as WrapKey, label: '앞면', icon: TreePine }]
                           : non360;
                         const tooltipFor = (wrap: WrapKey) => {
                           if (!selectedLight) return '전구를 먼저 선택해주세요';
                           const scene = getSceneBulbCount(selectedTree, selectedSize, selectedLight, wrap);
                           if (scene === 0) return '추천 데이터 없음 (해당 트리·사이즈)';
                           const sets = getCartSetCount(selectedLight, lightCount, selectedSize, wrap);
                           const total = sets * lightCount;
                           return `권장구수: ${scene}개  ·  구매: ${sets || '?'}세트${sets ? ` (${total}개)` : ''}`;
                         };
                         const cols = items.length === 1 ? 'grid-cols-1' : 'grid-cols-2';
                         return (
                           <div className={`grid ${cols} gap-2`}>
                             {items.map(({ key, label, icon: Icon }) => {
                               const isActive = lightWrapMode === key;
                               return (
                                 <Tooltip.Root key={key} delayDuration={300}>
                                   <Tooltip.Trigger asChild>
                                     <button
                                       onClick={() => setLightWrapMode(key)}
                                       className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all bg-white ${
                                         isActive
                                           ? 'border-2 border-blue-500 shadow-sm'
                                           : 'border-2 border-slate-200 hover:border-slate-300'
                                       }`}
                                     >
                                       <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                                         <Icon className="size-5 text-slate-600" />
                                       </div>
                                       <div className="text-left flex-1">
                                         <div className="text-sm font-semibold text-slate-800">{label}</div>
                                       </div>
                                       {isActive && <Check className="size-4 text-blue-500" />}
                                     </button>
                                   </Tooltip.Trigger>
                                   <Tooltip.Portal>
                                     <Tooltip.Content
                                       className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg shadow-xl z-50 select-none animate-in fade-in-0 zoom-in-95"
                                       sideOffset={5}
                                       side="top"
                                     >
                                       {tooltipFor(key)}
                                       <Tooltip.Arrow className="fill-gray-900" />
                                     </Tooltip.Content>
                                   </Tooltip.Portal>
                                 </Tooltip.Root>
                               );
                             })}
                           </div>
                         );
                       })()}
                     </div>

                     {/* 구수 선택 */}
                     {lightOptionsMap[selectedLight] && (
                       <div className="space-y-2.5">
                         <h4 className="text-sm font-bold text-slate-600 flex items-center gap-1.5">
                           <Ruler className="size-4" /> 구수 선택
                         </h4>
                         <select
                           value={lightQuantity}
                           onChange={(e) => setLightQuantity(e.target.value)}
                           className="w-full py-2.5 px-3 rounded-lg border-2 border-slate-200 bg-white text-sm font-semibold text-slate-800 focus:border-blue-500 focus:outline-none transition-colors cursor-pointer"
                         >
                           {lightOptionsMap[selectedLight].qty.map((q) => (
                             <option key={q} value={q}>{q}</option>
                           ))}
                         </select>
                       </div>
                     )}

                     {/* 전구 색상 */}
                     {lightOptionsMap[selectedLight] && lightOptionsMap[selectedLight].bulbColor.length > 0 && (
                       <div className="space-y-2.5">
                         <h4 className="text-sm font-bold text-slate-600 flex items-center gap-1.5">
                           <Palette className="size-4" /> 전구 색상
                         </h4>
                         <select
                           value={lightBulbColor}
                           onChange={(e) => setLightBulbColor(e.target.value)}
                           className="w-full py-2.5 px-3 rounded-lg border-2 border-slate-200 bg-white text-sm font-semibold text-slate-800 focus:border-blue-500 focus:outline-none transition-colors cursor-pointer"
                         >
                           {lightOptionsMap[selectedLight].bulbColor.map((c) => (
                             <option key={c} value={c}>{c}</option>
                           ))}
                         </select>
                       </div>
                     )}

                     {/* 선 색상 */}
                     {lightOptionsMap[selectedLight] && lightOptionsMap[selectedLight].wireColor.length > 0 && (
                       <div className="space-y-2.5">
                         <h4 className="text-sm font-bold text-slate-600 flex items-center gap-1.5">
                           <Palette className="size-4" /> 선 색상
                         </h4>
                         <select
                           value={lightWireColor}
                           onChange={(e) => setLightWireColor(e.target.value)}
                           className="w-full py-2.5 px-3 rounded-lg border-2 border-slate-200 bg-white text-sm font-semibold text-slate-800 focus:border-blue-500 focus:outline-none transition-colors cursor-pointer"
                         >
                           {lightOptionsMap[selectedLight].wireColor.map((c) => (
                             <option key={c} value={c}>{c}</option>
                           ))}
                         </select>
                       </div>
                     )}

                   </div>

                   {/* Footer Actions (always visible) */}
                   <div className="shrink-0 p-4 bg-gray-50/50 flex flex-col gap-3 border-t border-slate-100">
                     <div className="flex items-center gap-1.5 justify-center text-slate-500 py-1.5">
                       <Info className="size-4" />
                       <span className="text-sm font-medium">상품 담기를 누른 상품만 장바구니에 담깁니다.</span>
                     </div>

                     <div className="flex flex-col gap-2">
                       <button
                         onClick={addToCart}
                         className="w-full py-3 rounded-xl font-bold text-sm transition-all bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 shadow-sm active:scale-[0.98] flex items-center justify-center gap-1.5"
                       >
                         <ShoppingBag className="size-4" /> 상품 담기
                       </button>

                       <div className="flex gap-2">
                         <button
                           onClick={handlePrev}
                           disabled={currentPage === 1}
                           className={`
                             flex-1 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1
                             ${currentPage === 1 
                               ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                               : 'bg-slate-200 text-slate-700 hover:bg-slate-300 active:scale-[0.98]'}
                           `}
                         >
                           <ChevronLeft className="size-3.5" /> 이전 단계
                         </button>

                         <button
                           onClick={handleNext}
                           disabled={currentPage === totalPages}
                           className={`
                             flex-1 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1
                             ${currentPage === totalPages 
                               ? 'bg-blue-300 text-white cursor-not-allowed' 
                               : 'bg-blue-600 text-white shadow-md hover:bg-blue-700 shadow-blue-500/20 active:scale-[0.98]'}
                           `}
                         >
                           다음 단계 <ChevronRight className="size-3.5" />
                         </button>
                       </div>
                     </div>
                   </div>

                 </div>
               ) : currentPage === 3 ? (
                 <div className="flex flex-col h-full min-h-0">
                   
                   {/* Scrollable: Ornament Selector */}
                   <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                     <div className="grid grid-cols-2 gap-3">
                       {Object.keys(ornamentNames).map(Number).sort((a, b) => a - b).map((i) => (
                         <button 
                           key={i}
                           onClick={() => setSelectedOrnament(prev => prev === i ? 0 : i)}
                           className={`group relative flex flex-col rounded-xl overflow-hidden transition-all shadow-sm border-2 ${selectedOrnament === i ? 'border-blue-500 bg-blue-500' : 'border-transparent bg-white'}`}
                         >
                           {/* Checkbox (Top Right) */}
                           <div className={`absolute top-2 right-2 z-10 w-6 h-6 rounded border-2 flex items-center justify-center transition-all shadow-sm ${selectedOrnament === i ? 'bg-blue-500 border-blue-500' : 'bg-white/90 border-slate-300'}`}>
                              {selectedOrnament === i && <Check className="size-3.5 text-white" />}
                           </div>

                           {/* Image - Full Bleed */}
                           <div className="aspect-[5/4] w-full relative bg-white">
                             <img 
                               src={ornamentThumbnails[i]} 
                               alt={`Ornament Option ${i}`}
                               className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                             />
                             <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                           </div>
                           
                           {/* Footer Label */}
                           <div className={`py-2.5 text-center text-sm font-semibold transition-colors ${selectedOrnament === i ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border-t border-slate-100'}`}>
                             {ornamentNames[i]}
                           </div>
                         </button>
                       ))}
                     </div>
                   </div>

                   {/* Separator */}
                   <div className="w-full h-px bg-slate-100 shrink-0" />

                   {/* Fixed Bottom Section: Colors, Sizes, Buttons */}
                   <div className="shrink-0 p-4 bg-gray-50/50 flex flex-col gap-5">
                     
                     {/* Quantity Selector */}
                     <div className="space-y-2.5">
                       <h4 className="text-sm font-bold text-slate-600 flex items-center gap-1.5">
                         <Gem className="size-4" /> 수량 선택
                       </h4>
                       <div className="flex items-center justify-center gap-0">
                         <button
                           onClick={() => setOrnamentQty(Math.max(1, ornamentQty - 1))}
                           className="w-10 h-10 rounded-l-lg border-2 border-r-0 border-slate-200 bg-white text-slate-600 font-bold text-lg hover:bg-slate-50 transition-colors flex items-center justify-center"
                         >
                           −
                         </button>
                         <div className="w-14 h-10 border-2 border-slate-200 bg-white flex items-center justify-center text-sm font-bold text-slate-800">
                           {ornamentQty}
                         </div>
                         <button
                           onClick={() => setOrnamentQty(ornamentQty + 1)}
                           className="w-10 h-10 rounded-r-lg border-2 border-l-0 border-slate-200 bg-white text-slate-600 font-bold text-lg hover:bg-slate-50 transition-colors flex items-center justify-center"
                         >
                           +
                         </button>
                       </div>
                     </div>

                     {/* Footer Actions */}
                     <div className="pt-2 flex flex-col gap-3">
                       <div className="flex items-center gap-1.5 justify-center text-slate-500 py-1.5">
                         <Info className="size-4" />
                         <span className="text-sm font-medium">상품 담기를 누른 상품만 장바구니에 담깁니다.</span>
                       </div>

                       <div className="flex flex-col gap-2">
                         <button
                           onClick={addToCart}
                           className="w-full py-3 rounded-xl font-bold text-sm transition-all bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 shadow-sm active:scale-[0.98] flex items-center justify-center gap-1.5"
                         >
                           <ShoppingBag className="size-4" /> 상품 담기
                         </button>

                         <div className="flex gap-2">
                           <button
                             onClick={handlePrev}
                             disabled={currentPage === 1}
                             className={`
                               flex-1 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1
                               ${currentPage === 1 
                                 ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                                 : 'bg-slate-200 text-slate-700 hover:bg-slate-300 active:scale-[0.98]'}
                             `}
                           >
                             <ChevronLeft className="size-3.5" /> 이전 단계
                           </button>

                           <button
                             onClick={handleNext}
                             disabled={currentPage === totalPages}
                             className={`
                               flex-1 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1
                               ${currentPage === totalPages 
                                 ? 'bg-blue-300 text-white cursor-not-allowed' 
                                 : 'bg-blue-600 text-white shadow-md hover:bg-blue-700 shadow-blue-500/20 active:scale-[0.98]'}
                             `}
                           >
                             다음 단계 <ChevronRight className="size-3.5" />
                           </button>
                         </div>
                       </div>
                     </div>

                   </div>

                 </div>
               ) : currentPage === 4 ? (
                 <div className="flex flex-col h-full min-h-0">
                   
                   {/* Scrollable: Point Ornament Selector */}
                   <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                     <div className="grid grid-cols-2 gap-3">
                       {[1, 2, 3, 4].map((i) => (
                         <button 
                           key={i}
                           onClick={() => setSelectedPointOrnament(prev => prev === i ? 0 : i)}
                           className={`group relative flex flex-col rounded-xl overflow-hidden transition-all shadow-sm border-2 ${selectedPointOrnament === i ? 'border-blue-500 bg-blue-500' : 'border-transparent bg-white'}`}
                         >
                           {/* Checkbox (Top Right) */}
                           <div className={`absolute top-2 right-2 z-10 w-6 h-6 rounded border-2 flex items-center justify-center transition-all shadow-sm ${selectedPointOrnament === i ? 'bg-blue-500 border-blue-500' : 'bg-white/90 border-slate-300'}`}>
                              {selectedPointOrnament === i && <Check className="size-3.5 text-white" />}
                           </div>

                           {/* Image - Full Bleed */}
                           <div className="aspect-[5/4] w-full relative bg-white">
                             <img 
                               src={pointOrnamentThumbnails[i]} 
                               alt={`Point Ornament Option ${i}`}
                               className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                             />
                             <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                           </div>
                           
                           {/* Footer Label */}
                           <div className={`py-2.5 text-center text-sm font-semibold transition-colors ${selectedPointOrnament === i ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border-t border-slate-100'}`}>
                             {pointOrnamentNames[i]}
                           </div>
                         </button>
                       ))}
                     </div>
                   </div>

                   {/* Separator */}
                   <div className="w-full h-px bg-slate-100 shrink-0" />

                   {/* Fixed Bottom Section: Extra Options, Buttons */}
                   <div className="shrink-0 p-4 bg-gray-50/50 flex flex-col gap-5">
                     
                     {/* Quantity Selector */}
                     <div className="space-y-2.5">
                       <h4 className="text-sm font-bold text-slate-600 flex items-center gap-1.5">
                         <Gem className="size-4" /> 수량 선택
                       </h4>
                       <div className="flex items-center justify-center gap-0">
                         <button
                           onClick={() => setPointOrnamentQty(Math.max(1, pointOrnamentQty - 1))}
                           className="w-10 h-10 rounded-l-lg border-2 border-r-0 border-slate-200 bg-white text-slate-600 font-bold text-lg hover:bg-slate-50 transition-colors flex items-center justify-center"
                         >
                           −
                         </button>
                         <div className="w-14 h-10 border-2 border-slate-200 bg-white flex items-center justify-center text-sm font-bold text-slate-800">
                           {pointOrnamentQty}
                         </div>
                         <button
                           onClick={() => setPointOrnamentQty(pointOrnamentQty + 1)}
                           className="w-10 h-10 rounded-r-lg border-2 border-l-0 border-slate-200 bg-white text-slate-600 font-bold text-lg hover:bg-slate-50 transition-colors flex items-center justify-center"
                         >
                           +
                         </button>
                       </div>
                     </div>
                     {/* Footer Actions */}
                     <div className="pt-2 flex flex-col gap-3">
                       <div className="flex items-center gap-1.5 justify-center text-slate-500 py-1.5">
                         <Info className="size-4" />
                         <span className="text-sm font-medium">상품 담기를 누른 상품만 장바구니에 담깁니다.</span>
                       </div>

                       <div className="flex flex-col gap-2">
                         <button
                           onClick={addToCart}
                           className="w-full py-3 rounded-xl font-bold text-sm transition-all bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 shadow-sm active:scale-[0.98] flex items-center justify-center gap-1.5"
                         >
                           <ShoppingBag className="size-4" /> 상품 담기
                         </button>

                         <div className="flex gap-2">
                           <button
                             onClick={handlePrev}
                             disabled={currentPage === 1}
                             className={`
                               flex-1 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1
                               ${currentPage === 1 
                                 ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                                 : 'bg-slate-200 text-slate-700 hover:bg-slate-300 active:scale-[0.98]'}
                             `}
                           >
                             <ChevronLeft className="size-3.5" /> 이전 단계
                           </button>

                           <button
                             className="flex-1 py-2.5 rounded-xl font-bold text-xs transition-all bg-blue-600 text-white shadow-md hover:bg-blue-700 shadow-blue-500/20 active:scale-[0.98] flex items-center justify-center gap-1"
                           >
                             장바구니로 이동
                           </button>
                         </div>
                       </div>
                     </div>

                   </div>

                 </div>
               ) : (
                  <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-slate-50/50">
                     <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                        <Wrench className="size-8 text-slate-300" />
                     </div>
                     <h2 className="text-lg font-bold text-slate-700">작업 중입니다</h2>
                     <p className="text-sm text-slate-400 mt-2">다음 페이지 콘텐츠를 준비하고 있습니다.</p>
                  </div>
               )}
             </div>

          </div>
        </motion.div>
      </div>

      {/* 더퍼스트 전구 일체형 알림 — fires on any light item click while tree 2 is selected */}
      <AnimatePresence>
        {showDeperseAlert && (
          <motion.div
            key="deperse-alert"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => setShowDeperseAlert(false)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl px-6 py-5 max-w-sm w-[90%] shadow-2xl"
            >
              <p className="text-slate-800 text-sm leading-relaxed mb-4 text-center">
                더퍼스트 트리는 전구 일체형으로<br />전구 추가 선택이 불가합니다.
              </p>
              <button
                onClick={() => setShowDeperseAlert(false)}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-bold text-sm hover:bg-blue-700 active:scale-[0.98] transition-all"
              >
                확인
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Tooltip.Provider>
  );
}