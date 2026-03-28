/**
 * Skeletal model JSON export
 */

import type { VoxelEntry, Vec3 } from '@/utils/voxel-core';
import { BONE_DEFS, assignVoxelsToBones } from '@/utils/voxel-core';
import type { SkeletalModelExport } from './types';
import { BODY_SIZE, VSCALE } from './constants';

export function exportSkeletalModelJSON(
  voxels: VoxelEntry[],
  bones: Record<string, Vec3>,
): SkeletalModelExport {
  const boneVoxels = assignVoxelsToBones(voxels, bones);

  const boneList = BONE_DEFS
    .filter(bd => bones[bd.name])
    .map(bd => ({
      name: bd.name,
      label: bd.label,
      parent: bd.parent,
      position: bones[bd.name],
      voxels: (boneVoxels[bd.name] ?? []).map(v => ({
        x: v.x, y: v.y, z: v.z,
        r: Math.round(v.r * 255),
        g: Math.round(v.g * 255),
        b: Math.round(v.b * 255),
      })),
    }));

  return {
    gridSize: { ...BODY_SIZE },
    voxelScale: VSCALE,
    bones: boneList,
  };
}
