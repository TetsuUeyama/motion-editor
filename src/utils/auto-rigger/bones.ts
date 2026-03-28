/**
 * Calculate target bones from world markers + deform params
 */

import type { Vec3 } from '@/utils/voxel-core';
import type { DeformParams } from './types';
import { BODY_SIZE } from './constants';
import { worldToVoxel, lerp3 } from './voxelize';

// ============================================================
// Vector helpers
// ============================================================
function normDir(to: Vec3, from: Vec3): Vec3 {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

function offsetV(base: Vec3, dir: Vec3, dist: number): Vec3 {
  return { x: base.x + dir.x * dist, y: base.y + dir.y * dist, z: base.z + dir.z * dist };
}

// ============================================================
// Calculate Target Bones (from world markers + deform params -> 41 bone positions)
// ============================================================
export function calculateTargetBones(
  worldMarkers: Record<string, { x: number; y: number; z: number }>,
  params: DeformParams,
): Record<string, Vec3> {
  function w2v(name: string): Vec3 {
    const m = worldMarkers[name];
    if (!m) return { x: BODY_SIZE.x / 2, y: BODY_SIZE.y / 2, z: BODY_SIZE.z / 2 };
    return worldToVoxel(m.x, m.y, m.z, params);
  }

  const chin = w2v('Chin');
  const groin = w2v('Groin');
  const lElbow = w2v('LeftElbow');
  const lWrist = w2v('LeftWrist');
  const rElbow = w2v('RightElbow');
  const rWrist = w2v('RightWrist');
  const lKnee = w2v('LeftKnee');
  const rKnee = w2v('RightKnee');

  const hips: Vec3 = { ...groin };
  const neck: Vec3 = { x: chin.x, y: chin.y, z: chin.z - 4 };
  const head: Vec3 = { x: chin.x, y: chin.y, z: Math.min(chin.z + 8, BODY_SIZE.z) };
  const spine = lerp3(hips, neck, 0.25);
  const spine1 = lerp3(hips, neck, 0.50);
  const spine2 = lerp3(hips, neck, 0.75);

  // Left arm
  const lSh: Vec3 = { x: spine2.x + (lElbow.x - spine2.x) * 0.15, y: spine2.y, z: spine2.z + 1 };
  const lArm: Vec3 = { x: spine2.x + (lElbow.x - spine2.x) * 0.4, y: spine2.y, z: spine2.z };
  const lFA: Vec3 = { ...lElbow };
  const lHand: Vec3 = { ...lWrist };
  const lFD = normDir(lHand, lFA);
  const lT1 = offsetV(lHand, lFD, 1), lT2 = offsetV(lT1, lFD, 0.8), lT3 = offsetV(lT2, lFD, 0.7), lT4 = offsetV(lT3, lFD, 0.5);
  const lI1 = offsetV(lHand, lFD, 1.5), lI2 = offsetV(lI1, lFD, 1), lI3 = offsetV(lI2, lFD, 0.8), lI4 = offsetV(lI3, lFD, 0.7);

  // Right arm
  const rSh: Vec3 = { x: spine2.x + (rElbow.x - spine2.x) * 0.15, y: spine2.y, z: spine2.z + 1 };
  const rArm: Vec3 = { x: spine2.x + (rElbow.x - spine2.x) * 0.4, y: spine2.y, z: spine2.z };
  const rFA: Vec3 = { ...rElbow };
  const rHand: Vec3 = { ...rWrist };
  const rFD = normDir(rHand, rFA);
  const rT1 = offsetV(rHand, rFD, 1), rT2 = offsetV(rT1, rFD, 0.8), rT3 = offsetV(rT2, rFD, 0.7), rT4 = offsetV(rT3, rFD, 0.5);
  const rI1 = offsetV(rHand, rFD, 1.5), rI2 = offsetV(rI1, rFD, 1), rI3 = offsetV(rI2, rFD, 0.8), rI4 = offsetV(rI3, rFD, 0.7);

  // Left leg
  const lUL: Vec3 = { x: hips.x + (lKnee.x - hips.x) * 0.8, y: hips.y, z: hips.z };
  const lLeg: Vec3 = { ...lKnee };
  const lFt: Vec3 = { x: lKnee.x, y: Math.max(lKnee.y - 4, 0), z: 2 };
  const lTB: Vec3 = { x: lFt.x, y: Math.max(lFt.y - 3, 0), z: 1 };
  const lTE: Vec3 = { x: lTB.x, y: Math.max(lTB.y - 2, 0), z: 0 };

  // Right leg
  const rUL: Vec3 = { x: hips.x + (rKnee.x - hips.x) * 0.8, y: hips.y, z: hips.z };
  const rLeg: Vec3 = { ...rKnee };
  const rFt: Vec3 = { x: rKnee.x, y: Math.max(rKnee.y - 4, 0), z: 2 };
  const rTB: Vec3 = { x: rFt.x, y: Math.max(rFt.y - 3, 0), z: 1 };
  const rTE: Vec3 = { x: rTB.x, y: Math.max(rTB.y - 2, 0), z: 0 };

  return {
    Hips: hips, Spine: spine, Spine1: spine1, Spine2: spine2, Neck: neck, Head: head,
    LeftShoulder: lSh, LeftArm: lArm, LeftForeArm: lFA, LeftHand: lHand,
    LeftHandThumb1: lT1, LeftHandThumb2: lT2, LeftHandThumb3: lT3, LeftHandThumb4: lT4,
    LeftHandIndex1: lI1, LeftHandIndex2: lI2, LeftHandIndex3: lI3, LeftHandIndex4: lI4,
    RightShoulder: rSh, RightArm: rArm, RightForeArm: rFA, RightHand: rHand,
    RightHandThumb1: rT1, RightHandThumb2: rT2, RightHandThumb3: rT3, RightHandThumb4: rT4,
    RightHandIndex1: rI1, RightHandIndex2: rI2, RightHandIndex3: rI3, RightHandIndex4: rI4,
    LeftUpLeg: lUL, LeftLeg: lLeg, LeftFoot: lFt, LeftToeBase: lTB, LeftToe_End: lTE,
    RightUpLeg: rUL, RightLeg: rLeg, RightFoot: rFt, RightToeBase: rTB, RightToe_End: rTE,
  };
}
