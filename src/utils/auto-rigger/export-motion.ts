/**
 * Motion clip -> contactform matrix format conversion
 */

import type { Vec3, BoneDef, MotionClip } from '@/utils/voxel-core';
import { BONE_DEFS } from '@/utils/voxel-core';
import type { ContactMotionExport } from './constants';
import { BODY_SIZE, VSCALE } from './constants';

/** Rotate a vector by a quaternion: v' = q * v * q_conj */
function quatRotateVec(qx: number, qy: number, qz: number, qw: number, vx: number, vy: number, vz: number): [number, number, number] {
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

/** Build 16-element skinning matrix (Babylon row-major) from world quaternion + world position + bind position */
function buildSkinMatrix(
  qx: number, qy: number, qz: number, qw: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number[] {
  const xx = qx * qx, yy = qy * qy, zz = qz * qz;
  const xy = qx * qy, xz = qx * qz, yz = qy * qz;
  const wx = qw * qx, wy = qw * qy, wz = qw * qz;
  const r0 = 1 - 2 * (yy + zz), r1 = 2 * (xy + wz), r2 = 2 * (xz - wy);
  const r4 = 2 * (xy - wz), r5 = 1 - 2 * (xx + zz), r6 = 2 * (yz + wx);
  const r8 = 2 * (xz + wy), r9 = 2 * (yz - wx), r10 = 1 - 2 * (xx + yy);
  const tx = -bx * r0 - by * r4 - bz * r8 + ax;
  const ty = -bx * r1 - by * r5 - bz * r9 + ay;
  const tz = -bx * r2 - by * r6 - bz * r10 + az;
  return [r0, r1, r2, 0, r4, r5, r6, 0, r8, r9, r10, 0, tx, ty, tz, 1];
}

export function convertMotionToContactFormat(
  clip: MotionClip,
  bones: Record<string, Vec3>,
): ContactMotionExport {
  const cx = BODY_SIZE.x / 2, cy = BODY_SIZE.y / 2;
  const bodyH = BODY_SIZE.z * VSCALE;
  const sf = clip.fbxBodyHeight > 0 ? bodyH / clip.fbxBodyHeight : 1;

  const restPos: Record<string, [number, number, number]> = {};
  const restLocalOffset: Record<string, [number, number, number]> = {};
  const activeBones = BONE_DEFS.filter(bd => bones[bd.name]);

  for (const bd of activeBones) {
    const bp = bones[bd.name];
    const vp: [number, number, number] = [(bp.x - cx) * VSCALE, bp.z * VSCALE, -(bp.y - cy) * VSCALE];
    restPos[bd.name] = vp;
    if (bd.parent && bones[bd.parent]) {
      const pp = bones[bd.parent];
      const pvp: [number, number, number] = [(pp.x - cx) * VSCALE, pp.z * VSCALE, -(pp.y - cy) * VSCALE];
      restLocalOffset[bd.name] = [vp[0] - pvp[0], vp[1] - pvp[1], vp[2] - pvp[2]];
    } else {
      restLocalOffset[bd.name] = [0, 0, 0];
    }
  }

  const ordered: BoneDef[] = [];
  const added = new Set<string>();
  const queue = activeBones.filter(bd => !bd.parent || !bones[bd.parent]);
  while (queue.length > 0) {
    const bd = queue.shift()!;
    if (added.has(bd.name)) continue;
    ordered.push(bd);
    added.add(bd.name);
    for (const child of activeBones) {
      if (child.parent === bd.name && !added.has(child.name)) queue.push(child);
    }
  }

  const boneMatrices: Record<string, number[][]> = {};
  for (const bd of activeBones) boneMatrices[bd.name] = [];

  for (let fi = 0; fi < clip.frameCount; fi++) {
    const frame = clip.frames[fi] ?? {};

    const worldQ: Record<string, [number, number, number, number]> = {};
    for (const bd of activeBones) {
      const d = frame[bd.name];
      if (d) {
        worldQ[bd.name] = [d.dq[0], -d.dq[1], -d.dq[2], d.dq[3]];
      } else {
        worldQ[bd.name] = [0, 0, 0, 1];
      }
    }

    const worldPos: Record<string, [number, number, number]> = {};
    for (const bd of ordered) {
      if (!bd.parent || !bones[bd.parent]) {
        const rp = restPos[bd.name];
        const hd = frame[bd.name];
        if (hd?.dp) {
          worldPos[bd.name] = [
            rp[0] + (-hd.dp[0]) * sf,
            rp[1] + hd.dp[1] * sf,
            rp[2] + hd.dp[2] * sf,
          ];
        } else {
          worldPos[bd.name] = [...rp];
        }
      } else {
        const parentName = bd.parent;
        const pp = worldPos[parentName];
        const pq = worldQ[parentName];
        const lo = restLocalOffset[bd.name];
        const rotated = quatRotateVec(pq[0], pq[1], pq[2], pq[3], lo[0], lo[1], lo[2]);
        worldPos[bd.name] = [pp[0] + rotated[0], pp[1] + rotated[1], pp[2] + rotated[2]];
      }
    }

    for (const bd of activeBones) {
      const q = worldQ[bd.name];
      const ap = worldPos[bd.name];
      const bp = restPos[bd.name];
      boneMatrices[bd.name].push(buildSkinMatrix(q[0], q[1], q[2], q[3], ap[0], ap[1], ap[2], bp[0], bp[1], bp[2]));
    }
  }

  const bonesOut: Record<string, { matrices: number[][] }> = {};
  for (const bd of activeBones) {
    bonesOut[bd.name] = { matrices: boneMatrices[bd.name] };
  }

  return {
    fps: clip.fps,
    frame_count: clip.frameCount,
    babylonFormat: true,
    bones: bonesOut,
  };
}
