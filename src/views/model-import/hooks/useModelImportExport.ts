import { useCallback, type MutableRefObject } from 'react';
import { Vector3 } from '@babylonjs/core';
import {
  BODY_SIZE,
  calculateTargetBones,
  exportVoxBlob, exportSkeletalModelJSON, exportSkinnedGLB,
  exportSegmentsBundle, exportSegmentsInfo,
  type VoxelEntry, type DeformParams,
} from '@/utils/auto-rigger';

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
