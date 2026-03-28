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
  Vector3, Color3, Mesh, MeshBuilder, StandardMaterial,
  SceneLoader, AbstractMesh, TransformNode, ArcRotateCamera,
  Quaternion,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

import {
  BODY_SIZE, VSCALE, MARKER_GROUPS, MIRROR_PAIRS,
  getMarkerColor, BONE_DEFS,
  CATEGORY_INFO, PART_CATEGORIES, guessCategory,
  calculateTargetBones, uniformChibiVoxelize, buildSkeletalCharacter,
  buildFlatVoxelMesh,
  type VoxelEntry, type PartCategory, type DeformParams,
} from '@/utils/auto-rigger';

import type { Step, PartConfig } from '@/utils/model-import/types';
import { MOTIONS, PLACEABLE_MARKERS, PLACEABLE_MARKERS_NO_SYM } from '@/utils/model-import/constants';
import { parseObjToMeshes } from '@/utils/model-import/obj-parser';
import { computeModelBounds } from '@/utils/model-import/model-bounds';

import { UploadStep } from '@/components/model-import/UploadStep';
import { PartsStep } from '@/components/model-import/PartsStep';
import { MarkersStep } from '@/components/model-import/MarkersStep';
import { ResultStep } from '@/components/model-import/ResultStep';
import { CanvasOverlay } from '@/components/model-import/CanvasOverlay';
import EditorLayout from '@/templates/EditorLayout';

import { useModelImportScene } from './hooks/useModelImportScene';
import { useModelImportMotion } from './hooks/useModelImportMotion';
import { useModelImportExport } from './hooks/useModelImportExport';

// ============================================================
// メインビューコンポーネント
// ============================================================
export default function ModelImportView() {
  const { canvasRef, sceneRef, engineRef, highlightRef } = useModelImportScene();

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

  // パーツ分類状態（Step 2用）
  const [parts, setParts] = useState<Record<string, PartConfig>>({});
  const [selectedPart, setSelectedPart] = useState<string | null>(null);

  // マーカー状態（Step 3用）
  const [markers, setMarkers] = useState<Record<string, Vector3>>({});
  const [activeMarker, setActiveMarker] = useState<string | null>(null);
  const [useSymmetry, setUseSymmetry] = useState(true);
  const [modelCenter, setModelCenter] = useState<Vector3>(Vector3.Zero());

  // 結果状態（Step 4用）
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState('');
  const [bodyVoxels, setBodyVoxels] = useState<VoxelEntry[]>([]);
  const [otherPartVoxels, setOtherPartVoxels] = useState<Record<string, VoxelEntry[]>>({});

  // Motion hook
  const { playingMotion, loadingMotion, startMotion, stopMotion, setPlayingMotion } = useModelImportMotion({
    sceneRef, skelNodesRef, skelMeshesRef, restPosRef,
    deformParamsRef, worldMarkersRef, resultMeshesRef,
    animCallbackRef, animTimeRef,
  });

  // Export hook
  const { doExportBody, doExportSkeletal, doExportGLB, doExportSegments, doExportPart } = useModelImportExport({
    bodyVoxels, fileName, deformParamsRef, worldMarkersRef, otherPartVoxels,
  });

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
  }, [sceneRef, setPlayingMotion]);

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
  }, [sceneRef, clearResult]);

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
  }, [selectedPart, highlightRef]);

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
  }, [sceneRef, highlightRef]);

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
  }, [step, activeMarker, markers, useSymmetry, mirrorPos, sceneRef]);

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
  }, [markers, activeMarker, useSymmetry, mirrorPos, sceneRef]);

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

      // Disable ALL original meshes
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

      // Voxelize all meshes together
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

      // Display voxels
      const cx = BODY_SIZE.x / 2, cy = BODY_SIZE.y / 2;

      if (mergedVoxels.length > 0) {
        setGenStatus(`Building display (${mergedVoxels.length} voxels)...`);
        const bodyMesh = buildFlatVoxelMesh(mergedVoxels, scene, 'body_voxels', cx, cy);
        resultMeshesRef.current.push(bodyMesh);

        const bones = calculateTargetBones(worldMarkers, deformParams);
        const { nodes, meshes: skelMeshMap, restPos } = buildSkeletalCharacter(mergedVoxels, bones, scene, cx, cy, 'rig');
        skelNodesRef.current = nodes; skelMeshesRef.current = skelMeshMap; restPosRef.current = restPos;
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
  }, [sceneRef, highlightRef, completeMarkers, clearResult, parts]);

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
      scene.onPointerDown = (_evt, pick) => {
        if (pick?.hit && pick.pickedMesh) {
          for (const [pn, ms] of meshMapRef.current) { if (ms.includes(pick.pickedMesh)) { setSelectedPart(pn); return; } }
        }
      };
      setStep('parts');
    } else if (step === 'result') {
      clearResult();
      for (const [name, ms] of meshMapRef.current) {
        const visible = parts[name]?.visible ?? true;
        for (const m of ms) { m.setEnabled(true); m.isVisible = visible; }
      }
      if (centerLineRef.current) { centerLineRef.current.setEnabled(true); centerLineRef.current.isVisible = true; }
      for (const [, m] of markerMeshesRef.current) { m.setEnabled(true); m.isVisible = true; }
      const cam = scene.activeCamera as ArcRotateCamera; if (cam) { cam.target = modelCenter; }
      setStep('markers');
    }
  }, [step, sceneRef, clearResult, parts, modelCenter]);

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
  const sidebar = (
    <div style={{ background: '#0d0d14', color: '#ccc', borderRight: '1px solid #2a2a3a', display: 'flex', flexDirection: 'column', height: '100%' }}>
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

      {step === 'upload' && (
        <UploadStep fileName={fileName} loading={loading} error={error} onFileSelect={loadModel} />
      )}
      {step === 'parts' && (
        <PartsStep
          parts={parts} selectedPart={selectedPart} partNames={partNames}
          categoryCounts={categoryCounts} hasBody={hasBody} error={error}
          partCategories={PART_CATEGORIES} categoryInfo={CATEGORY_INFO}
          onSelectPart={setSelectedPart} onToggleVis={toggleVis}
          onSetCategory={setCat} onBack={goBack} onNext={goToMarkers}
        />
      )}
      {step === 'markers' && (
        <MarkersStep
          markers={markers} activeMarker={activeMarker} useSymmetry={useSymmetry}
          allMarkersPlaced={allMarkersPlaced} generating={generating}
          genStatus={genStatus} error={error} markerGroups={MARKER_GROUPS}
          onSetActiveMarker={setActiveMarker} onClearMarker={clearMarker}
          onSetUseSymmetry={setUseSymmetry}
          onResetMarkers={() => { setMarkers({}); setActiveMarker('Chin'); }}
          onBack={goBack} onGenerate={doGenerate}
        />
      )}
      {step === 'result' && (
        <ResultStep
          bodyVoxels={bodyVoxels} otherPartVoxels={otherPartVoxels}
          playingMotion={playingMotion} loadingMotion={loadingMotion}
          error={error} motions={MOTIONS}
          onStartMotion={startMotion} onStopMotion={stopMotion}
          onExportSegments={doExportSegments} onExportGLB={doExportGLB}
          onExportSkeletal={doExportSkeletal} onExportBody={doExportBody}
          onExportPart={doExportPart} onBack={goBack}
        />
      )}
    </div>
  );

  const overlay = (
    <CanvasOverlay
      step={step} activeMarker={activeMarker} dragOver={dragOver}
      fileName={fileName} loading={loading} selectedPart={selectedPart}
      parts={parts} categoryInfo={CATEGORY_INFO}
      getMarkerColor={getMarkerColor} onDeselectPart={() => setSelectedPart(null)}
    />
  );

  return (
    <EditorLayout
      ref={canvasRef}
      sidebar={sidebar}
      overlay={overlay}
      background="#111118"
      canvasContainerProps={{ onDragOver, onDragLeave, onDrop }}
    />
  );
}
