/**
 * ビジュアル要素の再構築を管理するフック
 * マーカー球体、ボーン球体/線、中心線の描画を担当する
 *
 * + プレビューモード関連のロジックを管理するフック
 * 装備ボクセルの読み込み、プレビューの開始/終了、設定の保存を担当する
 */
import { useCallback, useState } from 'react';
import {
  Vector3, TransformNode, Mesh,
  MeshBuilder, StandardMaterial, Color3,
} from '@babylonjs/core';
import { BONE_DEFS, type Vec3, type MarkerData, voxelToViewer } from '@/utils/voxelize/skeleton';
import { loadVoxFile, SCALE } from '@/utils/voxelize/parser';
import type { VoxelEntry } from '@/utils/voxelize/parser';
import { MARKER_DEFS, type MarkerDef, type EquipPart, type ViewDirection } from '@/utils/bone-config/constants';
import type { BoneConfigRefs } from './useBoneConfigScene';

// ============================================================
// useBoneConfigVisuals
// ============================================================

interface VisualsHookParams {
  refs: BoneConfigRefs;
  markers: MarkerData;
  calculatedBones: Record<string, Vec3>;
  selectedMarker: string;
  showBones: boolean;
  autoMirror: boolean;
  getMirrorCenterX: () => number;
  getVisibleMarkers: () => MarkerDef[];
}

export function useBoneConfigVisuals({
  refs, markers, calculatedBones, selectedMarker, showBones, autoMirror,
  getMirrorCenterX, getVisibleMarkers,
}: VisualsHookParams) {
  const {
    sceneRef, centerRef,
    jointSpheresRef, markerSpheresRef, boneLineMeshesRef, centerLineMeshRef,
  } = refs;

  const rebuildVisuals = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const { cx, cy } = centerRef.current;

    // Clear old
    for (const m of jointSpheresRef.current.values()) m.dispose();
    jointSpheresRef.current.clear();
    for (const m of markerSpheresRef.current.values()) m.dispose();
    markerSpheresRef.current.clear();
    for (const m of boneLineMeshesRef.current) m.dispose();
    boneLineMeshesRef.current = [];
    if (centerLineMeshRef.current) { centerLineMeshRef.current.dispose(); centerLineMeshRef.current = null; }

    // Center line based on Chin/Groin
    const mcx = getMirrorCenterX();
    const clP1 = voxelToViewer(mcx, cy, 0, cx, cy);
    const clP2 = voxelToViewer(mcx, cy, centerRef.current.maxZ, cx, cy);
    const cl = MeshBuilder.CreateTube('centerLine', {
      path: [clP1, clP2], radius: 0.003, tessellation: 4, updatable: false,
    }, scene);
    const clMat = new StandardMaterial('clMat', scene);
    clMat.diffuseColor = new Color3(1, 1, 0);
    clMat.emissiveColor = new Color3(0.5, 0.5, 0);
    clMat.alpha = 0.3;
    clMat.disableLighting = true;
    cl.material = clMat;
    cl.isPickable = false;
    centerLineMeshRef.current = cl;

    // Marker spheres
    const visibleMarkers = getVisibleMarkers();
    for (const mDef of visibleMarkers) {
      const pos = markers[mDef.name];
      if (!pos) continue;

      const sphere = MeshBuilder.CreateSphere(`marker_${mDef.name}`, { diameter: 0.06 }, scene);
      sphere.position = voxelToViewer(pos.x, pos.y, pos.z, cx, cy);
      const mat = new StandardMaterial(`mmat_${mDef.name}`, scene);
      const c = Color3.FromHexString(mDef.color);
      mat.diffuseColor = c;
      mat.emissiveColor = mDef.name === selectedMarker ? c : c.scale(0.6);
      mat.disableLighting = true;
      sphere.material = mat;
      sphere.isPickable = true;
      sphere.metadata = { markerName: mDef.name };
      if (mDef.name === selectedMarker) {
        sphere.scaling = new Vector3(1.8, 1.8, 1.8);
      }
      markerSpheresRef.current.set(mDef.name, sphere);
    }

    // Ghost markers for auto-mirrored right side
    if (autoMirror) {
      for (const mDef of MARKER_DEFS.filter(m => m.side === 'right' && m.mirrorOf)) {
        const pos = markers[mDef.name];
        if (!pos) continue;
        const sphere = MeshBuilder.CreateSphere(`marker_${mDef.name}_ghost`, { diameter: 0.06 }, scene);
        sphere.position = voxelToViewer(pos.x, pos.y, pos.z, cx, cy);
        const mat = new StandardMaterial(`mmat_${mDef.name}_ghost`, scene);
        const c = Color3.FromHexString(mDef.color);
        mat.diffuseColor = c;
        mat.emissiveColor = c.scale(0.3);
        mat.alpha = 0.4;
        mat.disableLighting = true;
        sphere.material = mat;
        sphere.isPickable = false;
        markerSpheresRef.current.set(mDef.name + '_ghost', sphere);
      }
    }

    // Bone joints and lines
    if (showBones && Object.keys(calculatedBones).length > 0) {
      for (const bone of BONE_DEFS) {
        const pos = calculatedBones[bone.name];
        if (!pos) continue;
        const sphere = MeshBuilder.CreateSphere(`joint_${bone.name}`, { diameter: 0.03 }, scene);
        sphere.position = voxelToViewer(pos.x, pos.y, pos.z, cx, cy);
        const mat = new StandardMaterial(`jmat_${bone.name}`, scene);
        const c = Color3.FromHexString(bone.color);
        mat.diffuseColor = c;
        mat.emissiveColor = c.scale(0.4);
        mat.alpha = 0.7;
        mat.disableLighting = true;
        sphere.material = mat;
        sphere.isPickable = false;
        jointSpheresRef.current.set(bone.name, sphere);
      }

      for (const bone of BONE_DEFS) {
        if (!bone.parent) continue;
        const childPos = calculatedBones[bone.name];
        const parentPos = calculatedBones[bone.parent];
        if (!childPos || !parentPos) continue;
        const p1 = voxelToViewer(parentPos.x, parentPos.y, parentPos.z, cx, cy);
        const p2 = voxelToViewer(childPos.x, childPos.y, childPos.z, cx, cy);
        if (Vector3.Distance(p1, p2) < 0.001) continue;

        const line = MeshBuilder.CreateTube(`bone_${bone.name}`, {
          path: [p1, p2], radius: 0.005, tessellation: 6, updatable: false,
        }, scene);
        const mat = new StandardMaterial(`bmat_${bone.name}`, scene);
        const c = Color3.FromHexString(bone.color);
        mat.diffuseColor = c;
        mat.emissiveColor = c.scale(0.3);
        mat.alpha = 0.6;
        mat.disableLighting = true;
        line.material = mat;
        line.isPickable = false;
        boneLineMeshesRef.current.push(line);
      }
    }
  }, [markers, calculatedBones, selectedMarker, showBones, autoMirror, getMirrorCenterX, getVisibleMarkers]);

  return { rebuildVisuals };
}

// ============================================================
// useBoneConfigPreview
// ============================================================

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
  refs: BoneConfigRefs;
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
