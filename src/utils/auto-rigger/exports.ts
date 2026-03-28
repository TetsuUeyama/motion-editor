/**
 * Small export helpers: flat voxel mesh, VOX file, skeletal JSON, segment bundles
 */

import { Scene, Mesh, VertexData } from '@babylonjs/core';
import type { VoxelEntry, Vec3 } from '@/utils/voxelize/core';
import { BONE_DEFS, FACE_DIRS, FACE_VERTS, FACE_NORMALS, createUnlitMaterial, assignVoxelsToBones } from '@/utils/voxelize/core';
import type { SkeletalModelExport, SegmentBundleExport, SegmentsInfoExport } from './constants';
import { BODY_SIZE, VSCALE } from './constants';

// ============================================================
// Flat voxel mesh builder (non-skeletal, for preview)
// ============================================================

export function buildFlatVoxelMesh(
  voxels: VoxelEntry[], scene: Scene, name: string, cx: number, cy: number,
): Mesh {
  const occ = new Set<string>();
  for (const v of voxels) occ.add(`${v.x},${v.y},${v.z}`);
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], idx: number[] = [];
  for (const vx of voxels) {
    for (let f = 0; f < 6; f++) {
      const [ddx, ddy, ddz] = FACE_DIRS[f];
      if (occ.has(`${vx.x + ddx},${vx.y + ddy},${vx.z + ddz}`)) continue;
      const bi = pos.length / 3;
      const fv = FACE_VERTS[f], fn = FACE_NORMALS[f];
      for (let vi = 0; vi < 4; vi++) {
        pos.push((vx.x + fv[vi][0] - cx) * VSCALE, (vx.z + fv[vi][2]) * VSCALE, -(vx.y + fv[vi][1] - cy) * VSCALE);
        nrm.push(fn[0], fn[2], -fn[1]);
        col.push(vx.r, vx.g, vx.b, 1);
      }
      idx.push(bi, bi + 1, bi + 2, bi, bi + 2, bi + 3);
    }
  }
  const vd = new VertexData();
  vd.positions = pos; vd.normals = nrm; vd.colors = col; vd.indices = idx;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  mesh.material = createUnlitMaterial(scene, name + '_unlit');
  mesh.isPickable = false;
  return mesh;
}

// ============================================================
// VOX file export
// ============================================================

export function exportVoxBlob(voxels: VoxelEntry[], sizeX: number, sizeY: number, sizeZ: number): Blob {
  const cMap = new Map<string, number>();
  const pal: { r: number; g: number; b: number }[] = [];
  for (const v of voxels) {
    const k = `${Math.round(v.r * 255)},${Math.round(v.g * 255)},${Math.round(v.b * 255)}`;
    if (!cMap.has(k) && pal.length < 255) { cMap.set(k, pal.length + 1); pal.push({ r: v.r, g: v.g, b: v.b }); }
  }
  const vd = voxels.map(v => ({
    x: v.x, y: v.y, z: v.z,
    ci: cMap.get(`${Math.round(v.r * 255)},${Math.round(v.g * 255)},${Math.round(v.b * 255)}`) ?? 1,
  }));
  const szC = 12, xyC = 4 + vd.length * 4, rgC = 1024;
  const chSz = (12 + szC) + (12 + xyC) + (12 + rgC);
  const buf = new ArrayBuffer(8 + 12 + chSz);
  const dv = new DataView(buf);
  let o = 0;
  const ws = (s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o++, s.charCodeAt(i)); };
  const w32 = (val: number) => { dv.setUint32(o, val, true); o += 4; };
  const w8 = (val: number) => { dv.setUint8(o, val); o += 1; };
  ws('VOX '); w32(200);
  ws('MAIN'); w32(0); w32(chSz);
  ws('SIZE'); w32(szC); w32(0); w32(sizeX); w32(sizeY); w32(sizeZ);
  ws('XYZI'); w32(xyC); w32(0); w32(vd.length);
  for (const v of vd) { w8(v.x); w8(v.y); w8(v.z); w8(v.ci); }
  ws('RGBA'); w32(rgC); w32(0);
  for (let i = 0; i < 256; i++) {
    const c = pal[i] ?? { r: 0, g: 0, b: 0 };
    w8(Math.round(c.r * 255)); w8(Math.round(c.g * 255)); w8(Math.round(c.b * 255)); w8(255);
  }
  return new Blob([buf], { type: 'application/octet-stream' });
}

// ============================================================
// Skeletal model JSON export
// ============================================================

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

// ============================================================
// contactform-compatible segment exports
// ============================================================

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
