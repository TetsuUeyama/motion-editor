import { useCallback, useState, type MutableRefObject } from 'react';
import {
  Scene, Vector3, Quaternion, TransformNode, Mesh, AbstractMesh, ArcRotateCamera,
} from '@babylonjs/core';
import type { HighlightLayer } from '@babylonjs/core';
import {
  BODY_SIZE, VSCALE, BONE_DEFS,
  calculateTargetBones,
  voxelToViewer, loadMotionClip, threeQuatToViewer,
  uniformChibiVoxelize, buildSkeletalCharacter, buildFlatVoxelMesh,
  exportVoxBlob, exportSkeletalModelJSON, exportSkinnedGLB,
  exportSegmentsBundle, exportSegmentsInfo,
  type DeformParams, type VoxelEntry,
} from '@/utils/auto-rigger';
import type { Step, PartConfig } from '@/utils/model-import/constants';
import { MOTION_BASE } from '@/utils/model-import/constants';
import { computeModelBounds } from '@/utils/model-import/parsers';

// ============================================================
// useModelImportMotion
// ============================================================

interface UseModelImportMotionParams {
  sceneRef: MutableRefObject<Scene | null>;
  skelNodesRef: MutableRefObject<Map<string, TransformNode>>;
  skelMeshesRef: MutableRefObject<Map<string, Mesh>>;
  restPosRef: MutableRefObject<Map<string, Vector3>>;
  deformParamsRef: MutableRefObject<DeformParams | null>;
  worldMarkersRef: MutableRefObject<Record<string, Vector3>>;
  resultMeshesRef: MutableRefObject<Mesh[]>;
  animCallbackRef: MutableRefObject<(() => void) | null>;
  animTimeRef: MutableRefObject<number>;
}

/**
 * Hook for motion playback (start/stop) on the skeletal character.
 */
export function useModelImportMotion({
  sceneRef, skelNodesRef, skelMeshesRef, restPosRef,
  deformParamsRef, worldMarkersRef, resultMeshesRef,
  animCallbackRef, animTimeRef,
}: UseModelImportMotionParams) {
  const [playingMotion, setPlayingMotion] = useState<string | null>(null);
  const [loadingMotion, setLoadingMotion] = useState(false);

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
    } catch (e) { console.error('Motion error:', e); }
    setLoadingMotion(false);
  }, [sceneRef, skelNodesRef, skelMeshesRef, restPosRef, deformParamsRef, worldMarkersRef, resultMeshesRef, animCallbackRef, animTimeRef]);

  const stopMotion = useCallback(() => {
    const scene = sceneRef.current; if (!scene) return;
    if (animCallbackRef.current) { scene.unregisterBeforeRender(animCallbackRef.current); animCallbackRef.current = null; }
    setPlayingMotion(null);
    for (const [, m] of skelMeshesRef.current) m.isVisible = false;
    for (const m of resultMeshesRef.current) m.isVisible = true;
    if (!deformParamsRef.current) return;
    const bones = calculateTargetBones(worldMarkersRef.current, deformParamsRef.current); const cx = BODY_SIZE.x / 2, cy = BODY_SIZE.y / 2;
    for (const bd of BONE_DEFS) {
      const node = skelNodesRef.current.get(bd.name); const bp = bones[bd.name]; if (!node || !bp) continue;
      node.rotationQuaternion = Quaternion.Identity();
      if (bd.parent) { const pp = bones[bd.parent]; if (pp) node.position = voxelToViewer(bp.x, bp.y, bp.z, cx, cy).subtract(voxelToViewer(pp.x, pp.y, pp.z, cx, cy)); }
      else { node.position = voxelToViewer(bp.x, bp.y, bp.z, cx, cy); }
    }
  }, [sceneRef, skelNodesRef, skelMeshesRef, restPosRef, deformParamsRef, worldMarkersRef, resultMeshesRef, animCallbackRef]);

  return { playingMotion, loadingMotion, startMotion, stopMotion, setPlayingMotion };
}

// ============================================================
// useModelImportExport
// ============================================================

interface UseModelImportExportParams {
  bodyVoxels: VoxelEntry[];
  fileName: string | null;
  deformParamsRef: MutableRefObject<DeformParams | null>;
  worldMarkersRef: MutableRefObject<Record<string, Vector3>>;
  otherPartVoxels: Record<string, VoxelEntry[]>;
}

/**
 * Hook for all export callbacks (body .vox, skeletal .json, skinned .glb, segments, part .vox).
 */
export function useModelImportExport({
  bodyVoxels, fileName, deformParamsRef, worldMarkersRef, otherPartVoxels,
}: UseModelImportExportParams) {
  const baseName = fileName?.replace(/\.[^.]+$/, '') ?? 'chibi';

  const doExportBody = useCallback(() => {
    if (bodyVoxels.length === 0) return;
    const blob = exportVoxBlob(bodyVoxels, BODY_SIZE.x, BODY_SIZE.y, BODY_SIZE.z);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${baseName}_body.vox`; a.click();
  }, [bodyVoxels, baseName]);

  const doExportSkeletal = useCallback(() => {
    if (bodyVoxels.length === 0 || !deformParamsRef.current) return;
    const bones = calculateTargetBones(worldMarkersRef.current, deformParamsRef.current);
    const data = exportSkeletalModelJSON(bodyVoxels, bones);
    const json = JSON.stringify(data);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${baseName}_skeletal.json`; a.click();
  }, [bodyVoxels, baseName, deformParamsRef, worldMarkersRef]);

  const doExportGLB = useCallback(() => {
    if (bodyVoxels.length === 0 || !deformParamsRef.current) return;
    const bones = calculateTargetBones(worldMarkersRef.current, deformParamsRef.current);
    const blob = exportSkinnedGLB(bodyVoxels, bones);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${baseName}_skinned.glb`; a.click();
  }, [bodyVoxels, baseName, deformParamsRef, worldMarkersRef]);

  const doExportSegments = useCallback(() => {
    if (bodyVoxels.length === 0 || !deformParamsRef.current) return;
    const bones = calculateTargetBones(worldMarkersRef.current, deformParamsRef.current);

    const bundle = exportSegmentsBundle(bodyVoxels, bones);
    const a1 = document.createElement('a'); a1.href = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }));
    a1.download = `${baseName}_segments_bundle.json`; a1.click();

    const info = exportSegmentsInfo(bodyVoxels, bones);
    setTimeout(() => {
      const a2 = document.createElement('a'); a2.href = URL.createObjectURL(new Blob([JSON.stringify(info)], { type: 'application/json' }));
      a2.download = `${baseName}_segments.json`; a2.click();
    }, 300);
  }, [bodyVoxels, baseName, deformParamsRef, worldMarkersRef]);

  const doExportPart = useCallback((name: string) => {
    const pv = otherPartVoxels[name]; if (!pv?.length) return;
    const blob = exportVoxBlob(pv, BODY_SIZE.x, BODY_SIZE.y, BODY_SIZE.z);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${name}.vox`; a.click();
  }, [otherPartVoxels]);

  return { doExportBody, doExportSkeletal, doExportGLB, doExportSegments, doExportPart };
}

// ============================================================
// useModelImportGenerate
// ============================================================

interface UseModelImportGenerateParams {
  sceneRef: MutableRefObject<Scene | null>;
  highlightRef: MutableRefObject<HighlightLayer | null>;
  meshMapRef: MutableRefObject<Map<string, AbstractMesh[]>>;
  centerLineRef: MutableRefObject<Mesh | null>;
  markerMeshesRef: MutableRefObject<Map<string, Mesh>>;
  deformParamsRef: MutableRefObject<DeformParams | null>;
  worldMarkersRef: MutableRefObject<Record<string, Vector3>>;
  resultMeshesRef: MutableRefObject<Mesh[]>;
  skelNodesRef: MutableRefObject<Map<string, TransformNode>>;
  skelMeshesRef: MutableRefObject<Map<string, Mesh>>;
  restPosRef: MutableRefObject<Map<string, Vector3>>;
  completeMarkers: () => Record<string, Vector3>;
  clearResult: () => void;
  parts: Record<string, PartConfig>;
  setBodyVoxels: (v: VoxelEntry[]) => void;
  setOtherPartVoxels: (v: Record<string, VoxelEntry[]>) => void;
  setError: (e: string | null) => void;
  setStep: (s: Step) => void;
}

/**
 * The doGenerate callback: voxelizes body + overlay clothing + builds skeleton.
 */
export function useModelImportGenerate({
  sceneRef, highlightRef, meshMapRef, centerLineRef, markerMeshesRef,
  deformParamsRef, worldMarkersRef, resultMeshesRef,
  skelNodesRef, skelMeshesRef, restPosRef,
  completeMarkers, clearResult, parts,
  setBodyVoxels, setOtherPartVoxels, setError, setStep,
}: UseModelImportGenerateParams) {
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState('');

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
  }, [sceneRef, highlightRef, completeMarkers, clearResult, parts,
      meshMapRef, centerLineRef, markerMeshesRef, deformParamsRef,
      worldMarkersRef, resultMeshesRef, skelNodesRef, skelMeshesRef, restPosRef,
      setBodyVoxels, setOtherPartVoxels, setError, setStep]);

  return { doGenerate, generating, genStatus };
}
