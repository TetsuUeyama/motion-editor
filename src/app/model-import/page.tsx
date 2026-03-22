// クライアントコンポーネント宣言
'use client';

/**
 * モデルインポート - 4ステップワークフロー
 *
 * Step 1: アップロード → 3Dモデル読み込み（GLB/GLTF/OBJ）
 * Step 2: パーツ分類   → メッシュをカテゴリ分け（ボディ/髪/衣類/その他/除外）
 * Step 3: マーカー配置 → Mixamo互換の5マーカーを配置（顎、手首、肘、膝、股間）
 * Step 4: 結果         → チビボクセルボディ + オーバーレイパーツ + スケルトン + モーションテスト
 *
 * 出力: ボーンごとに分離されたボクセルデータ（segments_bundle.json + segments.json）
 *       → contactformのrealistic-viewerで読み込んでモーション再生可能
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, Color3, Color4, Mesh, MeshBuilder, StandardMaterial,
  SceneLoader, AbstractMesh, TransformNode, Quaternion, HighlightLayer,
  VertexData,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

import {
  BODY_SIZE, VSCALE, MARKER_GROUPS, ALL_MARKER_NAMES, MIRROR_PAIRS,
  getMarkerColor, BONE_DEFS,
  CATEGORY_INFO, PART_CATEGORIES, mergeVoxelLayers, guessCategory,
  calculateTargetBones, uniformChibiVoxelize, buildSkeletalCharacter,
  exportVoxBlob, exportSkeletalModelJSON, exportSkinnedGLB,
  exportSegmentsBundle, exportSegmentsInfo,
  voxelToViewer, buildFlatVoxelMesh,
  loadMotionClip, threeQuatToViewer,
  type VoxelEntry, type PartCategory, type DeformParams,
} from '@/lib/auto-rigger';

// ============================================================
// モーション一覧（プレビュー確認用）
// game-assetsディレクトリから読み込まれるMixamoモーションクリップ
// ============================================================
const MOTIONS = [
  { name: 'Hip Hop Dancing', label: 'Hip Hop Dancing' },
  { name: 'Belly Dance', label: 'Belly Dance' },
  { name: 'Jump', label: 'Jump' },
  { name: 'Mma Kick', label: 'MMA Kick' },
  { name: 'Roundhouse Kick', label: 'Roundhouse Kick' },
  { name: 'Snake Hip Hop Dance', label: 'Snake Hip Hop' },
];
const MOTION_BASE = '/api/game-assets/motion';

// ユーザーが配置するマーカー（対称モード時は左側+中央のみ、右側は自動ミラー）
const PLACEABLE_MARKERS = ['Chin', 'LeftWrist', 'LeftElbow', 'LeftKnee', 'Groin'];
// 非対称モード時は全8マーカーを手動配置
const PLACEABLE_MARKERS_NO_SYM = ALL_MARKER_NAMES;

// ワークフローの4ステップ
type Step = 'upload' | 'parts' | 'markers' | 'result';

// 各メッシュパーツの設定情報
interface PartConfig {
  category: PartCategory;  // カテゴリ（body/hair/clothing/other/exclude）
  meshName: string;        // 元のメッシュ名
  vertexCount: number;     // 頂点数（UI表示用）
  visible: boolean;        // 3Dビューでの表示/非表示
}

// ============================================================
// OBJパーサー（SceneLoaderのblob URL問題を回避するための独自実装）
// OBJテキストを解析してBabylon.jsのメッシュ配列を生成する
// ============================================================
function parseObjToMeshes(objText: string, scene: Scene): AbstractMesh[] {
  const allPositions: number[][] = [];
  const allNormals: number[][] = [];
  const allUVs: number[][] = [];

  interface ObjGroup { name: string; positions: number[]; normals: number[]; uvs: number[]; indices: number[]; vertMap: Map<string, number>; }
  let current: ObjGroup = { name: 'default', positions: [], normals: [], uvs: [], indices: [], vertMap: new Map() };
  const groups: ObjGroup[] = [current];

  for (const raw of objText.split('\n')) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const parts = line.split(/\s+/);
    const cmd = parts[0];

    if (cmd === 'v') {
      allPositions.push([parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0, parseFloat(parts[3]) || 0]);
    } else if (cmd === 'vn') {
      allNormals.push([parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0, parseFloat(parts[3]) || 0]);
    } else if (cmd === 'vt') {
      allUVs.push([parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0]);
    } else if (cmd === 'o' || cmd === 'g') {
      const name = parts.slice(1).join(' ') || 'default';
      current = { name, positions: [], normals: [], uvs: [], indices: [], vertMap: new Map() };
      groups.push(current);
    } else if (cmd === 'f') {
      const faceVerts: number[] = [];
      for (let i = 1; i < parts.length; i++) {
        const key = parts[i];
        if (current.vertMap.has(key)) {
          faceVerts.push(current.vertMap.get(key)!);
          continue;
        }
        const segs = key.split('/');
        const vi = parseInt(segs[0]) - 1;
        const ti = segs[1] ? parseInt(segs[1]) - 1 : -1;
        const ni = segs[2] ? parseInt(segs[2]) - 1 : -1;
        const idx = current.positions.length / 3;
        const p = allPositions[vi] ?? [0, 0, 0];
        current.positions.push(p[0], p[1], p[2]);
        if (ni >= 0 && allNormals[ni]) { current.normals.push(allNormals[ni][0], allNormals[ni][1], allNormals[ni][2]); }
        else { current.normals.push(0, 1, 0); }
        if (ti >= 0 && allUVs[ti]) { current.uvs.push(allUVs[ti][0], allUVs[ti][1]); }
        else { current.uvs.push(0, 0); }
        current.vertMap.set(key, idx);
        faceVerts.push(idx);
      }
      // Triangulate (fan from first vertex)
      for (let i = 1; i < faceVerts.length - 1; i++) {
        current.indices.push(faceVerts[0], faceVerts[i], faceVerts[i + 1]);
      }
    }
  }

  const meshes: AbstractMesh[] = [];
  for (const g of groups) {
    if (g.positions.length === 0) continue;
    const mesh = new Mesh(g.name, scene);
    const vd = new VertexData();
    vd.positions = g.positions;
    vd.normals = g.normals;
    vd.uvs = g.uvs;
    vd.indices = g.indices;
    vd.applyToMesh(mesh);
    const mat = new StandardMaterial(g.name + '_mat', scene);
    mat.diffuseColor = new Color3(0.7, 0.7, 0.7);
    mat.backFaceCulling = false;
    mesh.material = mat;
    meshes.push(mesh);
  }
  return meshes;
}

// ============================================================
// ヘルパー関数
// ============================================================
// 複数メッシュのバウンディングボックス（最小/最大座標と中心）を計算する
function computeModelBounds(meshes: AbstractMesh[]): { min: Vector3; max: Vector3; center: Vector3 } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const m of meshes) {
    if (!(m instanceof Mesh)) continue;
    const pos = m.getVerticesData('position');
    if (!pos) continue;
    const wm = m.getWorldMatrix();
    for (let i = 0; i < pos.length; i += 3) {
      const wp = Vector3.TransformCoordinates(new Vector3(pos[i], pos[i + 1], pos[i + 2]), wm);
      minX = Math.min(minX, wp.x); maxX = Math.max(maxX, wp.x);
      minY = Math.min(minY, wp.y); maxY = Math.max(maxY, wp.y);
      minZ = Math.min(minZ, wp.z); maxZ = Math.max(maxZ, wp.z);
    }
  }
  if (!isFinite(minX)) return { min: Vector3.Zero(), max: Vector3.Zero(), center: Vector3.Zero() };
  return {
    min: new Vector3(minX, minY, minZ),
    max: new Vector3(maxX, maxY, maxZ),
    center: new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2),
  };
}

// ============================================================
// メインコンポーネント
// 4ステップワークフロー（アップロード→パーツ分類→マーカー配置→結果）
// 左側: ステップに応じたUIパネル
// 右側: Babylon.jsの3Dビューワー（モデル表示、マーカー配置、モーションプレビュー）
// ============================================================
export default function ModelImportPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const highlightRef = useRef<HighlightLayer | null>(null);
  const meshMapRef = useRef<Map<string, AbstractMesh[]>>(new Map());
  const centerLineRef = useRef<Mesh | null>(null);
  const skelNodesRef = useRef<Map<string, TransformNode>>(new Map());
  const skelMeshesRef = useRef<Map<string, Mesh>>(new Map());
  const restPosRef = useRef<Map<string, Vector3>>(new Map());
  const deformParamsRef = useRef<DeformParams | null>(null);
  const worldMarkersRef = useRef<Record<string, Vector3>>({});
  const resultMeshesRef = useRef<Mesh[]>([]);
  const markerMeshesRef = useRef<Map<string, Mesh>>(new Map());
  const animCallbackRef = useRef<(() => void) | null>(null);
  const animTimeRef = useRef(0);

  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Parts state
  const [parts, setParts] = useState<Record<string, PartConfig>>({});
  const [selectedPart, setSelectedPart] = useState<string | null>(null);

  // Marker state
  const [markers, setMarkers] = useState<Record<string, Vector3>>({});
  const [activeMarker, setActiveMarker] = useState<string | null>(null);
  const [useSymmetry, setUseSymmetry] = useState(true);
  const [modelCenter, setModelCenter] = useState<Vector3>(Vector3.Zero());

  // Result state
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState('');
  const [bodyVoxels, setBodyVoxels] = useState<VoxelEntry[]>([]);
  const [otherPartVoxels, setOtherPartVoxels] = useState<Record<string, VoxelEntry[]>>({});
  const [playingMotion, setPlayingMotion] = useState<string | null>(null);
  const [loadingMotion, setLoadingMotion] = useState(false);

  // ============================================================
  // Init Babylon.js
  // ============================================================
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.08, 0.08, 0.12, 1);

    const ground = MeshBuilder.CreateGround('ground', { width: 10, height: 10 }, scene);
    const gMat = new StandardMaterial('gMat', scene);
    gMat.diffuseColor = new Color3(0.15, 0.15, 0.2); gMat.alpha = 0.3; gMat.wireframe = true;
    ground.material = gMat; ground.isPickable = false;

    const cam = new ArcRotateCamera('cam', Math.PI / 2, Math.PI / 3, 5, new Vector3(0, 1, 0), scene);
    cam.attachControl(canvas, true); cam.lowerRadiusLimit = 0.5; cam.upperRadiusLimit = 20; cam.wheelPrecision = 40;

    new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.6;
    new DirectionalLight('dir', new Vector3(-1, -2, 1), scene).intensity = 0.5;

    highlightRef.current = new HighlightLayer('hl', scene);
    sceneRef.current = scene; engineRef.current = engine;

    engine.runRenderLoop(() => scene.render());
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); engine.dispose(); };
  }, []);

  // ============================================================
  // Cleanup
  // ============================================================
  const clearResult = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (animCallbackRef.current) { scene.unregisterBeforeRender(animCallbackRef.current); animCallbackRef.current = null; }
    for (const m of resultMeshesRef.current) m.dispose(); resultMeshesRef.current = [];
    for (const [, m] of skelMeshesRef.current) m.dispose(); skelMeshesRef.current.clear();
    for (const [, n] of skelNodesRef.current) n.dispose(); skelNodesRef.current.clear();
    restPosRef.current.clear();
    setBodyVoxels([]); setOtherPartVoxels({}); setPlayingMotion(null);
  }, []);

  // ============================================================
  // Load model
  // ============================================================
  const loadModel = useCallback(async (file: File) => {
    const scene = sceneRef.current;
    if (!scene) return;
    setLoading(true); setError(null); setFileName(file.name);
    setParts({}); setSelectedPart(null); setMarkers({}); setActiveMarker(null);
    clearResult();

    for (const m of [...meshMapRef.current.values()].flat()) m.dispose();
    meshMapRef.current.clear();
    for (const [, m] of markerMeshesRef.current) m.dispose(); markerMeshesRef.current.clear();
    if (centerLineRef.current) { centerLineRef.current.dispose(); centerLineRef.current = null; }
    for (const m of scene.meshes.filter(mm => mm.name !== 'ground')) m.dispose();
    for (const n of scene.transformNodes) n.dispose();

    try {
      const url = URL.createObjectURL(file);
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      let result: { meshes: AbstractMesh[] };
      if (ext === 'glb' || ext === 'gltf') result = await SceneLoader.ImportMeshAsync('', url, '', scene, null, '.glb');
      else if (ext === 'obj') {
        // Parse OBJ directly without SceneLoader to avoid blob URL issues
        const objText = await file.text();
        result = { meshes: parseObjToMeshes(objText, scene) };
      }
      else throw new Error(`Unsupported format: .${ext}`);
      URL.revokeObjectURL(url);

      const partMap = new Map<string, AbstractMesh[]>();
      const partConfigs: Record<string, PartConfig> = {};

      for (const m of result.meshes) {
        if (m.name === '__root__' || !(m instanceof Mesh) || m.getTotalVertices() < 3) { m.isPickable = false; continue; }
        let partName = m.name.replace(/^mixamorig:?/i, '').replace(/\.\d+$/, '').trim();
        if (!partName) partName = m.name;
        if (!partMap.has(partName)) partMap.set(partName, []);
        partMap.get(partName)!.push(m);
        m.isPickable = true;
      }

      for (const [name, meshes] of partMap) {
        const totalVerts = meshes.reduce((s, m) => s + (m instanceof Mesh ? m.getTotalVertices() : 0), 0);
        partConfigs[name] = { category: guessCategory(name), meshName: name, vertexCount: totalVerts, visible: true };
      }

      meshMapRef.current = partMap;
      setParts(partConfigs);

      // Fit camera
      const allMeshes = [...partMap.values()].flat();
      const { center } = computeModelBounds(allMeshes);
      setModelCenter(center);
      const bounds = scene.getWorldExtends();
      const size = bounds.max.subtract(bounds.min).length();
      const cam = scene.activeCamera as ArcRotateCamera;
      if (cam) { cam.target = center; cam.radius = Math.max(size * 1.2, 2); }

      // Click to select part
      scene.onPointerDown = (_evt, pick) => {
        if (pick?.hit && pick.pickedMesh) {
          for (const [pn, ms] of meshMapRef.current) {
            if (ms.includes(pick.pickedMesh)) { setSelectedPart(pn); return; }
          }
        }
      };

      setStep('parts');
      setLoading(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); }
  }, [clearResult]);

  // ============================================================
  // Highlight selected part
  // ============================================================
  useEffect(() => {
    const hl = highlightRef.current; if (!hl) return;
    hl.removeAllMeshes();
    if (selectedPart && meshMapRef.current.has(selectedPart)) {
      for (const m of meshMapRef.current.get(selectedPart)!)
        if (m instanceof Mesh) hl.addMesh(m, Color3.FromHexString('#44aaff'));
    }
  }, [selectedPart]);

  // ============================================================
  // Toggle part visibility
  // ============================================================
  const toggleVis = (name: string) => {
    const ms = meshMapRef.current.get(name); if (!ms) return;
    setParts(p => {
      const n = { ...p }; n[name] = { ...n[name], visible: !n[name].visible };
      for (const m of ms) m.isVisible = n[name].visible;
      return n;
    });
  };
  const setCat = (name: string, cat: PartCategory) => setParts(p => ({ ...p, [name]: { ...p[name], category: cat } }));

  // ============================================================
  // Mirror helper
  // ============================================================
  const mirrorPos = useCallback((pos: Vector3): Vector3 => {
    return new Vector3(2 * modelCenter.x - pos.x, pos.y, pos.z);
  }, [modelCenter]);

  // ============================================================
  // Go to markers step
  // ============================================================
  const goToMarkers = useCallback(() => {
    const scene = sceneRef.current; if (!scene) return;
    // Show center line
    const allMeshes = [...meshMapRef.current.values()].flat();
    const { center, min, max } = computeModelBounds(allMeshes);
    setModelCenter(center);
    if (centerLineRef.current) centerLineRef.current.dispose();
    const cl = MeshBuilder.CreateLines('centerLine', {
      points: [new Vector3(center.x, min.y - 0.05, center.z), new Vector3(center.x, max.y + 0.05, center.z)],
    }, scene);
    cl.color = new Color3(1, 1, 1); cl.isPickable = false;
    centerLineRef.current = cl;

    scene.onPointerDown = undefined;
    highlightRef.current?.removeAllMeshes();
    setSelectedPart(null);
    setActiveMarker('Chin');
    setStep('markers');
  }, []);

  // ============================================================
  // Marker placement
  // ============================================================
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || step !== 'markers') return;

    scene.onPointerDown = (_evt, pick) => {
      if (!activeMarker || !pick?.hit || !pick.pickedPoint) return;
      if (pick.pickedMesh?.name.startsWith('marker_')) return;

      const pos = pick.pickedPoint.clone();
      const newMarkers = { ...markers, [activeMarker]: pos };

      if (useSymmetry) {
        const mt = Object.entries(MIRROR_PAIRS).find(([, src]) => src === activeMarker);
        if (mt) newMarkers[mt[0]] = mirrorPos(pos);
      }

      setMarkers(newMarkers);
      const list = useSymmetry ? PLACEABLE_MARKERS : PLACEABLE_MARKERS_NO_SYM;
      const next = list.find(n => !newMarkers[n]);
      if (next) setActiveMarker(next);
    };

    return () => { scene.onPointerDown = undefined; };
  }, [step, activeMarker, markers, useSymmetry, mirrorPos]);

  // ============================================================
  // Marker sphere visuals
  // ============================================================
  useEffect(() => {
    const scene = sceneRef.current; if (!scene) return;
    for (const [, m] of markerMeshesRef.current) m.dispose(); markerMeshesRef.current.clear();

    const all = { ...markers };
    if (useSymmetry) {
      for (const [r, l] of Object.entries(MIRROR_PAIRS)) {
        if (all[l] && !all[r]) all[r] = mirrorPos(all[l]);
      }
    }

    for (const [name, pos] of Object.entries(all)) {
      const isActive = name === activeMarker;
      const isMirr = useSymmetry && MIRROR_PAIRS[name] && !markers[name];
      const s = MeshBuilder.CreateSphere(`marker_${name}`, { diameter: isActive ? 0.08 : 0.06 }, scene);
      s.position = pos;
      const mt = new StandardMaterial(`mmat_${name}`, scene);
      const c = Color3.FromHexString(getMarkerColor(name));
      mt.diffuseColor = c; mt.emissiveColor = c.scale(isActive ? 1.0 : isMirr ? 0.3 : 0.7);
      mt.alpha = isMirr ? 0.6 : 1.0;
      s.material = mt; s.isPickable = false;
      markerMeshesRef.current.set(name, s);
    }
  }, [markers, activeMarker, useSymmetry, mirrorPos]);

  const allMarkersPlaced = (useSymmetry ? PLACEABLE_MARKERS : PLACEABLE_MARKERS_NO_SYM).every(n => !!markers[n]);

  const completeMarkers = useCallback((): Record<string, Vector3> => {
    const r = { ...markers };
    if (useSymmetry) { for (const [right, left] of Object.entries(MIRROR_PAIRS)) { if (r[left]) r[right] = mirrorPos(r[left]); } }
    return r;
  }, [markers, useSymmetry, mirrorPos]);

  const clearMarker = useCallback((name: string) => {
    setMarkers(prev => {
      const n = { ...prev }; delete n[name];
      if (useSymmetry) {
        const mt = Object.entries(MIRROR_PAIRS).find(([, s]) => s === name);
        if (mt) delete n[mt[0]];
        if (MIRROR_PAIRS[name]) delete n[MIRROR_PAIRS[name]];
      }
      return n;
    });
    setActiveMarker(name);
  }, [useSymmetry]);

  // ============================================================
  // Generate: voxelize body + overlay clothing + separate other parts
  // ============================================================
  const doGenerate = useCallback(async () => {
    const scene = sceneRef.current; if (!scene) return;
    setGenerating(true); setError(null); setGenStatus('Preparing...');
    clearResult();

    try {
      const worldMarkers = completeMarkers();
      worldMarkersRef.current = worldMarkers;
      const allMeshes = [...meshMapRef.current.values()].flat();
      const bounds = computeModelBounds(allMeshes);

      // Disable ALL original meshes (fully remove from rendering/picking)
      for (const ms of meshMapRef.current.values()) {
        for (const m of ms) m.setEnabled(false);
      }
      for (const m of scene.meshes) {
        if (m.name !== 'ground' && !m.name.startsWith('body_voxels') && !m.name.startsWith('other_') && !m.name.startsWith('rig_')) {
          m.setEnabled(false);
        }
      }
      if (centerLineRef.current) centerLineRef.current.setEnabled(false);
      for (const [, m] of markerMeshesRef.current) m.setEnabled(false);
      highlightRef.current?.removeAllMeshes();

      // Collect ALL non-excluded meshes for unified voxelization
      const allActiveMeshes: AbstractMesh[] = [];
      for (const [name, cfg] of Object.entries(parts)) {
        if (!cfg.visible || cfg.category === 'exclude') continue;
        const ms = meshMapRef.current.get(name) ?? [];
        allActiveMeshes.push(...ms);
      }

      // Voxelize all meshes together (body + hair + clothing + other)
      setGenStatus(`Voxelizing ${allActiveMeshes.length} meshes...`);
      const voxResult = allActiveMeshes.length > 0
        ? await uniformChibiVoxelize(allActiveMeshes, worldMarkers, bounds)
        : null;
      const mergedVoxels = voxResult?.voxels ?? [];
      const deformParams = voxResult?.deformParams ?? null;
      deformParamsRef.current = deformParams;
      setBodyVoxels(mergedVoxels);
      setOtherPartVoxels({});

      if (mergedVoxels.length === 0 || !deformParams) {
        setError('No voxels generated. Check part categories and marker placement.');
        setGenerating(false); return;
      }

      // 4. Display voxels directly (flat mesh first, skeletal later)
      const cx = BODY_SIZE.x / 2, cy = BODY_SIZE.y / 2;

      if (mergedVoxels.length > 0) {
        setGenStatus(`Building display (${mergedVoxels.length} voxels)...`);
        // Show as flat voxel mesh first to verify voxelization works
        const bodyMesh = buildFlatVoxelMesh(mergedVoxels, scene, 'body_voxels', cx, cy);
        resultMeshesRef.current.push(bodyMesh);

        // Build skeletal character with bones computed from same deformation as voxels
        const bones = calculateTargetBones(worldMarkers, deformParams);
        const { nodes, meshes: skelMeshMap, restPos } = buildSkeletalCharacter(mergedVoxels, bones, scene, cx, cy, 'rig');
        skelNodesRef.current = nodes; skelMeshesRef.current = skelMeshMap; restPosRef.current = restPos;
        // Hide skeletal meshes by default (flat mesh is shown)
        for (const [, m] of skelMeshMap) m.isVisible = false;
      }

      console.log(`[Generate] voxels=${mergedVoxels.length}`);

      const cam = scene.activeCamera as ArcRotateCamera;
      if (cam) { cam.target = new Vector3(0, BODY_SIZE.z * VSCALE / 2, 0); cam.radius = BODY_SIZE.z * VSCALE * 1.5; }

      setGenStatus(''); setStep('result');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Generate ERROR: ${msg}`);
      setError(msg);
    }
    setGenerating(false);
  }, [completeMarkers, clearResult, parts]);

  // ============================================================
  // Motion playback (same as before)
  // ============================================================
  const startMotion = useCallback(async (motionName: string) => {
    const scene = sceneRef.current; if (!scene) return;
    if (animCallbackRef.current) { scene.unregisterBeforeRender(animCallbackRef.current); animCallbackRef.current = null; }
    setPlayingMotion(null); setLoadingMotion(true);
    try {
      const url = `${MOTION_BASE}/${motionName}.motion.json`;
      const clip = await loadMotionClip(url, motionName, motionName);
      if (!deformParamsRef.current) return;
      const bones = calculateTargetBones(worldMarkersRef.current, deformParamsRef.current);
      const cx = BODY_SIZE.x / 2, cy = BODY_SIZE.y / 2;
      const bodyH = BODY_SIZE.z * VSCALE;
      const sf = clip.fbxBodyHeight > 0 ? bodyH / clip.fbxBodyHeight : 1;
      const hipsVP = restPosRef.current.get('Hips') ?? Vector3.Zero();
      const toVQ = (dq: [number, number, number, number]) => threeQuatToViewer(dq);

      for (const bd of BONE_DEFS) {
        const node = skelNodesRef.current.get(bd.name); if (!node) continue;
        if (bd.parent) {
          const pn = skelNodesRef.current.get(bd.parent);
          const bp = bones[bd.name], pp = bones[bd.parent];
          if (pn && bp && pp) { node.parent = pn; node.position = voxelToViewer(bp.x, bp.y, bp.z, cx, cy).subtract(voxelToViewer(pp.x, pp.y, pp.z, cx, cy)); }
        } else { node.parent = null; const rp = restPosRef.current.get(bd.name); if (rp) node.position = rp.clone(); }
        node.rotationQuaternion = Quaternion.Identity();
      }

      const fd = 1.0 / clip.fps; animTimeRef.current = 0; let lt = performance.now();
      const af = (fi: number) => {
        const frame = clip.frames[fi]; if (!frame) return;
        const wdqs = new Map<string, Quaternion>();
        for (const bd of BONE_DEFS) { const d = frame[bd.name]; wdqs.set(bd.name, d ? toVQ(d.dq) : Quaternion.Identity()); }
        for (const bd of BONE_DEFS) {
          const node = skelNodesRef.current.get(bd.name); if (!node) continue;
          const wq = wdqs.get(bd.name) ?? Quaternion.Identity();
          if (bd.parent) { const pwq = wdqs.get(bd.parent) ?? Quaternion.Identity(); node.rotationQuaternion = Quaternion.Inverse(pwq).multiply(wq); }
          else { node.rotationQuaternion = wq; }
        }
        const hd = frame['Hips']; const hn = skelNodesRef.current.get('Hips');
        if (hn && hd?.dp) { hn.position.x = hipsVP.x + (-hd.dp[0]) * sf; hn.position.y = hipsVP.y + hd.dp[1] * sf; hn.position.z = hipsVP.z + hd.dp[2] * sf; }
        else if (hn) { hn.position.copyFrom(hipsVP); }
      };
      const cb = () => { const now = performance.now(); const dt = (now - lt) / 1000; lt = now; animTimeRef.current += dt; const l = animTimeRef.current % clip.duration; const fi = Math.min(Math.floor(l / fd), clip.frameCount - 1); af(fi); };
      // Switch to skeletal meshes for animation
      for (const m of resultMeshesRef.current) m.isVisible = false;
      for (const [, m] of skelMeshesRef.current) m.isVisible = true;

      animCallbackRef.current = cb; scene.registerBeforeRender(cb); setPlayingMotion(motionName);
    } catch (e) { setError(`Motion: ${e instanceof Error ? e.message : String(e)}`); }
    setLoadingMotion(false);
  }, []);

  const stopMotion = useCallback(() => {
    const scene = sceneRef.current; if (!scene) return;
    if (animCallbackRef.current) { scene.unregisterBeforeRender(animCallbackRef.current); animCallbackRef.current = null; }
    setPlayingMotion(null);
    // Switch back to flat mesh
    for (const [, m] of skelMeshesRef.current) m.isVisible = false;
    for (const m of resultMeshesRef.current) m.isVisible = true;
    // Reset skeleton to rest pose
    if (!deformParamsRef.current) return;
    const bones = calculateTargetBones(worldMarkersRef.current, deformParamsRef.current); const cx = BODY_SIZE.x / 2, cy = BODY_SIZE.y / 2;
    for (const bd of BONE_DEFS) {
      const node = skelNodesRef.current.get(bd.name); const bp = bones[bd.name]; if (!node || !bp) continue;
      node.rotationQuaternion = Quaternion.Identity();
      if (bd.parent) { const pp = bones[bd.parent]; if (pp) node.position = voxelToViewer(bp.x, bp.y, bp.z, cx, cy).subtract(voxelToViewer(pp.x, pp.y, pp.z, cx, cy)); }
      else { node.position = voxelToViewer(bp.x, bp.y, bp.z, cx, cy); }
    }
  }, []);

  // ============================================================
  // Export
  // ============================================================
  const doExportBody = useCallback(() => {
    if (bodyVoxels.length === 0) return;
    const blob = exportVoxBlob(bodyVoxels, BODY_SIZE.x, BODY_SIZE.y, BODY_SIZE.z);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${fileName?.replace(/\.[^.]+$/, '') ?? 'chibi'}_body.vox`; a.click();
  }, [bodyVoxels, fileName]);

  const doExportSkeletal = useCallback(() => {
    if (bodyVoxels.length === 0 || !deformParamsRef.current) return;
    const bones = calculateTargetBones(worldMarkersRef.current, deformParamsRef.current);
    const data = exportSkeletalModelJSON(bodyVoxels, bones);
    const json = JSON.stringify(data);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${fileName?.replace(/\.[^.]+$/, '') ?? 'chibi'}_skeletal.json`; a.click();
  }, [bodyVoxels, fileName]);

  const doExportGLB = useCallback(() => {
    if (bodyVoxels.length === 0 || !deformParamsRef.current) return;
    const bones = calculateTargetBones(worldMarkersRef.current, deformParamsRef.current);
    const blob = exportSkinnedGLB(bodyVoxels, bones);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${fileName?.replace(/\.[^.]+$/, '') ?? 'chibi'}_skinned.glb`; a.click();
  }, [bodyVoxels, fileName]);

  const doExportSegments = useCallback(() => {
    if (bodyVoxels.length === 0 || !deformParamsRef.current) return;
    const bones = calculateTargetBones(worldMarkersRef.current, deformParamsRef.current);
    const baseName = fileName?.replace(/\.[^.]+$/, '') ?? 'chibi';

    // 1. segments_bundle.json (ボーン別ボクセル + パレット)
    const bundle = exportSegmentsBundle(bodyVoxels, bones);
    const a1 = document.createElement('a'); a1.href = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }));
    a1.download = `${baseName}_segments_bundle.json`; a1.click();

    // 2. segments.json (ボーン位置・階層)
    const info = exportSegmentsInfo(bodyVoxels, bones);
    setTimeout(() => {
      const a2 = document.createElement('a'); a2.href = URL.createObjectURL(new Blob([JSON.stringify(info)], { type: 'application/json' }));
      a2.download = `${baseName}_segments.json`; a2.click();
    }, 300);
  }, [bodyVoxels, fileName]);

  const doExportPart = useCallback((name: string) => {
    const pv = otherPartVoxels[name]; if (!pv?.length) return;
    const blob = exportVoxBlob(pv, BODY_SIZE.x, BODY_SIZE.y, BODY_SIZE.z);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${name}.vox`; a.click();
  }, [otherPartVoxels]);

  // ============================================================
  // Go back
  // ============================================================
  const goBack = useCallback(() => {
    const scene = sceneRef.current; if (!scene) return;
    if (step === 'parts') {
      setStep('upload');
    } else if (step === 'markers') {
      if (centerLineRef.current) { centerLineRef.current.dispose(); centerLineRef.current = null; }
      for (const [, m] of markerMeshesRef.current) m.dispose(); markerMeshesRef.current.clear();
      // Restore click-to-select
      scene.onPointerDown = (_evt, pick) => {
        if (pick?.hit && pick.pickedMesh) {
          for (const [pn, ms] of meshMapRef.current) { if (ms.includes(pick.pickedMesh)) { setSelectedPart(pn); return; } }
        }
      };
      setStep('parts');
    } else if (step === 'result') {
      clearResult();
      // Re-enable original meshes, respecting per-part visibility
      for (const [name, ms] of meshMapRef.current) {
        const visible = parts[name]?.visible ?? true;
        for (const m of ms) { m.setEnabled(true); m.isVisible = visible; }
      }
      if (centerLineRef.current) { centerLineRef.current.setEnabled(true); centerLineRef.current.isVisible = true; }
      for (const [, m] of markerMeshesRef.current) { m.setEnabled(true); m.isVisible = true; }
      const cam = scene.activeCamera as ArcRotateCamera; if (cam) { cam.target = modelCenter; }
      setStep('markers');
    }
  }, [step, clearResult, parts, modelCenter]);

  // Drag & drop
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) loadModel(f); };

  // Part counts
  const categoryCounts: Record<string, number> = {};
  for (const p of Object.values(parts)) categoryCounts[p.category] = (categoryCounts[p.category] ?? 0) + 1;
  const hasBody = categoryCounts['body'] > 0;

  const partNames = Object.keys(parts).sort((a, b) => {
    const o: Record<string, number> = { body: 0, hair: 1, clothing: 2, other: 3, exclude: 4 };
    const oa = o[parts[a].category] ?? 3, ob = o[parts[b].category] ?? 3;
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  });

  // ============================================================
  // Render
  // ============================================================
  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', background: '#111118', fontFamily: 'system-ui, sans-serif' }}>
      {/* ===== SIDEBAR ===== */}
      <div style={{ width: 320, minWidth: 320, background: '#0d0d14', color: '#ccc', borderRight: '1px solid #2a2a3a', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #2a2a3a' }}>
          <div style={{ fontSize: 16, fontWeight: 'bold', color: '#fff', letterSpacing: 1 }}>AUTO-RIGGER</div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
            {step === 'upload' && 'Step 1: Load 3D Model'}
            {step === 'parts' && 'Step 2: Classify Parts'}
            {step === 'markers' && 'Step 3: Place Markers'}
            {step === 'result' && 'Step 4: Result'}
          </div>
        </div>

        {/* === UPLOAD === */}
        {step === 'upload' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
            <label style={{ padding: '12px 24px', borderRadius: 6, background: '#1a2a44', color: '#6af', border: '1px solid #3a5a8a', cursor: 'pointer', fontSize: 14, fontWeight: 'bold' }}>
              Open 3D File
              <input type="file" accept=".glb,.gltf,.obj" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) loadModel(f); }} />
            </label>
            <div style={{ fontSize: 11, color: '#555', marginTop: 12 }}>GLB / GLTF / OBJ</div>
            {fileName && <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>{fileName}</div>}
            {loading && <div style={{ fontSize: 12, color: '#6af', marginTop: 12 }}>Loading...</div>}
            {error && <div style={{ fontSize: 11, color: '#f66', marginTop: 12 }}>{error}</div>}
          </div>
        )}

        {/* === PARTS === */}
        {step === 'parts' && (
          <>
            {/* Instructions */}
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #2a2a3a', background: '#0f1018' }}>
              <div style={{ fontSize: 11, color: '#aaa', lineHeight: 1.6 }}>
                各パーツのカテゴリを設定してください。<br />
                3Dビューのパーツをクリックで選択できます。
              </div>
            </div>

            {/* Category summary */}
            <div style={{ padding: '8px 16px', borderBottom: '1px solid #2a2a3a', display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {PART_CATEGORIES.filter(c => categoryCounts[c]).map(c => (
                <span key={c} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 3, background: CATEGORY_INFO[c].color + '22', color: CATEGORY_INFO[c].color, border: `1px solid ${CATEGORY_INFO[c].color}44` }}>
                  {CATEGORY_INFO[c].labelJa} ({categoryCounts[c]})
                </span>
              ))}
            </div>

            {/* Part list */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              {partNames.map(name => {
                const p = parts[name]; const ci = CATEGORY_INFO[p.category];
                const isSel = selectedPart === name;
                return (
                  <div key={name} onClick={() => setSelectedPart(name)} style={{
                    padding: '10px 12px', borderBottom: '1px solid #1a1a22', cursor: 'pointer',
                    background: isSel ? '#1a2a3a' : 'transparent', opacity: p.visible ? 1 : 0.4,
                  }}>
                    {/* Name row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <button onClick={e => { e.stopPropagation(); toggleVis(name); }} style={{
                        width: 20, height: 20, border: 'none', borderRadius: 3, background: p.visible ? '#3a3a4a' : '#222',
                        color: p.visible ? '#aaa' : '#555', cursor: 'pointer', fontSize: 12, lineHeight: '20px', padding: 0,
                      }}>{p.visible ? '\u25C9' : '\u25CB'}</button>
                      <span style={{ fontSize: 12, fontWeight: isSel ? 'bold' : 'normal', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                      <span style={{ fontSize: 9, color: '#666' }}>{p.vertexCount}v</span>
                    </div>
                    {/* Category buttons */}
                    <div style={{ display: 'flex', gap: 4, paddingLeft: 26 }} onClick={e => e.stopPropagation()}>
                      {PART_CATEGORIES.map(c => {
                        const info = CATEGORY_INFO[c];
                        const isActive = p.category === c;
                        return (
                          <button key={c} onClick={() => setCat(name, c)} style={{
                            flex: 1, padding: '4px 2px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
                            background: isActive ? info.color + '44' : '#1a1a22',
                            color: isActive ? info.color : '#666',
                            border: isActive ? `2px solid ${info.color}` : '1px solid #2a2a3a',
                            fontWeight: isActive ? 'bold' : 'normal',
                          }}>
                            {info.labelJa}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom */}
            <div style={{ padding: '12px 16px', borderTop: '1px solid #2a2a3a', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!hasBody && (
                <div style={{ fontSize: 11, color: '#f86', padding: '8px 10px', background: '#2a1a1a', borderRadius: 4, lineHeight: 1.5 }}>
                  少なくとも1つのパーツを「ボディ」に設定してください
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={goBack} style={{ flex: 1, padding: '8px', borderRadius: 4, background: '#1a1a2a', color: '#888', border: '1px solid #333', cursor: 'pointer', fontSize: 12 }}>BACK</button>
                <button onClick={goToMarkers} disabled={!hasBody} style={{
                  flex: 2, padding: '8px', borderRadius: 4, fontSize: 14, fontWeight: 'bold',
                  background: hasBody ? '#e65100' : '#333', color: hasBody ? '#fff' : '#666', border: 'none', cursor: hasBody ? 'pointer' : 'default',
                }}>NEXT: Markers</button>
              </div>
            </div>
          </>
        )}

        {/* === MARKERS === */}
        {step === 'markers' && (
          <>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #2a2a3a', fontSize: 11, color: '#777', lineHeight: 1.6 }}>
              Click a marker name, then click on the model to place it.
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {MARKER_GROUPS.map(g => {
                const left = g.names[0]; const right = g.names.length > 1 ? g.names[1] : null;
                const lOk = !!markers[left]; const rOk = right ? (useSymmetry ? lOk : !!markers[right]) : true;
                return (
                  <div key={g.label} style={{ padding: '8px 16px', borderBottom: '1px solid #1a1a24', background: activeMarker === left || activeMarker === right ? '#1a1a30' : 'transparent' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: lOk && rOk ? g.color : 'transparent', border: `2px solid ${g.color}` }} />
                      <span style={{ fontWeight: 'bold', fontSize: 13, color: g.color }}>{g.label}</span>
                      {lOk && rOk && <span style={{ fontSize: 10, color: '#4c4', marginLeft: 'auto' }}>OK</span>}
                    </div>
                    <div style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button onClick={() => setActiveMarker(left)} style={{
                          padding: '3px 8px', borderRadius: 3, fontSize: 11, minWidth: 80, textAlign: 'left', cursor: 'pointer',
                          background: activeMarker === left ? g.color + '33' : lOk ? '#1a2a1a' : '#1a1a2a',
                          color: activeMarker === left ? g.color : lOk ? '#8a8' : '#888',
                          border: activeMarker === left ? `2px solid ${g.color}` : '1px solid #333',
                        }}>{right ? 'Left' : left}{lOk && ' \u2713'}</button>
                        {lOk && <button onClick={() => clearMarker(left)} style={{ padding: '1px 5px', fontSize: 9, background: '#2a1a1a', color: '#a66', border: '1px solid #3a2a2a', borderRadius: 3, cursor: 'pointer' }}>x</button>}
                      </div>
                      {right && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button onClick={() => !useSymmetry && setActiveMarker(right)} style={{
                            padding: '3px 8px', borderRadius: 3, fontSize: 11, minWidth: 80, textAlign: 'left',
                            cursor: useSymmetry ? 'default' : 'pointer', opacity: useSymmetry ? 0.5 : 1,
                            background: rOk ? '#1a2a1a' : '#1a1a2a', color: rOk ? '#686' : '#555', border: '1px solid #333',
                          }}>Right{rOk && ' \u2713'}{useSymmetry && rOk && ' (mirror)'}</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid #2a2a3a', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={useSymmetry} onChange={e => setUseSymmetry(e.target.checked)} /> Use Symmetry
              </label>
              <button onClick={() => { setMarkers({}); setActiveMarker('Chin'); }} style={{ padding: '5px', borderRadius: 4, fontSize: 11, background: '#1a1a2a', color: '#888', border: '1px solid #333', cursor: 'pointer' }}>Reset All</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={goBack} style={{ flex: 1, padding: '8px', borderRadius: 4, background: '#1a1a2a', color: '#888', border: '1px solid #333', cursor: 'pointer', fontSize: 12 }}>BACK</button>
                <button onClick={doGenerate} disabled={!allMarkersPlaced || generating} style={{
                  flex: 2, padding: '8px', borderRadius: 4, fontSize: 14, fontWeight: 'bold',
                  background: allMarkersPlaced ? '#e65100' : '#333', color: allMarkersPlaced ? '#fff' : '#666', border: 'none', cursor: allMarkersPlaced && !generating ? 'pointer' : 'default',
                }}>{generating ? genStatus || 'Generating...' : 'GENERATE'}</button>
              </div>
              {error && <div style={{ fontSize: 10, color: '#f66' }}>{error}</div>}
            </div>
          </>
        )}

        {/* === RESULT === */}
        {step === 'result' && (
          <>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a3a' }}>
              <div style={{ fontSize: 13, color: '#4c4', fontWeight: 'bold' }}>Complete</div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{bodyVoxels.length} body voxels / 41 bones</div>
            </div>

            {/* Motion test */}
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #2a2a3a' }}>
              <div style={{ fontSize: 12, color: '#aaa', fontWeight: 'bold', marginBottom: 6 }}>Motion Test</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {MOTIONS.map(m => (
                  <button key={m.name} onClick={() => playingMotion === m.name ? stopMotion() : startMotion(m.name)} disabled={loadingMotion} style={{
                    padding: '5px 8px', borderRadius: 3, fontSize: 11, textAlign: 'left', cursor: 'pointer',
                    background: playingMotion === m.name ? '#2a3a1a' : '#1a1a2a',
                    color: playingMotion === m.name ? '#8c4' : '#888',
                    border: playingMotion === m.name ? '1px solid #4a5a3a' : '1px solid #2a2a3a',
                  }}>{playingMotion === m.name ? '\u25A0 ' : '\u25B6 '}{m.label}</button>
                ))}
              </div>
            </div>

            {/* Other parts */}
            {Object.keys(otherPartVoxels).length > 0 && (
              <div style={{ padding: '10px 16px', borderBottom: '1px solid #2a2a3a' }}>
                <div style={{ fontSize: 12, color: '#aaa', fontWeight: 'bold', marginBottom: 6 }}>Other Parts</div>
                {Object.entries(otherPartVoxels).map(([name, vox]) => (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                    <span style={{ fontSize: 11, flex: 1, color: '#888' }}>{name}</span>
                    <span style={{ fontSize: 9, color: '#666' }}>{vox.length}v</span>
                    <button onClick={() => doExportPart(name)} style={{ padding: '2px 8px', fontSize: 10, background: '#1a2a44', color: '#6af', border: '1px solid #3a5a8a', borderRadius: 3, cursor: 'pointer' }}>.vox</button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ flex: 1 }} />
            <div style={{ padding: '12px 16px', borderTop: '1px solid #2a2a3a', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={doExportSegments} style={{ padding: '10px', borderRadius: 4, fontSize: 13, fontWeight: 'bold', background: '#1a3a1a', color: '#6f6', border: '1px solid #3a8a3a', cursor: 'pointer' }}>Export Segments (ボーン分離)</button>
              <button onClick={doExportGLB} style={{ padding: '10px', borderRadius: 4, fontSize: 13, fontWeight: 'bold', background: '#2a3a1a', color: '#af6', border: '1px solid #5a7a3a', cursor: 'pointer' }}>Export Skinned .glb</button>
              <button onClick={doExportSkeletal} style={{ padding: '10px', borderRadius: 4, fontSize: 13, fontWeight: 'bold', background: '#2a1a44', color: '#a6f', border: '1px solid #5a3a8a', cursor: 'pointer' }}>Export Skeletal .json</button>
              <button onClick={doExportBody} style={{ padding: '10px', borderRadius: 4, fontSize: 13, fontWeight: 'bold', background: '#1a2a44', color: '#6af', border: '1px solid #3a5a8a', cursor: 'pointer' }}>Export Body .vox</button>
              <button onClick={goBack} style={{ padding: '8px', borderRadius: 4, fontSize: 12, background: '#1a1a2a', color: '#888', border: '1px solid #333', cursor: 'pointer' }}>BACK</button>
              {error && <div style={{ fontSize: 10, color: '#f66' }}>{error}</div>}
            </div>
          </>
        )}
      </div>

      {/* ===== CANVAS ===== */}
      <div style={{ flex: 1, position: 'relative' }} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', outline: 'none' }} />
        {dragOver && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(40,80,160,0.3)', border: '3px dashed #48f', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ fontSize: 24, color: '#8cf', fontWeight: 'bold' }}>Drop model file here</div>
          </div>
        )}
        {step === 'upload' && !fileName && !loading && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ fontSize: 48, color: '#333', marginBottom: 16 }}>+</div>
            <div style={{ fontSize: 16, color: '#555' }}>Drag & drop a 3D model</div>
            <div style={{ fontSize: 12, color: '#444', marginTop: 8 }}>.glb / .gltf / .obj</div>
          </div>
        )}
        {step === 'markers' && activeMarker && (
          <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.8)', padding: '8px 16px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: getMarkerColor(activeMarker) }} />
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>Click to place: {activeMarker}</span>
          </div>
        )}
        {/* Selected part info */}
        {step === 'parts' && selectedPart && parts[selectedPart] && (
          <div style={{ position: 'absolute', bottom: 16, left: 16, right: 16, background: 'rgba(15,15,35,0.9)', border: '1px solid #333', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, display: 'inline-block', background: CATEGORY_INFO[parts[selectedPart].category].color }} />
              <span style={{ fontSize: 13, fontWeight: 'bold', color: '#ccc' }}>{selectedPart}</span>
              <span style={{ fontSize: 11, color: '#888' }}>{CATEGORY_INFO[parts[selectedPart].category].labelJa}</span>
              <span style={{ fontSize: 10, color: '#666' }}>{parts[selectedPart].vertexCount} verts</span>
              <button onClick={() => setSelectedPart(null)} style={{ marginLeft: 'auto', padding: '2px 8px', border: '1px solid #555', borderRadius: 3, background: '#2a2a3a', color: '#888', cursor: 'pointer', fontSize: 11 }}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
