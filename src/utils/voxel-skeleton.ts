/**
 * ボクセルスケルトンユーティリティ
 * bone-config（キャラクター作成）で使用する。
 *
 * 共通の型・定数・関数は voxel-core.ts からre-exportし、
 * このファイルにはbone-config固有のロジックのみ定義する:
 *   - マーカー→ボーン位置計算 (calculateAllBones)
 *   - マーカーミラー/デフォルト (mirrorMarker, getDefaultMarkers)
 *   - モーションクリップ読み込み (loadMotionClipFromFile)
 *   - ボーン階層深さ (getBoneDepth)
 */

// voxel-core.ts から全共通エクスポートをre-export
export {
  type VoxelEntry, type Vec3, type BoneDef, type BoneFrameData, type MotionClip,
  BONE_DEFS, FACE_DIRS, FACE_VERTS, FACE_NORMALS,
  voxelToViewer, threeQuatToViewer, distToSegSq,
  assignVoxelsToBones, addSphereCaps,
  createUnlitMaterial, buildSkeletalCharacter,
} from '@/utils/voxel-core';

// このファイル内でも使用するため直接import
import { type Vec3, type MotionClip, BONE_DEFS } from '@/utils/voxel-core';

// マーカー名→座標のマップ型
export type MarkerData = Record<string, Vec3>;

// ========================================================================
// マーカー操作
// ========================================================================

// 左側マーカーをX軸中心で反転し、右側マーカーを生成する
export function mirrorMarker(leftPos: Vec3, mirrorCenterX: number): Vec3 {
  return { x: mirrorCenterX + (mirrorCenterX - leftPos.x), y: leftPos.y, z: leftPos.z };
}

// デフォルトのマーカー位置を返す（初期配置用）
export function getDefaultMarkers(centerX: number): MarkerData {
  const left: MarkerData = {
    Chin:       { x: 42.5, y: 13, z: 82 },
    Groin:      { x: 41, y: 13, z: 47.5 },
    LeftWrist:  { x: 9, y: 13, z: 63.5 },
    LeftElbow:  { x: 23, y: 13, z: 70 },
    LeftKnee:   { x: 32.5, y: 15.5, z: 27.5 },
  };
  left['RightWrist'] = mirrorMarker(left['LeftWrist'], centerX);
  left['RightElbow'] = mirrorMarker(left['LeftElbow'], centerX);
  left['RightKnee']  = mirrorMarker(left['LeftKnee'], centerX);
  return left;
}

// ========================================================================
// マーカー→全41ボーン位置の自動計算
// ========================================================================
export function calculateAllBones(
  markers: MarkerData, bodyMaxZ: number,
): Record<string, Vec3> {
  const chin = markers['Chin'];
  const groin = markers['Groin'];
  const lWrist = markers['LeftWrist'];
  const lElbow = markers['LeftElbow'];
  const lKnee = markers['LeftKnee'];
  const rWrist = markers['RightWrist'];
  const rElbow = markers['RightElbow'];
  const rKnee = markers['RightKnee'];

  const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
    x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
  });

  const hips: Vec3 = { x: groin.x, y: groin.y, z: groin.z };
  const neck: Vec3 = { x: chin.x, y: chin.y, z: chin.z - 4 };
  const head: Vec3 = { x: chin.x, y: chin.y, z: Math.min(chin.z + 8, bodyMaxZ) };
  const spine  = lerp3(hips, neck, 0.25);
  const spine1 = lerp3(hips, neck, 0.50);
  const spine2 = lerp3(hips, neck, 0.75);

  // 左腕
  const lShoulderOffset = (lElbow.x - spine2.x) * 0.35;
  const lShoulder: Vec3 = { x: spine2.x + lShoulderOffset, y: spine2.y, z: spine2.z + 2 };
  const lArm = lerp3(lShoulder, lElbow, 0.3);
  const lForeArm: Vec3 = { ...lElbow };
  const lHand: Vec3 = { ...lWrist };
  const lFingerDir = { x: lHand.x - lForeArm.x, y: lHand.y - lForeArm.y, z: lHand.z - lForeArm.z };
  const lFingerLen = Math.sqrt(lFingerDir.x ** 2 + lFingerDir.y ** 2 + lFingerDir.z ** 2) || 1;
  const lFD = { x: lFingerDir.x / lFingerLen, y: lFingerDir.y / lFingerLen, z: lFingerDir.z / lFingerLen };
  const lThumb1: Vec3 = { x: lHand.x + lFD.x * 1, y: lHand.y + lFD.y * 1, z: lHand.z + lFD.z * 1 };
  const lThumb2: Vec3 = { x: lThumb1.x + lFD.x * 0.8, y: lThumb1.y + lFD.y * 0.8, z: lThumb1.z + lFD.z * 0.8 };
  const lThumb3: Vec3 = { x: lThumb2.x + lFD.x * 0.7, y: lThumb2.y + lFD.y * 0.7, z: lThumb2.z + lFD.z * 0.7 };
  const lThumb4: Vec3 = { x: lThumb3.x + lFD.x * 0.5, y: lThumb3.y + lFD.y * 0.5, z: lThumb3.z + lFD.z * 0.5 };
  const lIndex1: Vec3 = { x: lHand.x + lFD.x * 1.5, y: lHand.y + lFD.y * 1.5, z: lHand.z + lFD.z * 1.5 };
  const lIndex2: Vec3 = { x: lIndex1.x + lFD.x * 1, y: lIndex1.y + lFD.y * 1, z: lIndex1.z + lFD.z * 1 };
  const lIndex3: Vec3 = { x: lIndex2.x + lFD.x * 0.8, y: lIndex2.y + lFD.y * 0.8, z: lIndex2.z + lFD.z * 0.8 };
  const lIndex4: Vec3 = { x: lIndex3.x + lFD.x * 0.7, y: lIndex3.y + lFD.y * 0.7, z: lIndex3.z + lFD.z * 0.7 };

  // 右腕
  const rShoulderOffset = (rElbow.x - spine2.x) * 0.35;
  const rShoulder: Vec3 = { x: spine2.x + rShoulderOffset, y: spine2.y, z: spine2.z + 2 };
  const rArm = lerp3(rShoulder, rElbow, 0.3);
  const rForeArm: Vec3 = { ...rElbow };
  const rHand: Vec3 = { ...rWrist };
  const rFingerDir = { x: rHand.x - rForeArm.x, y: rHand.y - rForeArm.y, z: rHand.z - rForeArm.z };
  const rFingerLen = Math.sqrt(rFingerDir.x ** 2 + rFingerDir.y ** 2 + rFingerDir.z ** 2) || 1;
  const rFD = { x: rFingerDir.x / rFingerLen, y: rFingerDir.y / rFingerLen, z: rFingerDir.z / rFingerLen };
  const rThumb1: Vec3 = { x: rHand.x + rFD.x * 1, y: rHand.y + rFD.y * 1, z: rHand.z + rFD.z * 1 };
  const rThumb2: Vec3 = { x: rThumb1.x + rFD.x * 0.8, y: rThumb1.y + rFD.y * 0.8, z: rThumb1.z + rFD.z * 0.8 };
  const rThumb3: Vec3 = { x: rThumb2.x + rFD.x * 0.7, y: rThumb2.y + rFD.y * 0.7, z: rThumb2.z + rFD.z * 0.7 };
  const rThumb4: Vec3 = { x: rThumb3.x + rFD.x * 0.5, y: rThumb3.y + rFD.y * 0.5, z: rThumb3.z + rFD.z * 0.5 };
  const rIndex1: Vec3 = { x: rHand.x + rFD.x * 1.5, y: rHand.y + rFD.y * 1.5, z: rHand.z + rFD.z * 1.5 };
  const rIndex2: Vec3 = { x: rIndex1.x + rFD.x * 1, y: rIndex1.y + rFD.y * 1, z: rIndex1.z + rFD.z * 1 };
  const rIndex3: Vec3 = { x: rIndex2.x + rFD.x * 0.8, y: rIndex2.y + rFD.y * 0.8, z: rIndex2.z + rFD.z * 0.8 };
  const rIndex4: Vec3 = { x: rIndex3.x + rFD.x * 0.7, y: rIndex3.y + rFD.y * 0.7, z: rIndex3.z + rFD.z * 0.7 };

  // 左脚
  const lLegOffsetX = (lKnee.x - groin.x) * 0.8;
  const lUpLeg: Vec3 = { x: groin.x + lLegOffsetX, y: groin.y, z: groin.z };
  const lLeg: Vec3 = { ...lKnee };
  const lFoot: Vec3 = { x: lKnee.x, y: Math.max(lKnee.y - 4, 0), z: 2 };
  const lToeBase: Vec3 = { x: lFoot.x, y: Math.max(lFoot.y - 3, 0), z: 1 };
  const lToeEnd: Vec3 = { x: lToeBase.x, y: Math.max(lToeBase.y - 2, 0), z: 0 };

  // 右脚
  const rLegOffsetX = (rKnee.x - groin.x) * 0.8;
  const rUpLeg: Vec3 = { x: groin.x + rLegOffsetX, y: groin.y, z: groin.z };
  const rLeg: Vec3 = { ...rKnee };
  const rFoot: Vec3 = { x: rKnee.x, y: Math.max(rKnee.y - 4, 0), z: 2 };
  const rToeBase: Vec3 = { x: rFoot.x, y: Math.max(rFoot.y - 3, 0), z: 1 };
  const rToeEnd: Vec3 = { x: rToeBase.x, y: Math.max(rToeBase.y - 2, 0), z: 0 };

  return {
    Hips: hips, Spine: spine, Spine1: spine1, Spine2: spine2,
    Neck: neck, Head: head,
    LeftShoulder: lShoulder, LeftArm: lArm, LeftForeArm: lForeArm, LeftHand: lHand,
    LeftHandThumb1: lThumb1, LeftHandThumb2: lThumb2, LeftHandThumb3: lThumb3, LeftHandThumb4: lThumb4,
    LeftHandIndex1: lIndex1, LeftHandIndex2: lIndex2, LeftHandIndex3: lIndex3, LeftHandIndex4: lIndex4,
    RightShoulder: rShoulder, RightArm: rArm, RightForeArm: rForeArm, RightHand: rHand,
    RightHandThumb1: rThumb1, RightHandThumb2: rThumb2, RightHandThumb3: rThumb3, RightHandThumb4: rThumb4,
    RightHandIndex1: rIndex1, RightHandIndex2: rIndex2, RightHandIndex3: rIndex3, RightHandIndex4: rIndex4,
    LeftUpLeg: lUpLeg, LeftLeg: lLeg, LeftFoot: lFoot, LeftToeBase: lToeBase, LeftToe_End: lToeEnd,
    RightUpLeg: rUpLeg, RightLeg: rLeg, RightFoot: rFoot, RightToeBase: rToeBase, RightToe_End: rToeEnd,
  };
}

// ========================================================================
// モーションクリップ読み込み
// ========================================================================
export async function loadMotionClipFromFile(url: string, name: string, label: string): Promise<MotionClip> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load ${url}`);
  const data = await resp.json();
  return {
    name, label,
    duration: data.duration, fps: data.fps, frameCount: data.frameCount,
    fbxBodyHeight: data.fbxBodyHeight || 2.854,
    outputBones: data.outputBones || [],
    bindWorldPositions: data.bindWorldPositions,
    frames: data.frames,
  };
}

// ========================================================================
// ボーン階層深さ（UIインデント用）
// ========================================================================
export function getBoneDepth(boneName: string): number {
  let depth = 0;
  let current = BONE_DEFS.find(b => b.name === boneName);
  while (current?.parent) {
    depth++;
    current = BONE_DEFS.find(b => b.name === current!.parent);
  }
  return depth;
}
