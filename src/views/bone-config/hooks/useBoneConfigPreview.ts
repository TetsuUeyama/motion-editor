/**
 * プレビューモード関連のロジックを管理するフック
 * 装備ボクセルの読み込み、プレビューの開始/終了、設定の保存を担当する
 */
import { useCallback, useState } from 'react';
import {
  Vector3, TransformNode, Mesh,
} from '@babylonjs/core';
import { BONE_DEFS, type Vec3, voxelToViewer } from '@/utils/voxel-skeleton';
import { loadVoxFile, SCALE } from '@/utils/vox-parser';
import type { VoxelEntry } from '@/utils/vox-parser';
import type { EquipPart, ViewDirection } from '@/utils/bone-config/constants';
import type { useBoneConfigRefs } from './useBoneConfigRefs';

// プレビュー構築関数の型（page.tsxから渡される）
type BuildSkeletalPreviewFn = (
  voxels: VoxelEntry[],
  bones: Record<string, Vec3>,
  scene: import('@babylonjs/core').Scene,
  cx: number,
  cy: number,
) => { nodes: Map<string, TransformNode>; meshes: Map<string, Mesh> };

// フックが受け取るパラメータ型
interface PreviewHookParams {
  refs: ReturnType<typeof useBoneConfigRefs>;
  calculatedBones: Record<string, Vec3>;
  markers: Record<string, Vec3>;
  autoMirror: boolean;
  showBody: boolean;
  currentModel: { dir: string };
  equipParts: EquipPart[];
  equipEnabled: Record<string, boolean>;
  equipVoxelCache: Record<string, VoxelEntry[]>;
  setEquipVoxelCache: (cache: Record<string, VoxelEntry[]>) => void;
  setMode: (mode: 'edit' | 'preview') => void;
  setShowBonesOnly: (v: boolean) => void;
  setSaving: (v: boolean) => void;
  setDirty: (v: boolean) => void;
  setCameraView: (dir: ViewDirection) => void;
  stopMotion: () => void;
  buildSkeletalPreview: BuildSkeletalPreviewFn;
}

export function useBoneConfigPreview({
  refs,
  calculatedBones,
  markers,
  autoMirror,
  showBody,
  currentModel,
  equipParts,
  equipEnabled,
  equipVoxelCache,
  setEquipVoxelCache,
  setMode,
  setShowBonesOnly,
  setSaving,
  setDirty,
  setCameraView,
  stopMotion,
  buildSkeletalPreview,
}: PreviewHookParams) {
  const {
    sceneRef, canvasRef, bodyMeshRef, markerSpheresRef, jointSpheresRef,
    boneLineMeshesRef, centerLineMeshRef, previewNodesRef, previewMeshesRef,
    debugBonesRef, boneRestPosRef, voxelBodyHeightRef, voxelsRef, cameraRef, viewRef,
    centerRef,
  } = refs;

  const [equipLoading, setEquipLoading] = useState(false);

  // Load equipment voxels for enabled parts
  const loadEquipmentVoxels = useCallback(async (): Promise<VoxelEntry[]> => {
    const enabledKeys = Object.entries(equipEnabled).filter(([, v]) => v).map(([k]) => k);
    if (enabledKeys.length === 0) return [];

    const cache = { ...equipVoxelCache };
    const toLoad = enabledKeys.filter(k => !cache[k]);

    if (toLoad.length > 0) {
      setEquipLoading(true);
      const results = await Promise.all(
        toLoad.map(async key => {
          const part = equipParts.find(p => p.key === key);
          if (!part) return { key, voxels: [] as VoxelEntry[] };
          try {
            const { voxels } = await loadVoxFile(part.file);
            return { key, voxels };
          } catch {
            return { key, voxels: [] as VoxelEntry[] };
          }
        })
      );
      for (const r of results) cache[r.key] = r.voxels;
      setEquipVoxelCache(cache);
      setEquipLoading(false);
    }

    // Merge all enabled equipment voxels
    const allEquip: VoxelEntry[] = [];
    for (const key of enabledKeys) {
      if (cache[key]) allEquip.push(...cache[key]);
    }
    return allEquip;
  }, [equipEnabled, equipParts, equipVoxelCache, setEquipVoxelCache]);

  // Enter preview: hide edit visuals, build skeletal hierarchy, free camera
  const enterPreview = useCallback(async () => {
    const scene = sceneRef.current;
    const canvas = canvasRef.current;
    if (!scene || !canvas || Object.keys(calculatedBones).length === 0) return;
    const { cx, cy } = centerRef.current;

    // Hide edit visuals
    if (bodyMeshRef.current) bodyMeshRef.current.setEnabled(false);
    for (const m of markerSpheresRef.current.values()) m.setEnabled(false);
    for (const m of jointSpheresRef.current.values()) m.setEnabled(false);
    for (const m of boneLineMeshesRef.current) m.setEnabled(false);
    if (centerLineMeshRef.current) centerLineMeshRef.current.setEnabled(false);

    // Dispose old preview
    for (const m of previewMeshesRef.current.values()) m.dispose();
    for (const n of previewNodesRef.current.values()) n.dispose();
    previewMeshesRef.current.clear();
    previewNodesRef.current.clear();

    // Load equipment voxels and merge with body
    const equipVoxels = await loadEquipmentVoxels();
    const mergedVoxels = [...voxelsRef.current];
    if (equipVoxels.length > 0) {
      // Equipment voxels override body voxels at same position (clothing priority)
      const bodySet = new Set<string>();
      for (const v of mergedVoxels) bodySet.add(`${v.x},${v.y},${v.z}`);
      for (const v of equipVoxels) {
        const k = `${v.x},${v.y},${v.z}`;
        if (bodySet.has(k)) {
          // Replace body voxel with equipment voxel
          const idx = mergedVoxels.findIndex(bv => bv.x === v.x && bv.y === v.y && bv.z === v.z);
          if (idx >= 0) mergedVoxels[idx] = v;
        } else {
          mergedVoxels.push(v);
        }
      }
    }

    // Build hierarchical 20-bone skeleton with voxel meshes
    const { nodes, meshes } = buildSkeletalPreview(mergedVoxels, calculatedBones, scene, cx, cy);
    previewNodesRef.current = nodes;
    previewMeshesRef.current = meshes;

    // Store rest positions for all bones (for animation delta application)
    const restPosMap = new Map<string, Vector3>();
    for (const boneDef of BONE_DEFS) {
      const bp = calculatedBones[boneDef.name];
      if (bp) {
        restPosMap.set(boneDef.name, voxelToViewer(bp.x, bp.y, bp.z, cx, cy));
      }
    }
    boneRestPosRef.current = restPosMap;

    // Compute voxel body height (Hips→Head in viewer space) for FBX scale matching
    const hipsPos = calculatedBones['Hips'];
    const headPos = calculatedBones['Head'];
    if (hipsPos && headPos) {
      voxelBodyHeightRef.current = (headPos.z - hipsPos.z) * SCALE;
    }

    // Enable free camera rotation
    const camera = cameraRef.current;
    if (camera) {
      camera.inputs.addPointers();
      camera.attachControl(canvas, true);
    }

    setMode('preview');
  }, [calculatedBones, loadEquipmentVoxels, sceneRef, canvasRef, bodyMeshRef, markerSpheresRef,
      jointSpheresRef, boneLineMeshesRef, centerLineMeshRef, previewNodesRef, previewMeshesRef,
      boneRestPosRef, voxelBodyHeightRef, voxelsRef, cameraRef, centerRef, buildSkeletalPreview, setMode]);

  // Exit preview: restore edit visuals, dispose preview meshes, fixed camera
  const exitPreview = useCallback(() => {
    // Stop animation
    stopMotion();

    // Dispose preview meshes and debug bones
    for (const m of previewMeshesRef.current.values()) m.dispose();
    for (const n of previewNodesRef.current.values()) n.dispose();
    previewMeshesRef.current.clear();
    previewNodesRef.current.clear();
    for (const s of debugBonesRef.current.spheres) s.dispose();
    if (debugBonesRef.current.lines) debugBonesRef.current.lines.dispose();
    debugBonesRef.current = { spheres: [], lines: null };
    setShowBonesOnly(false);

    // Restore edit visuals
    if (bodyMeshRef.current) bodyMeshRef.current.setEnabled(showBody);
    for (const m of markerSpheresRef.current.values()) m.setEnabled(true);
    for (const m of jointSpheresRef.current.values()) m.setEnabled(true);
    for (const m of boneLineMeshesRef.current) m.setEnabled(true);
    if (centerLineMeshRef.current) centerLineMeshRef.current.setEnabled(true);

    // Restore fixed camera
    const camera = cameraRef.current;
    if (camera) {
      camera.detachControl();
      camera.inputs.clear();
      camera.inputs.addMouseWheel();
      setCameraView(viewRef.current);
    }

    setMode('edit');
  }, [showBody, setCameraView, stopMotion, previewMeshesRef, previewNodesRef, debugBonesRef,
      bodyMeshRef, markerSpheresRef, jointSpheresRef, boneLineMeshesRef, centerLineMeshRef,
      cameraRef, viewRef, setMode, setShowBonesOnly]);

  // Save from preview mode
  const handleConfirmSave = useCallback(async () => {
    setSaving(true);
    try {
      const resp = await fetch(`/api/bone-config?dir=${currentModel.dir}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markers, bones: calculatedBones, autoMirror }),
      });
      if (!resp.ok) throw new Error('Save failed');
      setDirty(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
    setSaving(false);
  }, [markers, calculatedBones, autoMirror, currentModel, setSaving, setDirty]);

  return {
    loadEquipmentVoxels,
    enterPreview,
    exitPreview,
    handleConfirmSave,
    equipLoading,
  };
}
