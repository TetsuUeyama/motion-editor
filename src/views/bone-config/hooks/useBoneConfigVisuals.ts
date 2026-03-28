/**
 * ビジュアル要素の再構築を管理するフック
 * マーカー球体、ボーン球体/線、中心線の描画を担当する
 */
import { useCallback } from 'react';
import {
  Vector3,
  MeshBuilder, StandardMaterial, Color3,
} from '@babylonjs/core';
import { BONE_DEFS, type MarkerData, voxelToViewer } from '@/utils/voxel-skeleton';
import type { Vec3 } from '@/utils/voxel-skeleton';
import { MARKER_DEFS, type MarkerDef } from '@/utils/bone-config/constants';
import type { useBoneConfigRefs } from './useBoneConfigRefs';

interface VisualsHookParams {
  refs: ReturnType<typeof useBoneConfigRefs>;
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
