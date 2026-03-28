/**
 * contactform-compatible segment exports
 */

import type { VoxelEntry, Vec3 } from '@/utils/voxel-core';
import { BONE_DEFS, assignVoxelsToBones } from '@/utils/voxel-core';
import type { SegmentBundleExport, SegmentsInfoExport } from './types';
import { BODY_SIZE, VSCALE } from './constants';

export function exportSegmentsBundle(
  voxels: VoxelEntry[],
  bones: Record<string, Vec3>,
): SegmentBundleExport {
  const boneVoxels = assignVoxelsToBones(voxels, bones);

  // Build global palette (shared across all bones)
  const colorMap = new Map<string, number>();
  const palette: number[][] = [];
  const colorKey = (r: number, g: number, b: number) =>
    `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}`;

  const getColorIndex = (r: number, g: number, b: number): number => {
    const k = colorKey(r, g, b);
    let ci = colorMap.get(k);
    if (ci === undefined) {
      ci = palette.length;
      colorMap.set(k, ci);
      palette.push([r, g, b]);
    }
    return ci;
  };

  // Build per-bone flat arrays
  const segments: Record<string, number[]> = {};
  for (const bd of BONE_DEFS) {
    const bvs = boneVoxels[bd.name];
    if (!bvs || bvs.length === 0) continue;
    const flat: number[] = [];
    const seen = new Set<string>();
    for (const v of bvs) {
      const k = `${v.x},${v.y},${v.z}`;
      if (seen.has(k)) continue;
      seen.add(k);
      flat.push(v.x, v.y, v.z, getColorIndex(v.r, v.g, v.b));
    }
    segments[bd.name] = flat;
  }

  return {
    grid: { gx: BODY_SIZE.x, gy: BODY_SIZE.y, gz: BODY_SIZE.z },
    palette,
    segments,
  };
}

export function exportSegmentsInfo(
  voxels: VoxelEntry[],
  bones: Record<string, Vec3>,
): SegmentsInfoExport {
  const boneVoxels = assignVoxelsToBones(voxels, bones);

  const activeBones = BONE_DEFS.filter(bd => bones[bd.name]);
  const childrenMap = new Map<string, string[]>();
  for (const bd of activeBones) childrenMap.set(bd.name, []);
  for (const bd of activeBones) {
    if (bd.parent && childrenMap.has(bd.parent)) {
      childrenMap.get(bd.parent)!.push(bd.name);
    }
  }

  const bone_positions: Record<string, { head_voxel: number[]; tail_voxel: number[] }> = {};
  const segments: Record<string, { file: string; voxels: number }> = {};

  for (const bd of activeBones) {
    const bp = bones[bd.name];
    const head = [Math.round(bp.x), Math.round(bp.y), Math.round(bp.z)];

    const ch = childrenMap.get(bd.name) ?? [];
    let tail: number[];
    if (ch.length > 0) {
      const cp = bones[ch[0]];
      tail = [Math.round(cp.x), Math.round(cp.y), Math.round(cp.z)];
    } else {
      if (bd.parent && bones[bd.parent]) {
        const pp = bones[bd.parent];
        const dx = bp.x - pp.x, dy = bp.y - pp.y, dz = bp.z - pp.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        tail = [Math.round(bp.x + dx / len * 3), Math.round(bp.y + dy / len * 3), Math.round(bp.z + dz / len * 3)];
      } else {
        tail = [head[0], head[1], head[2] + 3];
      }
    }

    bone_positions[bd.name] = { head_voxel: head, tail_voxel: tail };

    const bvs = boneVoxels[bd.name] ?? [];
    const uniqueCount = new Set(bvs.map(v => `${v.x},${v.y},${v.z}`)).size;
    segments[bd.name] = { file: `${bd.name}.vox`, voxels: uniqueCount };
  }

  return {
    voxel_size: VSCALE,
    grid: { gx: BODY_SIZE.x, gy: BODY_SIZE.y, gz: BODY_SIZE.z },
    bone_positions,
    segments,
  };
}
