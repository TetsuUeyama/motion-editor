/**
 * Skinned GLB Export (glTF 2.0 Binary)
 */

import type { VoxelEntry, Vec3 } from '@/utils/voxelize/core';
import { BONE_DEFS, FACE_DIRS, FACE_VERTS, FACE_NORMALS, assignVoxelsToBones } from '@/utils/voxelize/core';
import { BODY_SIZE, VSCALE } from './constants';

export function exportSkinnedGLB(
  voxels: VoxelEntry[],
  bones: Record<string, Vec3>,
): Blob {
  const boneVoxels = assignVoxelsToBones(voxels, bones);

  const cx = (BODY_SIZE.x - 1) / 2;
  const cy = (BODY_SIZE.y - 1) / 2;

  // Ordered joint list from BONE_DEFS
  const activeBones = BONE_DEFS.filter(bd => bones[bd.name]);
  const jMap = new Map<string, number>();
  activeBones.forEach((bd, i) => jMap.set(bd.name, i));
  const numJoints = activeBones.length;

  // Occupancy for face culling
  const occSet = new Set<string>();
  for (const v of voxels) occSet.add(`${v.x},${v.y},${v.z}`);

  // Build combined mesh geometry
  const pos: number[] = [], nrm: number[] = [], col: number[] = [];
  const jnt: number[] = [], wgt: number[] = [], idx: number[] = [];
  const rendered = new Set<string>();

  for (const bd of activeBones) {
    const bvs = boneVoxels[bd.name] ?? [];
    const ji = jMap.get(bd.name)!;
    for (const vx of bvs) {
      const vk = `${vx.x},${vx.y},${vx.z}`;
      if (rendered.has(vk)) continue;
      rendered.add(vk);
      for (let f = 0; f < 6; f++) {
        const [dx, dy, dz] = FACE_DIRS[f];
        if (occSet.has(`${vx.x + dx},${vx.y + dy},${vx.z + dz}`)) continue;
        const bi = pos.length / 3;
        const fv = FACE_VERTS[f], fn = FACE_NORMALS[f];
        for (let vi = 0; vi < 4; vi++) {
          pos.push(
            (vx.x + fv[vi][0] - cx) * VSCALE,
            (vx.z + fv[vi][2]) * VSCALE,
            (vx.y + fv[vi][1] - cy) * VSCALE,
          );
          nrm.push(fn[0], fn[2], fn[1]);
          col.push(Math.round(vx.r * 255), Math.round(vx.g * 255), Math.round(vx.b * 255), 255);
          jnt.push(ji, 0, 0, 0);
          wgt.push(1, 0, 0, 0);
        }
        idx.push(bi, bi + 2, bi + 1, bi, bi + 3, bi + 2);
      }
    }
  }

  const vtxCount = pos.length / 3;
  const idxCount = idx.length;
  if (vtxCount === 0) return new Blob([], { type: 'model/gltf-binary' });

  // Binary buffer layout
  const posBytes = vtxCount * 12;
  const nrmBytes = vtxCount * 12;
  const colBytes = vtxCount * 4;
  const jntBytes = vtxCount * 4;
  const wgtBytes = vtxCount * 16;
  const idxBytes = idxCount * 4;
  const ibmBytes = numJoints * 64;

  const nrmOff = posBytes;
  const colOff = nrmOff + nrmBytes;
  const jntOff = colOff + colBytes;
  const wgtOff = jntOff + jntBytes;
  const idxOff = wgtOff + wgtBytes;
  const ibmOff = idxOff + idxBytes;
  const totalBuf = ibmOff + ibmBytes;

  const buf = new ArrayBuffer(totalBuf);
  const dv = new DataView(buf);

  for (let i = 0; i < pos.length; i++) dv.setFloat32(i * 4, pos[i], true);
  for (let i = 0; i < nrm.length; i++) dv.setFloat32(nrmOff + i * 4, nrm[i], true);
  for (let i = 0; i < col.length; i++) dv.setUint8(colOff + i, col[i]);
  for (let i = 0; i < jnt.length; i++) dv.setUint8(jntOff + i, jnt[i]);
  for (let i = 0; i < wgt.length; i++) dv.setFloat32(wgtOff + i * 4, wgt[i], true);
  for (let i = 0; i < idx.length; i++) dv.setUint32(idxOff + i * 4, idx[i], true);

  // Inverse bind matrices
  for (let j = 0; j < numJoints; j++) {
    const bp = bones[activeBones[j].name];
    const wx = (bp.x - cx) * VSCALE;
    const wy = bp.z * VSCALE;
    const wz = (bp.y - cy) * VSCALE;
    const o = ibmOff + j * 64;
    dv.setFloat32(o,      1, true); dv.setFloat32(o + 4,  0, true); dv.setFloat32(o + 8,  0, true); dv.setFloat32(o + 12, 0, true);
    dv.setFloat32(o + 16, 0, true); dv.setFloat32(o + 20, 1, true); dv.setFloat32(o + 24, 0, true); dv.setFloat32(o + 28, 0, true);
    dv.setFloat32(o + 32, 0, true); dv.setFloat32(o + 36, 0, true); dv.setFloat32(o + 40, 1, true); dv.setFloat32(o + 44, 0, true);
    dv.setFloat32(o + 48, -wx, true); dv.setFloat32(o + 52, -wy, true); dv.setFloat32(o + 56, -wz, true); dv.setFloat32(o + 60, 1, true);
  }

  // Position bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vtxCount; i++) {
    const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
    if (px < minX) minX = px; if (py < minY) minY = py; if (pz < minZ) minZ = pz;
    if (px > maxX) maxX = px; if (py > maxY) maxY = py; if (pz > maxZ) maxZ = pz;
  }

  // Build joint node hierarchy
  const rootJoints: number[] = [];
  const jointChildren: number[][] = Array.from({ length: numJoints }, () => []);

  for (let i = 0; i < activeBones.length; i++) {
    const bd = activeBones[i];
    if (bd.parent && jMap.has(bd.parent)) {
      jointChildren[jMap.get(bd.parent)!].push(i + 1);
    } else {
      rootJoints.push(i + 1);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodes: Record<string, any>[] = [];
  nodes.push({ name: 'VoxelCharacter', mesh: 0, skin: 0, children: rootJoints });

  for (let i = 0; i < activeBones.length; i++) {
    const bd = activeBones[i];
    const bp = bones[bd.name];
    const wx = (bp.x - cx) * VSCALE, wy = bp.z * VSCALE, wz = (bp.y - cy) * VSCALE;
    let tx = wx, ty = wy, tz = wz;
    if (bd.parent && jMap.has(bd.parent)) {
      const pp = bones[bd.parent];
      tx = wx - (pp.x - cx) * VSCALE;
      ty = wy - pp.z * VSCALE;
      tz = wz - (pp.y - cy) * VSCALE;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node: Record<string, any> = { name: bd.name, translation: [tx, ty, tz] };
    if (jointChildren[i].length > 0) node.children = jointChildren[i];
    nodes.push(node);
  }

  // glTF JSON
  const gltf = {
    asset: { version: '2.0', generator: 'motion-editor' },
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [0] }],
    nodes,
    meshes: [{
      name: 'VoxelMesh',
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2, JOINTS_0: 3, WEIGHTS_0: 4 },
        indices: 5,
      }],
    }],
    skins: [{
      name: 'Skeleton',
      inverseBindMatrices: 6,
      skeleton: rootJoints[0],
      joints: activeBones.map((_, i) => i + 1),
    }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vtxCount, type: 'VEC3', min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
      { bufferView: 1, componentType: 5126, count: vtxCount, type: 'VEC3' },
      { bufferView: 2, componentType: 5121, count: vtxCount, type: 'VEC4', normalized: true },
      { bufferView: 3, componentType: 5121, count: vtxCount, type: 'VEC4' },
      { bufferView: 4, componentType: 5126, count: vtxCount, type: 'VEC4' },
      { bufferView: 5, componentType: 5125, count: idxCount, type: 'SCALAR' },
      { bufferView: 6, componentType: 5126, count: numJoints, type: 'MAT4' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: nrmOff, byteLength: nrmBytes, target: 34962 },
      { buffer: 0, byteOffset: colOff, byteLength: colBytes, target: 34962 },
      { buffer: 0, byteOffset: jntOff, byteLength: jntBytes, target: 34962 },
      { buffer: 0, byteOffset: wgtOff, byteLength: wgtBytes, target: 34962 },
      { buffer: 0, byteOffset: idxOff, byteLength: idxBytes, target: 34963 },
      { buffer: 0, byteOffset: ibmOff, byteLength: ibmBytes },
    ],
    buffers: [{ byteLength: totalBuf }],
  };

  // Assemble GLB binary
  const jsonStr = JSON.stringify(gltf);
  const jsonEncoder = new TextEncoder();
  const jsonBuf = jsonEncoder.encode(jsonStr);
  const jsonPadded = jsonBuf.length + ((4 - jsonBuf.length % 4) % 4);
  const binPadded = totalBuf + ((4 - totalBuf % 4) % 4);
  const glbTotalLength = 12 + 8 + jsonPadded + 8 + binPadded;

  const glb = new ArrayBuffer(glbTotalLength);
  const glbView = new DataView(glb);
  const glbBytes = new Uint8Array(glb);

  let offset = 0;
  glbView.setUint32(offset, 0x46546C67, true); offset += 4;
  glbView.setUint32(offset, 2, true); offset += 4;
  glbView.setUint32(offset, glbTotalLength, true); offset += 4;
  glbView.setUint32(offset, jsonPadded, true); offset += 4;
  glbView.setUint32(offset, 0x4E4F534A, true); offset += 4;
  glbBytes.set(jsonBuf, offset);
  for (let i = jsonBuf.length; i < jsonPadded; i++) glbBytes[offset + i] = 0x20;
  offset += jsonPadded;
  glbView.setUint32(offset, binPadded, true); offset += 4;
  glbView.setUint32(offset, 0x004E4942, true); offset += 4;
  glbBytes.set(new Uint8Array(buf), offset);

  return new Blob([glb], { type: 'model/gltf-binary' });
}
