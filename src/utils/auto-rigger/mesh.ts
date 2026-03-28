/**
 * Flat voxel mesh builder (non-skeletal, for preview)
 */

import { Scene, Mesh, VertexData } from '@babylonjs/core';
import type { VoxelEntry } from '@/utils/voxel-core';
import { FACE_DIRS, FACE_VERTS, FACE_NORMALS, createUnlitMaterial } from '@/utils/voxel-core';
import { VSCALE } from './constants';

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
