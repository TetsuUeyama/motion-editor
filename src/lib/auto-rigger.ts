/**
 * auto-rigger.ts
 * 均一チビボクセル化 + Mixamo互換41ボーン生成
 * 任意の3Dモデル + 5つのMixamoスタイルマーカー → 固定サイズのチビボクセルボディ + スケルトン
 * 自己完結: voxel-skeleton.tsやvox-parser.tsからインポートしない
 *
 * 主要機能:
 *   - uniformChibiVoxelize(): 3Dモデルをボクセル化（ピースワイズ線形変形でチビプロポーションに）
 *   - calculateTargetBones(): マーカー位置からMixamo41ボーンを計算
 *   - assignVoxelsToBones(): 各ボクセルを最も近いボーンに割り当て
 *   - buildSkeletalCharacter(): ボーンごとのメッシュ+TransformNode階層を構築
 *   - exportSegmentsBundle(): contactform互換のボーン分離ボクセルデータをエクスポート
 *   - exportSegmentsInfo(): contactform互換のボーン位置・階層データをエクスポート
 *   - exportSkinnedGLB(): glTF 2.0 GLBフォーマットでスキンメッシュをエクスポート
 */

import {
  Scene, Mesh, AbstractMesh, VertexData, ShaderMaterial, Effect,
  TransformNode, Vector3, Quaternion,
} from '@babylonjs/core';

// ============================================================
// 型定義
// ============================================================
// ボクセル1個のデータ（座標 + RGB色、0-1正規化）
export interface VoxelEntry { x: number; y: number; z: number; r: number; g: number; b: number; }
// 3次元座標（ボクセル空間: X=右, Y=奥行き, Z=上）
export interface Vec3 { x: number; y: number; z: number; }
// ボーン1本の定義（名前、表示ラベル、親ボーン名、UI色）
export interface BoneDef { name: string; label: string; parent: string | null; color: string; }
// マーカーグループ（UI表示用: ラベル、含まれるマーカー名、色）
export interface MarkerGroup { label: string; names: string[]; color: string; }

// ============================================================
// パーツ分類
// 3Dモデルの各メッシュをカテゴリに分類する
// ============================================================
// パーツカテゴリ: body=ボディ, hair=髪, clothing=衣類, other=その他, exclude=除外
export type PartCategory = 'body' | 'hair' | 'clothing' | 'other' | 'exclude';

export const CATEGORY_INFO: Record<PartCategory, { label: string; labelJa: string; color: string }> = {
  body:     { label: 'Body',     labelJa: 'ボディ',       color: '#cc8866' },
  hair:     { label: 'Hair',     labelJa: '髪',           color: '#cc8833' },
  clothing: { label: 'Clothing', labelJa: '衣類・装飾品', color: '#4488cc' },
  other:    { label: 'Other',    labelJa: 'その他部品',   color: '#ccaa44' },
  exclude:  { label: 'Exclude',  labelJa: '除外',         color: '#555555' },
};

export const PART_CATEGORIES: PartCategory[] = ['body', 'hair', 'clothing', 'other', 'exclude'];

export function guessCategory(meshName: string): PartCategory {
  const n = meshName.toLowerCase();
  if (/body|skin|torso|nude|naked|flesh/.test(n)) return 'body';
  if (/hair|bangs|ponytail|braid|wig|fringe/.test(n)) return 'hair';
  if (/shoe|boot|foot_wear|feet_wear|pant|trouser|skirt|shirt|jacket|coat|vest|armor|dress|helmet|hat|glove|gauntlet|bra|corset|belt|cape|cloak|necklace|earring|ring_|buckle|crown|tiara|mask|visor|glasses|stocking|legging|sock/.test(n)) return 'clothing';
  if (/armature|skeleton|bone|rig|root|null|empty|camera|light|lamp/.test(n)) return 'exclude';
  return 'other';
}

/** Merge voxel layers: later layers override earlier at same position */
export function mergeVoxelLayers(...layers: VoxelEntry[][]): VoxelEntry[] {
  const map = new Map<string, VoxelEntry>();
  for (const layer of layers) {
    for (const v of layer) map.set(`${v.x},${v.y},${v.z}`, v);
  }
  return Array.from(map.values());
}
// 1フレーム中の1ボーンのアニメーションデータ
export interface BoneFrameData {
  dq: [number, number, number, number]; // デルタクォータニオン [x,y,z,w]（ワールド空間、Three.js座標系）
  dp?: [number, number, number];        // デルタポジション [x,y,z]（Hipsのみ使用）
}
// モーションクリップ全体のデータ
export interface MotionClip {
  name: string; label: string; duration: number; fps: number; frameCount: number;
  fbxBodyHeight: number; // FBXのHips→Head距離（スケーリング計算用）
  outputBones: string[];
  bindWorldPositions?: Record<string, [number, number, number]>;
  frames: Record<string, BoneFrameData>[]; // フレーム配列（各フレームはボーン名→データのマップ）
}

// ============================================================
// 定数
// ============================================================
// チビボクセルボディのグリッドサイズ（X=横幅85, Y=奥行き34, Z=高さ102）
export const BODY_SIZE = { x: 85, y: 34, z: 102 };
// ボクセル1個のワールド座標スケール（85*0.01=0.85ユニット幅のキャラクター）
export const VSCALE = 0.01;

export const FACE_DIRS: number[][] = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
export const FACE_VERTS: number[][][] = [
  [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], [[0,0,1],[0,1,1],[0,1,0],[0,0,0]],
  [[0,1,0],[0,1,1],[1,1,1],[1,1,0]], [[0,0,1],[0,0,0],[1,0,0],[1,0,1]],
  [[0,0,1],[0,1,1],[1,1,1],[1,0,1]], [[1,0,0],[1,1,0],[0,1,0],[0,0,0]],
];
export const FACE_NORMALS: number[][] = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

// ============================================================
// Target Chibi Marker Positions (voxel space: X=right, Y=depth, Z=up)
// ============================================================
// 5-head-tall proportions: head=20%, torso=30%, legs=50%
export const TARGET_MARKERS: Record<string, Vec3> = {
  Chin:       { x: 42.5, y: 17, z: 81 },
  Groin:      { x: 42.5, y: 17, z: 51 },
  LeftWrist:  { x: 14,   y: 17, z: 50 },
  LeftElbow:  { x: 22,   y: 17, z: 60 },
  LeftKnee:   { x: 34,   y: 17, z: 25 },
  RightWrist: { x: 71,   y: 17, z: 50 },
  RightElbow: { x: 63,   y: 17, z: 60 },
  RightKnee:  { x: 51,   y: 17, z: 25 },
};

export const MARKER_GROUPS: MarkerGroup[] = [
  { label: 'CHIN',    names: ['Chin'],                     color: '#00bcd4' },
  { label: 'WRISTS',  names: ['LeftWrist', 'RightWrist'],  color: '#cddc39' },
  { label: 'ELBOWS',  names: ['LeftElbow', 'RightElbow'],  color: '#ff9800' },
  { label: 'KNEES',   names: ['LeftKnee', 'RightKnee'],    color: '#ff5722' },
  { label: 'GROIN',   names: ['Groin'],                     color: '#e91e63' },
];

export const ALL_MARKER_NAMES = ['Chin', 'LeftWrist', 'RightWrist', 'LeftElbow', 'RightElbow', 'LeftKnee', 'RightKnee', 'Groin'];

export function getMarkerColor(name: string): string {
  return MARKER_GROUPS.find(g => g.names.includes(name))?.color ?? '#fff';
}

// Which markers get auto-mirrored (right from left)
export const MIRROR_PAIRS: Record<string, string> = {
  RightWrist: 'LeftWrist', RightElbow: 'LeftElbow', RightKnee: 'LeftKnee',
};

// ============================================================
// Bone Definitions (41 Mixamo standard)
// ============================================================
export const BONE_DEFS: BoneDef[] = [
  { name: 'Hips',           label: 'Hips',       parent: null,             color: '#ff4444' },
  { name: 'Spine',          label: 'Spine',      parent: 'Hips',           color: '#ff6644' },
  { name: 'Spine1',         label: 'Spine1',     parent: 'Spine',          color: '#ff8844' },
  { name: 'Spine2',         label: 'Spine2',     parent: 'Spine1',         color: '#ffaa44' },
  { name: 'Neck',           label: 'Neck',       parent: 'Spine2',         color: '#ffcc44' },
  { name: 'Head',           label: 'Head',       parent: 'Neck',           color: '#ffee44' },
  { name: 'LeftShoulder',   label: 'L.Shoulder', parent: 'Spine2',         color: '#44aaff' },
  { name: 'LeftArm',        label: 'L.Arm',      parent: 'LeftShoulder',   color: '#4488ff' },
  { name: 'LeftForeArm',    label: 'L.ForeArm',  parent: 'LeftArm',        color: '#4466ff' },
  { name: 'LeftHand',       label: 'L.Hand',     parent: 'LeftForeArm',    color: '#4444ff' },
  { name: 'LeftHandThumb1', label: 'L.Thumb1',   parent: 'LeftHand',       color: '#5555ff' },
  { name: 'LeftHandThumb2', label: 'L.Thumb2',   parent: 'LeftHandThumb1', color: '#5555ee' },
  { name: 'LeftHandThumb3', label: 'L.Thumb3',   parent: 'LeftHandThumb2', color: '#5555dd' },
  { name: 'LeftHandThumb4', label: 'L.Thumb4',   parent: 'LeftHandThumb3', color: '#5555cc' },
  { name: 'LeftHandIndex1', label: 'L.Index1',   parent: 'LeftHand',       color: '#6666ff' },
  { name: 'LeftHandIndex2', label: 'L.Index2',   parent: 'LeftHandIndex1', color: '#6666ee' },
  { name: 'LeftHandIndex3', label: 'L.Index3',   parent: 'LeftHandIndex2', color: '#6666dd' },
  { name: 'LeftHandIndex4', label: 'L.Index4',   parent: 'LeftHandIndex3', color: '#6666cc' },
  { name: 'RightShoulder',  label: 'R.Shoulder', parent: 'Spine2',         color: '#ff44aa' },
  { name: 'RightArm',       label: 'R.Arm',      parent: 'RightShoulder',  color: '#ff4488' },
  { name: 'RightForeArm',   label: 'R.ForeArm',  parent: 'RightArm',       color: '#ff4466' },
  { name: 'RightHand',      label: 'R.Hand',     parent: 'RightForeArm',   color: '#ff4444' },
  { name: 'RightHandThumb1',label: 'R.Thumb1',   parent: 'RightHand',      color: '#ff5555' },
  { name: 'RightHandThumb2',label: 'R.Thumb2',   parent: 'RightHandThumb1',color: '#ee5555' },
  { name: 'RightHandThumb3',label: 'R.Thumb3',   parent: 'RightHandThumb2',color: '#dd5555' },
  { name: 'RightHandThumb4',label: 'R.Thumb4',   parent: 'RightHandThumb3',color: '#cc5555' },
  { name: 'RightHandIndex1',label: 'R.Index1',   parent: 'RightHand',      color: '#ff6666' },
  { name: 'RightHandIndex2',label: 'R.Index2',   parent: 'RightHandIndex1',color: '#ee6666' },
  { name: 'RightHandIndex3',label: 'R.Index3',   parent: 'RightHandIndex2',color: '#dd6666' },
  { name: 'RightHandIndex4',label: 'R.Index4',   parent: 'RightHandIndex3',color: '#cc6666' },
  { name: 'LeftUpLeg',      label: 'L.UpLeg',    parent: 'Hips',           color: '#44ff88' },
  { name: 'LeftLeg',        label: 'L.Leg',      parent: 'LeftUpLeg',      color: '#44ff66' },
  { name: 'LeftFoot',       label: 'L.Foot',     parent: 'LeftLeg',        color: '#44ff44' },
  { name: 'LeftToeBase',    label: 'L.ToeBase',  parent: 'LeftFoot',       color: '#44ee44' },
  { name: 'LeftToe_End',    label: 'L.ToeEnd',   parent: 'LeftToeBase',    color: '#44dd44' },
  { name: 'RightUpLeg',     label: 'R.UpLeg',    parent: 'Hips',           color: '#aaff44' },
  { name: 'RightLeg',       label: 'R.Leg',      parent: 'RightUpLeg',     color: '#88ff44' },
  { name: 'RightFoot',      label: 'R.Foot',     parent: 'RightLeg',       color: '#66ff44' },
  { name: 'RightToeBase',   label: 'R.ToeBase',  parent: 'RightFoot',      color: '#55ee44' },
  { name: 'RightToe_End',   label: 'R.ToeEnd',   parent: 'RightToeBase',   color: '#55dd44' },
];

// ============================================================
// ベクトル演算ヘルパー
// ============================================================
// from→toの正規化方向ベクトルを返す
function normDir(to: Vec3, from: Vec3): Vec3 {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

function offsetV(base: Vec3, dir: Vec3, dist: number): Vec3 {
  return { x: base.x + dir.x * dist, y: base.y + dir.y * dist, z: base.z + dir.z * dist };
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function piecewiseLinear(val: number, srcKeys: number[], tgtKeys: number[]): number {
  if (val <= srcKeys[0]) return tgtKeys[0];
  for (let i = 1; i < srcKeys.length; i++) {
    if (val <= srcKeys[i]) {
      const denom = srcKeys[i] - srcKeys[i - 1];
      const t = denom > 0.0001 ? (val - srcKeys[i - 1]) / denom : 0;
      return tgtKeys[i - 1] + t * (tgtKeys[i] - tgtKeys[i - 1]);
    }
  }
  return tgtKeys[tgtKeys.length - 1];
}

// ============================================================
// 変形パラメータ（ボクセル化とボーン位置計算で共有）
// ワールド空間→ボクセル空間の変換に使用するピースワイズ線形パラメータ
// ============================================================
export interface DeformParams {
  srcH: number[]; tgtH: number[];
  srcWD: number[]; tgtWD: number[];
  baseScale: number; centerX: number; centerZ: number;
  footY: number; bH: number;
}

/** ワールド空間の点(wx, wy, wz)をボディ変形パラメータで
 *  ボクセル空間(vx, vy, vz)に変換する */
export function worldToVoxel(wx: number, wy: number, wz: number, p: DeformParams): Vec3 {
  const normH = (wy - p.footY) / p.bH;
  const vz = piecewiseLinear(normH, p.srcH, p.tgtH);
  const zoneMul = piecewiseLinear(normH, p.srcWD, p.tgtWD);
  const vx = (BODY_SIZE.x - 1) / 2 + (wx - p.centerX) * p.baseScale * zoneMul;
  const vy = (BODY_SIZE.y - 1) / 2 - (wz - p.centerZ) * p.baseScale * zoneMul;
  return { x: vx, y: vy, z: vz };
}

// ============================================================
// Calculate Target Bones (from world markers + deform params → 41 bone positions)
// Bones are placed in the same voxel coordinate system as the voxelized output.
// ============================================================
export function calculateTargetBones(
  worldMarkers: Record<string, { x: number; y: number; z: number }>,
  params: DeformParams,
): Record<string, Vec3> {
  // Convert world markers to voxel space using the same deformation as voxelization
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

  // Left arm — shoulder at spine2 level, interpolated toward elbow
  const lSh: Vec3 = { x: spine2.x + (lElbow.x - spine2.x) * 0.15, y: spine2.y, z: spine2.z + 1 };
  const lArm: Vec3 = { x: spine2.x + (lElbow.x - spine2.x) * 0.4, y: spine2.y, z: spine2.z };
  const lFA: Vec3 = { ...lElbow };
  const lHand: Vec3 = { ...lWrist };
  const lFD = normDir(lHand, lFA);
  const lT1 = offsetV(lHand, lFD, 1), lT2 = offsetV(lT1, lFD, 0.8), lT3 = offsetV(lT2, lFD, 0.7), lT4 = offsetV(lT3, lFD, 0.5);
  const lI1 = offsetV(lHand, lFD, 1.5), lI2 = offsetV(lI1, lFD, 1), lI3 = offsetV(lI2, lFD, 0.8), lI4 = offsetV(lI3, lFD, 0.7);

  // Right arm — mirror of left
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

// ============================================================
// Coordinate Conversion
// ============================================================
export function voxelToViewer(vx: number, vy: number, vz: number, cx: number, cy: number): Vector3 {
  return new Vector3((vx - cx) * VSCALE, vz * VSCALE, -(vy - cy) * VSCALE);
}

// ============================================================
// Uniform Chibi Voxelization (from scratch)
//
// Input:  world-space meshes, Mixamo markers, model bounding box
// Output: fixed-size (85×34×102) chibi voxel body
//
// Algorithm:
//   1. Normalize every world point to [0,1]³ relative to model bbox
//   2. Height axis: piecewise-linear remap via marker ratios
//      (foot=0, knee, groin, chin, top=1) → (0, 25, 47, 82, 100)
//   3. Width/depth: proportional fill of grid with chibi scale
//      (head ×1.4, torso ×1.0, legs ×0.95)
//   4. Color: texture UV sample → vertex color → material color → gray
//   5. Rasterization step adapts to model size for consistent density
// ============================================================
export async function uniformChibiVoxelize(
  meshes: AbstractMesh[],
  worldMarkers: Record<string, Vector3>,
  modelBounds: { min: Vector3; max: Vector3 },
): Promise<{ voxels: VoxelEntry[]; deformParams: DeformParams }> {

  // ---- Model bounding box ----
  const bMin = modelBounds.min;
  const bMax = modelBounds.max;
  const bW = Math.max(bMax.x - bMin.x, 1e-6);
  const bH = Math.max(bMax.y - bMin.y, 1e-6);
  const bD = Math.max(bMax.z - bMin.z, 1e-6);

  // ---- Chibi deformation via markers ----
  const footY = bMin.y;
  const kneeY = ((worldMarkers['LeftKnee']?.y ?? 0) + (worldMarkers['RightKnee']?.y ?? 0)) / 2
    || (footY + bH * 0.25);
  const groinY = worldMarkers['Groin']?.y ?? (footY + bH * 0.45);
  const chinY = worldMarkers['Chin']?.y ?? (footY + bH * 0.80);

  // Body height remap: model ratios → 5-head-tall voxel Z
  const srcH = [0, (kneeY - footY) / bH, (groinY - footY) / bH, (chinY - footY) / bH, 1];
  const tgtH = [0, 25, 51, 81, BODY_SIZE.z - 1];

  // Width/depth zone multiplier (piecewise by height)
  // Match Blender deform_point: legs=1.1, torso=1.1, head=1.5→1.8
  const srcWD = [...srcH];
  const tgtWD = [1.1, 1.1, 1.1, 1.1, 1.8];

  // Model center (X, Z)
  const centerX = (bMin.x + bMax.x) / 2;
  const centerZ = (bMin.z + bMax.z) / 2;

  // Base scale from height axis
  const baseScale = (BODY_SIZE.z - 1) / bH;

  console.log(`[Voxelize] meshes=${meshes.length} bbox=${bW.toFixed(3)}×${bH.toFixed(3)}×${bD.toFixed(3)} baseScale=${baseScale.toFixed(2)} srcH=[${srcH.map(v=>v.toFixed(2)).join(',')}]`);

  // ---- Rasterization step ----
  const sampleStep = (1 / baseScale) * 0.5;

  const voxelSet = new Map<string, VoxelEntry>();

  for (const mesh of meshes) {
    if (!(mesh instanceof Mesh)) continue;
    const positions = mesh.getVerticesData('position');
    const indices   = mesh.getIndices();
    const uvs       = mesh.getVerticesData('uv');
    const vcolors   = mesh.getVerticesData('color');
    if (!positions || !indices) {
      console.log(`[Voxelize] SKIP mesh="${mesh.name}" positions=${!!positions} indices=${!!indices}`);
      continue;
    }
    console.log(`[Voxelize] mesh="${mesh.name}" verts=${positions.length / 3} tris=${indices.length / 3} hasUV=${!!uvs} hasVC=${!!vcolors}`);

    const wm  = mesh.getWorldMatrix();

    // ---- Build material segments (handles MultiMaterial / SubMesh) ----
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meshMat = mesh.material as any;
    interface MatSeg { mat: any; idxStart: number; idxEnd: number; }
    const segments: MatSeg[] = [];
    if (mesh.subMeshes && mesh.subMeshes.length > 1 && meshMat?.subMaterials) {
      for (const sm of mesh.subMeshes) {
        segments.push({
          mat: meshMat.subMaterials[sm.materialIndex] ?? null,
          idxStart: sm.indexStart,
          idxEnd: sm.indexStart + sm.indexCount,
        });
      }
    } else {
      segments.push({ mat: meshMat, idxStart: 0, idxEnd: indices.length });
    }

    for (const seg of segments) {
      // ---- Read texture pixels for this segment's material ----
      let texPx: Uint8Array | null = null;
      let texW = 0, texH = 0;
      let tintR = 1, tintG = 1, tintB = 1;
      let flatR = 0.6, flatG = 0.6, flatB = 0.6;

      if (seg.mat) {
        // Material color factor (used as tint with texture, flat color without)
        const mc = seg.mat.albedoColor ?? seg.mat.diffuseColor;
        if (mc && typeof mc.r === 'number') {
          tintR = mc.r; tintG = mc.g; tintB = mc.b;
          flatR = mc.r; flatG = mc.g; flatB = mc.b;
        }

        if (uvs) {
          const tex = seg.mat.albedoTexture ?? seg.mat.diffuseTexture
                   ?? seg.mat._albedoTexture ?? seg.mat._diffuseTexture;
          if (tex) {
            // GPU readPixels
            try {
              if (tex.isReady?.()) {
                const sz = tex.getSize();
                texW = sz.width; texH = sz.height;
                if (texW > 0 && texH > 0) {
                  const raw = await tex.readPixels();
                  if (raw) {
                    texPx = raw instanceof Float32Array
                      ? uint8FromFloat(raw)
                      : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
                  }
                }
              }
            } catch { /* ignore */ }
            // Canvas fallback
            if (!texPx) {
              try {
                const url: string | undefined = tex.url ?? tex._texture?.url;
                if (url) {
                  const img = new Image(); img.crossOrigin = 'anonymous';
                  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); img.src = url; });
                  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
                  const ctx = c.getContext('2d');
                  if (ctx) { ctx.drawImage(img, 0, 0); const id = ctx.getImageData(0, 0, c.width, c.height); texPx = new Uint8Array(id.data.buffer); texW = c.width; texH = c.height; }
                }
              } catch { /* ignore */ }
            }
          }
        }
      }

      // ---- Rasterize triangles in this segment ----
      for (let ti = seg.idxStart; ti < seg.idxEnd; ti += 3) {
        // World-space vertices
        const p0 = xformVert(positions, indices[ti],     wm);
        const p1 = xformVert(positions, indices[ti + 1], wm);
        const p2 = xformVert(positions, indices[ti + 2], wm);

        // UV coords (if available)
        const hasUV = uvs && texPx;
        const uv0 = uvs ? [uvs[indices[ti]     * 2], uvs[indices[ti]     * 2 + 1]] : [0, 0];
        const uv1 = uvs ? [uvs[indices[ti + 1] * 2], uvs[indices[ti + 1] * 2 + 1]] : [0, 0];
        const uv2 = uvs ? [uvs[indices[ti + 2] * 2], uvs[indices[ti + 2] * 2 + 1]] : [0, 0];

        // Vertex colors (if available)
        const hasVC = !!vcolors;
        const vc0 = vcolors ? [vcolors[indices[ti]     * 4], vcolors[indices[ti]     * 4 + 1], vcolors[indices[ti]     * 4 + 2]] : [0, 0, 0];
        const vc1 = vcolors ? [vcolors[indices[ti + 1] * 4], vcolors[indices[ti + 1] * 4 + 1], vcolors[indices[ti + 1] * 4 + 2]] : [0, 0, 0];
        const vc2 = vcolors ? [vcolors[indices[ti + 2] * 4], vcolors[indices[ti + 2] * 4 + 1], vcolors[indices[ti + 2] * 4 + 2]] : [0, 0, 0];

        // Adaptive step count
        const e0 = Math.sqrt((p1[0]-p0[0])**2 + (p1[1]-p0[1])**2 + (p1[2]-p0[2])**2);
        const e1 = Math.sqrt((p2[0]-p1[0])**2 + (p2[1]-p1[1])**2 + (p2[2]-p1[2])**2);
        const e2 = Math.sqrt((p0[0]-p2[0])**2 + (p0[1]-p2[1])**2 + (p0[2]-p2[2])**2);
        const steps = Math.max(1, Math.ceil(Math.max(e0, e1, e2) / sampleStep));

        for (let si = 0; si <= steps; si++) {
          for (let sj = 0; sj <= steps - si; sj++) {
            const a = si / steps, b = sj / steps, c = 1 - a - b;

            // Interpolated world position
            const wx = p0[0] * c + p1[0] * a + p2[0] * b;
            const wy = p0[1] * c + p1[1] * a + p2[1] * b;  // height
            const wz = p0[2] * c + p1[2] * a + p2[2] * b;  // depth

            // ---- Color ----
            let cr: number, cg: number, cb: number;
            if (hasUV && texPx) {
              const su = uv0[0] * c + uv1[0] * a + uv2[0] * b;
              const sv = uv0[1] * c + uv1[1] * a + uv2[1] * b;
              const tu = ((su % 1) + 1) % 1;
              const tv = ((sv % 1) + 1) % 1;
              const px = Math.min(Math.floor(tu * texW), texW - 1);
              const py = Math.min(Math.floor((1 - tv) * texH), texH - 1);
              const pi = (py * texW + px) * 4;
              // Texture color × material tint (PBR albedoColor)
              cr = ((texPx[pi]     ?? 128) / 255) * tintR;
              cg = ((texPx[pi + 1] ?? 128) / 255) * tintG;
              cb = ((texPx[pi + 2] ?? 128) / 255) * tintB;
            } else if (hasVC) {
              cr = vc0[0] * c + vc1[0] * a + vc2[0] * b;
              cg = vc0[1] * c + vc1[1] * a + vc2[1] * b;
              cb = vc0[2] * c + vc1[2] * a + vc2[2] * b;
            } else {
              cr = flatR; cg = flatG; cb = flatB;
            }

            // ---- Map world position to chibi voxel grid ----
            // Uniform body deformation for all points (body + arms)
            // Same approach as Blender voxelizer: height remap + width/depth scale
            const normH = (wy - footY) / bH;
            const vz = piecewiseLinear(normH, srcH, tgtH);
            const zoneMul = piecewiseLinear(normH, srcWD, tgtWD);
            const vx = (BODY_SIZE.x - 1) / 2 + (wx - centerX) * baseScale * zoneMul;
            const vy = (BODY_SIZE.y - 1) / 2 - (wz - centerZ) * baseScale * zoneMul;

            // ---- Quantize + bounds check ----
            const ix = Math.round(vx), iy = Math.round(vy), iz = Math.round(vz);
            if (ix < 0 || iy < 0 || iz < 0 || ix >= BODY_SIZE.x || iy >= BODY_SIZE.y || iz >= BODY_SIZE.z) continue;

            const key = `${ix},${iy},${iz}`;
            if (!voxelSet.has(key)) {
              voxelSet.set(key, { x: ix, y: iy, z: iz,
                r: clamp01(cr), g: clamp01(cg), b: clamp01(cb) });
            }
          }
        }
      }
    } // end segment loop
  }

  const deformParams: DeformParams = { srcH, tgtH, srcWD, tgtWD, baseScale, centerX, centerZ, footY, bH };
  return { voxels: Array.from(voxelSet.values()), deformParams };
}

// ---- helpers used only by voxelization ----
function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

function uint8FromFloat(f: Float32Array): Uint8Array {
  const out = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) out[i] = Math.round(clamp01(f[i]) * 255);
  return out;
}

/** Transform a vertex by world matrix, return [x,y,z] */
function xformVert(pos: FloatArray, idx: number, wm: import('@babylonjs/core').Matrix): [number, number, number] {
  const v = Vector3.TransformCoordinates(
    new Vector3(pos[idx * 3], pos[idx * 3 + 1], pos[idx * 3 + 2]), wm);
  return [v.x, v.y, v.z];
}

type FloatArray = { readonly length: number; readonly [n: number]: number };

// ============================================================
// Voxel-to-Bone Assignment
// ============================================================
function distToSegSq(px: number, py: number, pz: number,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const lenSq = abx * abx + aby * aby + abz * abz;
  if (lenSq < 0.0001) return apx * apx + apy * apy + apz * apz;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / lenSq));
  const cx = ax + abx * t - px, cy = ay + aby * t - py, cz = az + abz * t - pz;
  return cx * cx + cy * cy + cz * cz;
}

export function assignVoxelsToBones(
  voxels: VoxelEntry[], bones: Record<string, Vec3>,
): Record<string, VoxelEntry[]> {
  const boneNames = Object.keys(bones);
  const result: Record<string, VoxelEntry[]> = {};
  for (const n of boneNames) result[n] = [];

  const childrenMap = new Map<string, string[]>();
  for (const n of boneNames) childrenMap.set(n, []);
  for (const d of BONE_DEFS) {
    if (boneNames.includes(d.name) && d.parent && boneNames.includes(d.parent))
      childrenMap.get(d.parent)!.push(d.name);
  }

  type Seg = { name: string; ax: number; ay: number; az: number; bx: number; by: number; bz: number };
  const segs: Seg[] = [];
  for (const n of boneNames) {
    const b = bones[n];
    const ch = childrenMap.get(n) ?? [];
    if (ch.length > 0) {
      for (const cn of ch) { const c = bones[cn]; segs.push({ name: n, ax: b.x, ay: b.y, az: b.z, bx: c.x, by: c.y, bz: c.z }); }
    } else {
      segs.push({ name: n, ax: b.x, ay: b.y, az: b.z, bx: b.x, by: b.y, bz: b.z });
    }
  }

  for (const v of voxels) {
    let best = segs[0].name, bestD = Infinity;
    for (const s of segs) {
      const d = distToSegSq(v.x, v.y, v.z, s.ax, s.ay, s.az, s.bx, s.by, s.bz);
      if (d < bestD) { bestD = d; best = s.name; }
    }
    result[best].push(v);
  }

  // Connectivity check + reassignment
  const globalMap = new Map<string, string>();
  for (const [bn, bvs] of Object.entries(result)) for (const v of bvs) globalMap.set(`${v.x},${v.y},${v.z}`, bn);

  for (const bn of boneNames) {
    const bvs = result[bn];
    if (bvs.length === 0) continue;
    const posSet = new Set<string>();
    const posMap = new Map<string, VoxelEntry>();
    for (const v of bvs) { const k = `${v.x},${v.y},${v.z}`; posSet.add(k); posMap.set(k, v); }

    const visited = new Set<string>();
    const comps: VoxelEntry[][] = [];
    for (const v of bvs) {
      const k = `${v.x},${v.y},${v.z}`;
      if (visited.has(k)) continue;
      const comp: VoxelEntry[] = [];
      const q = [k]; visited.add(k);
      while (q.length > 0) {
        const ck = q.pop()!; comp.push(posMap.get(ck)!);
        const cv = posMap.get(ck)!;
        for (const [ddx, ddy, ddz] of FACE_DIRS) {
          const nk = `${cv.x + ddx},${cv.y + ddy},${cv.z + ddz}`;
          if (posSet.has(nk) && !visited.has(nk)) { visited.add(nk); q.push(nk); }
        }
      }
      comps.push(comp);
    }
    if (comps.length <= 1) continue;
    comps.sort((a, b) => b.length - a.length);
    result[bn] = comps[0];
    for (let ci = 1; ci < comps.length; ci++) {
      for (const v of comps[ci]) {
        let reassign: string | null = null, rDist = Infinity;
        for (const [ddx, ddy, ddz] of FACE_DIRS) {
          const nk = `${v.x + ddx},${v.y + ddy},${v.z + ddz}`;
          const nb = globalMap.get(nk);
          if (nb && nb !== bn) {
            for (const s of segs) { if (s.name !== nb) continue; const d = distToSegSq(v.x, v.y, v.z, s.ax, s.ay, s.az, s.bx, s.by, s.bz); if (d < rDist) { rDist = d; reassign = nb; } }
          }
        }
        if (!reassign) { for (const s of segs) { if (s.name === bn) continue; const d = distToSegSq(v.x, v.y, v.z, s.ax, s.ay, s.az, s.bx, s.by, s.bz); if (d < rDist) { rDist = d; reassign = s.name; } } }
        if (reassign) { result[reassign].push(v); globalMap.set(`${v.x},${v.y},${v.z}`, reassign); }
      }
    }
  }

  // Add boundary overlap: duplicate voxels at bone boundaries into adjacent bones
  // This prevents visual separation at joints during rotation
  const allVoxMap = new Map<string, string>(); // voxel key → bone name
  for (const [bn, bvs] of Object.entries(result)) {
    for (const v of bvs) allVoxMap.set(`${v.x},${v.y},${v.z}`, bn);
  }

  const OVERLAP_RADIUS = 2;
  const parentOf = new Map<string, string>();
  for (const d of BONE_DEFS) {
    if (d.parent && boneNames.includes(d.parent)) parentOf.set(d.name, d.parent);
  }

  for (const [childBone, parentBone] of parentOf) {
    const childVoxels = result[childBone] ?? [];
    const parentVoxels = result[parentBone] ?? [];
    if (childVoxels.length === 0 || parentVoxels.length === 0) continue;

    // Find boundary voxels: voxels in one bone adjacent to the other bone
    const childSet = new Set(childVoxels.map(v => `${v.x},${v.y},${v.z}`));
    const parentSet = new Set(parentVoxels.map(v => `${v.x},${v.y},${v.z}`));

    // Expand: add parent's boundary voxels into child, and vice versa
    for (let r = 0; r < OVERLAP_RADIUS; r++) {
      const toAddToChild: VoxelEntry[] = [];
      const toAddToParent: VoxelEntry[] = [];

      for (const v of parentVoxels) {
        for (const [dx, dy, dz] of FACE_DIRS) {
          const nk = `${v.x+dx},${v.y+dy},${v.z+dz}`;
          if (childSet.has(nk) && !parentSet.has(`${v.x},${v.y},${v.z}`)) {
            // This parent voxel is adjacent to child - add copy to child
            if (!childSet.has(`${v.x},${v.y},${v.z}`)) {
              toAddToChild.push({ ...v });
              childSet.add(`${v.x},${v.y},${v.z}`);
            }
          }
        }
      }
      for (const v of childVoxels) {
        for (const [dx, dy, dz] of FACE_DIRS) {
          const nk = `${v.x+dx},${v.y+dy},${v.z+dz}`;
          if (parentSet.has(nk) && !childSet.has(`${v.x},${v.y},${v.z}`)) {
            if (!parentSet.has(`${v.x},${v.y},${v.z}`)) {
              toAddToParent.push({ ...v });
              parentSet.add(`${v.x},${v.y},${v.z}`);
            }
          }
        }
      }

      result[childBone].push(...toAddToChild);
      result[parentBone].push(...toAddToParent);
    }
  }

  return result;
}

// ============================================================
// Sphere Caps at Bone Boundaries
// ============================================================
export function addSphereCaps(boneVoxels: Record<string, VoxelEntry[]>): void {
  const boneMaps = new Map<string, Map<string, VoxelEntry>>();
  for (const [bn, vs] of Object.entries(boneVoxels)) {
    const m = new Map<string, VoxelEntry>();
    for (const v of vs) m.set(`${v.x},${v.y},${v.z}`, v);
    boneMaps.set(bn, m);
  }
  const processed = new Set<string>();
  const toAdd = new Map<string, VoxelEntry[]>();
  for (const n of Object.keys(boneVoxels)) toAdd.set(n, []);

  for (const [bn] of Object.entries(boneVoxels)) {
    const thisMap = boneMaps.get(bn)!;
    const adjBnd = new Map<string, Map<string, VoxelEntry>>();
    for (const [k, v] of thisMap) {
      for (const [ddx, ddy, ddz] of FACE_DIRS) {
        const nk = `${v.x + ddx},${v.y + ddy},${v.z + ddz}`;
        if (thisMap.has(nk)) continue;
        for (const [on, om] of boneMaps) {
          if (on !== bn && om.has(nk)) {
            if (!adjBnd.has(on)) adjBnd.set(on, new Map());
            adjBnd.get(on)!.set(k, v);
            break;
          }
        }
      }
    }
    for (const [on, thisBnd] of adjBnd) {
      const pk = [bn, on].sort().join('|');
      if (processed.has(pk)) continue;
      processed.add(pk);
      const otherMap = boneMaps.get(on)!;
      const otherBnd = new Map<string, VoxelEntry>();
      for (const [, v] of otherMap) {
        for (const [ddx, ddy, ddz] of FACE_DIRS) {
          const nk = `${v.x + ddx},${v.y + ddy},${v.z + ddz}`;
          if (thisMap.has(nk)) { otherBnd.set(`${v.x},${v.y},${v.z}`, v); break; }
        }
      }
      let tx = 0, ty = 0, tz = 0;
      for (const v of thisBnd.values()) { tx += v.x; ty += v.y; tz += v.z; }
      tx /= thisBnd.size; ty /= thisBnd.size; tz /= thisBnd.size;
      let ox = 0, oy = 0, oz = 0;
      for (const v of otherBnd.values()) { ox += v.x; oy += v.y; oz += v.z; }
      if (otherBnd.size === 0) continue;
      ox /= otherBnd.size; oy /= otherBnd.size; oz /= otherBnd.size;
      const mx = (tx + ox) / 2, my = (ty + oy) / 2, mz = (tz + oz) / 2;
      const ndx = ox - tx, ndy = oy - ty, ndz = oz - tz;
      const nLen = Math.sqrt(ndx * ndx + ndy * ndy + ndz * ndz) || 1;
      const nnx = ndx / nLen, nny = ndy / nLen, nnz = ndz / nLen;
      let maxDSq = 0;
      for (const v of thisBnd.values()) { const d = (v.x - mx) ** 2 + (v.y - my) ** 2 + (v.z - mz) ** 2; if (d > maxDSq) maxDSq = d; }
      for (const v of otherBnd.values()) { const d = (v.x - mx) ** 2 + (v.y - my) ** 2 + (v.z - mz) ** 2; if (d > maxDSq) maxDSq = d; }
      const r = Math.max(1, Math.sqrt(maxDSq) / 2), rSq = r * r, ri = Math.ceil(r);
      const allBnd = [...thisBnd.values(), ...otherBnd.values()];
      for (let sx = -ri; sx <= ri; sx++) for (let sy = -ri; sy <= ri; sy++) for (let sz = -ri; sz <= ri; sz++) {
        const vx = Math.round(mx) + sx, vy = Math.round(my) + sy, vz = Math.round(mz) + sz;
        if ((vx - mx) ** 2 + (vy - my) ** 2 + (vz - mz) ** 2 > rSq) continue;
        const k = `${vx},${vy},${vz}`;
        let nrD = Infinity, nc = { r: 0.5, g: 0.5, b: 0.5 };
        for (const bv of allBnd) { const d = (vx - bv.x) ** 2 + (vy - bv.y) ** 2 + (vz - bv.z) ** 2; if (d < nrD) { nrD = d; nc = { r: bv.r, g: bv.g, b: bv.b }; } }
        const entry: VoxelEntry = { x: vx, y: vy, z: vz, r: nc.r, g: nc.g, b: nc.b };
        const proj = (vx - mx) * nnx + (vy - my) * nny + (vz - mz) * nnz;
        if (proj > 0) { if (!thisMap.has(k)) toAdd.get(bn)!.push(entry); }
        else { if (!otherMap.has(k)) toAdd.get(on)!.push(entry); }
      }
    }
  }
  for (const [bn, adds] of toAdd) if (adds.length > 0) boneVoxels[bn].push(...adds);
}

// ============================================================
// Unlit Shader Material
// ============================================================
export function createUnlitMaterial(scene: Scene, name: string): ShaderMaterial {
  Effect.ShadersStore[name + 'VertexShader'] = `precision highp float;attribute vec3 position;attribute vec4 color;uniform mat4 worldViewProjection;varying vec4 vColor;void main(){gl_Position=worldViewProjection*vec4(position,1.0);vColor=color;}`;
  Effect.ShadersStore[name + 'FragmentShader'] = `precision highp float;varying vec4 vColor;void main(){gl_FragColor=vColor;}`;
  const mat = new ShaderMaterial(name, scene, { vertex: name, fragment: name }, {
    attributes: ['position', 'color'], uniforms: ['worldViewProjection'], needAlphaBlending: false,
  });
  mat.backFaceCulling = false;
  mat.forceDepthWrite = true;
  return mat;
}

// ============================================================
// Build Skeletal Character (hierarchical TransformNode + Mesh)
// ============================================================
function buildBoneMeshLocal(
  voxels: VoxelEntry[], scene: Scene, name: string,
  cx: number, cy: number, bonePos: Vec3,
): Mesh {
  const bvx = (bonePos.x - cx) * VSCALE, bvy = bonePos.z * VSCALE, bvz = -(bonePos.y - cy) * VSCALE;
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
        pos.push((vx.x + fv[vi][0] - cx) * VSCALE - bvx, (vx.z + fv[vi][2]) * VSCALE - bvy, -(vx.y + fv[vi][1] - cy) * VSCALE - bvz);
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
  return mesh;
}

export function buildSkeletalCharacter(
  voxels: VoxelEntry[], bones: Record<string, Vec3>,
  scene: Scene, cx: number, cy: number, prefix = 'char',
): { nodes: Map<string, TransformNode>; meshes: Map<string, Mesh>; restPos: Map<string, Vector3> } {
  const boneVoxels = assignVoxelsToBones(voxels, bones);
  addSphereCaps(boneVoxels);

  const nodes = new Map<string, TransformNode>();
  const meshes = new Map<string, Mesh>();
  const restPos = new Map<string, Vector3>();

  for (const bd of BONE_DEFS) {
    const bp = bones[bd.name];
    if (!bp) continue;
    const node = new TransformNode(`${prefix}_bone_${bd.name}`, scene);
    nodes.set(bd.name, node);
    restPos.set(bd.name, voxelToViewer(bp.x, bp.y, bp.z, cx, cy));
  }

  for (const bd of BONE_DEFS) {
    const node = nodes.get(bd.name);
    const bp = bones[bd.name];
    if (!node || !bp) continue;
    const vp = voxelToViewer(bp.x, bp.y, bp.z, cx, cy);
    if (bd.parent) {
      const pn = nodes.get(bd.parent);
      const pp = bones[bd.parent];
      if (pn && pp) {
        node.parent = pn;
        node.position = vp.subtract(voxelToViewer(pp.x, pp.y, pp.z, cx, cy));
      } else { node.position = vp; }
    } else { node.position = vp; }
  }

  for (const bd of BONE_DEFS) {
    const bv = boneVoxels[bd.name];
    const node = nodes.get(bd.name);
    const bp = bones[bd.name];
    if (!bv || bv.length === 0 || !node || !bp) continue;
    const mesh = buildBoneMeshLocal(bv, scene, `${prefix}_${bd.name}`, cx, cy, bp);
    mesh.parent = node;
    mesh.isPickable = false;
    meshes.set(bd.name, mesh);
  }

  return { nodes, meshes, restPos };
}

// ============================================================
// Simple voxel mesh (non-skeletal, for preview)
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
// Motion Clip Loader
// ============================================================
export async function loadMotionClip(url: string, name: string, label: string): Promise<MotionClip> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load motion: ${url}`);
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

export function threeQuatToViewer(dq: [number, number, number, number]): Quaternion {
  return new Quaternion(dq[0], -dq[1], -dq[2], dq[3]);
}

// ============================================================
// Motion Clip → contactform matrix format conversion
// Converts Three.js quaternion-based motion clips to per-bone
// 4x4 skinning matrices (Babylon row-major format) that
// contactform's realistic-viewer can directly use.
// ============================================================
export interface ContactMotionExport {
  fps: number;
  frame_count: number;
  babylonFormat: true;
  bones: Record<string, { matrices: number[][] }>;
}

/** Rotate a vector by a quaternion: v' = q * v * q_conj */
function quatRotateVec(qx: number, qy: number, qz: number, qw: number, vx: number, vy: number, vz: number): [number, number, number] {
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  // v' = v + w*t + cross(q.xyz, t)
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

/** Build 16-element skinning matrix (Babylon row-major) from world quaternion + world position + bind position */
function buildSkinMatrix(
  qx: number, qy: number, qz: number, qw: number,
  ax: number, ay: number, az: number,     // animated world position
  bx: number, by: number, bz: number,     // bind (rest) world position
): number[] {
  // Rotation part from quaternion
  const xx = qx * qx, yy = qy * qy, zz = qz * qz;
  const xy = qx * qy, xz = qx * qz, yz = qy * qz;
  const wx = qw * qx, wy = qw * qy, wz = qw * qz;
  const r0 = 1 - 2 * (yy + zz), r1 = 2 * (xy + wz), r2 = 2 * (xz - wy);
  const r4 = 2 * (xy - wz), r5 = 1 - 2 * (xx + zz), r6 = 2 * (yz + wx);
  const r8 = 2 * (xz + wy), r9 = 2 * (yz - wx), r10 = 1 - 2 * (xx + yy);
  // Translation: -bind * R + animPos
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

  // Rest positions in viewer space
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

  // Process order: root first, then children (topological order)
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

  // Per-bone per-frame matrices
  const boneMatrices: Record<string, number[][]> = {};
  for (const bd of activeBones) boneMatrices[bd.name] = [];

  for (let fi = 0; fi < clip.frameCount; fi++) {
    const frame = clip.frames[fi] ?? {};

    // World quaternions in viewer space
    const worldQ: Record<string, [number, number, number, number]> = {};
    for (const bd of activeBones) {
      const d = frame[bd.name];
      if (d) {
        // threeQuatToViewer: (x, -y, -z, w)
        worldQ[bd.name] = [d.dq[0], -d.dq[1], -d.dq[2], d.dq[3]];
      } else {
        worldQ[bd.name] = [0, 0, 0, 1]; // identity
      }
    }

    // Compute world positions (root→leaf order)
    const worldPos: Record<string, [number, number, number]> = {};
    for (const bd of ordered) {
      if (!bd.parent || !bones[bd.parent]) {
        // Root bone (Hips): rest position + displacement
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
        // Child bone: parent world pos + parent world rot applied to rest local offset
        const parentName = bd.parent;
        const pp = worldPos[parentName];
        const pq = worldQ[parentName];
        const lo = restLocalOffset[bd.name];
        const rotated = quatRotateVec(pq[0], pq[1], pq[2], pq[3], lo[0], lo[1], lo[2]);
        worldPos[bd.name] = [pp[0] + rotated[0], pp[1] + rotated[1], pp[2] + rotated[2]];
      }
    }

    // Build skinning matrix for each bone
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

// ============================================================
// VOX File Export
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
// Skeletal Model JSON Export
// Exports everything needed to animate the model externally:
//   - Bone-separated voxels (each bone's voxel list)
//   - Skeleton hierarchy (41 bones, parent-child, rest positions)
//   - Grid size and scale
// ============================================================
export interface SkeletalModelExport {
  gridSize: { x: number; y: number; z: number };
  voxelScale: number;
  bones: {
    name: string;
    label: string;
    parent: string | null;
    position: { x: number; y: number; z: number };
    voxels: { x: number; y: number; z: number; r: number; g: number; b: number }[];
  }[];
}

export function exportSkeletalModelJSON(
  voxels: VoxelEntry[],
  bones: Record<string, Vec3>,
): SkeletalModelExport {
  const boneVoxels = assignVoxelsToBones(voxels, bones);
  addSphereCaps(boneVoxels);

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
// contactform-compatible export: segments_bundle.json
// Format: { grid, palette, segments: { boneName: [x,y,z,ci,...] } }
// ============================================================
export interface SegmentBundleExport {
  grid: { gx: number; gy: number; gz: number };
  palette: number[][];            // [[r,g,b], ...] normalized 0-1
  segments: Record<string, number[]>; // boneName → flat [x,y,z,colorIndex, ...]
}

export function exportSegmentsBundle(
  voxels: VoxelEntry[],
  bones: Record<string, Vec3>,
): SegmentBundleExport {
  const boneVoxels = assignVoxelsToBones(voxels, bones);
  addSphereCaps(boneVoxels);

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

  // Build per-bone flat arrays: [x, y, z, colorIndex, x, y, z, colorIndex, ...]
  const segments: Record<string, number[]> = {};
  for (const bd of BONE_DEFS) {
    const bvs = boneVoxels[bd.name];
    if (!bvs || bvs.length === 0) continue;
    const flat: number[] = [];
    // Deduplicate voxels within each bone
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

// ============================================================
// contactform-compatible export: segments.json
// Format: { voxel_size, grid, bone_positions: { name: {head_voxel, tail_voxel} }, segments: { name: {file, voxels} } }
// ============================================================
export interface SegmentsInfoExport {
  voxel_size: number;
  grid: { gx: number; gy: number; gz: number };
  bone_positions: Record<string, { head_voxel: number[]; tail_voxel: number[] }>;
  segments: Record<string, { file: string; voxels: number }>;
}

export function exportSegmentsInfo(
  voxels: VoxelEntry[],
  bones: Record<string, Vec3>,
): SegmentsInfoExport {
  const boneVoxels = assignVoxelsToBones(voxels, bones);
  addSphereCaps(boneVoxels);

  // Build children map to compute tail positions
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

    // Tail = first child's head, or offset from head for leaf bones
    const ch = childrenMap.get(bd.name) ?? [];
    let tail: number[];
    if (ch.length > 0) {
      const cp = bones[ch[0]];
      tail = [Math.round(cp.x), Math.round(cp.y), Math.round(cp.z)];
    } else {
      // Leaf bone: offset slightly in the direction from parent (or +Z if root)
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

// ============================================================
// Skinned GLB Export (glTF 2.0 Binary)
// Exports a single skinned mesh with Mixamo-compatible skeleton.
// External engines (Unity, Unreal, Blender, etc.) can animate it.
// ============================================================
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

  // Occupancy for face culling (original voxels only, no overlap duplicates)
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
          // glTF right-handed Y-up: X=right, Y=up(voxZ), Z=forward(voxY)
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
        // Reversed winding for right-handed coordinate system
        idx.push(bi, bi + 2, bi + 1, bi, bi + 3, bi + 2);
      }
    }
  }

  const vtxCount = pos.length / 3;
  const idxCount = idx.length;
  if (vtxCount === 0) return new Blob([], { type: 'model/gltf-binary' });

  // Binary buffer layout (all naturally aligned to 4 bytes)
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

  // Inverse bind matrices: inverse of each joint's world transform (translation only)
  for (let j = 0; j < numJoints; j++) {
    const bp = bones[activeBones[j].name];
    const wx = (bp.x - cx) * VSCALE;
    const wy = bp.z * VSCALE;
    const wz = (bp.y - cy) * VSCALE;
    const o = ibmOff + j * 64;
    // Column-major 4x4 identity with -translation
    dv.setFloat32(o,      1, true); dv.setFloat32(o + 4,  0, true); dv.setFloat32(o + 8,  0, true); dv.setFloat32(o + 12, 0, true);
    dv.setFloat32(o + 16, 0, true); dv.setFloat32(o + 20, 1, true); dv.setFloat32(o + 24, 0, true); dv.setFloat32(o + 28, 0, true);
    dv.setFloat32(o + 32, 0, true); dv.setFloat32(o + 36, 0, true); dv.setFloat32(o + 40, 1, true); dv.setFloat32(o + 44, 0, true);
    dv.setFloat32(o + 48, -wx, true); dv.setFloat32(o + 52, -wy, true); dv.setFloat32(o + 56, -wz, true); dv.setFloat32(o + 60, 1, true);
  }

  // Position bounding box (required by glTF spec for POSITION accessor)
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vtxCount; i++) {
    const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
    if (px < minX) minX = px; if (py < minY) minY = py; if (pz < minZ) minZ = pz;
    if (px > maxX) maxX = px; if (py > maxY) maxY = py; if (pz > maxZ) maxZ = pz;
  }

  // Build joint node hierarchy
  // Node 0 = mesh node; Nodes 1..numJoints = joint nodes
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
  // GLB header
  glbView.setUint32(offset, 0x46546C67, true); offset += 4; // magic "glTF"
  glbView.setUint32(offset, 2, true); offset += 4;           // version 2
  glbView.setUint32(offset, glbTotalLength, true); offset += 4;
  // JSON chunk
  glbView.setUint32(offset, jsonPadded, true); offset += 4;
  glbView.setUint32(offset, 0x4E4F534A, true); offset += 4;  // "JSON"
  glbBytes.set(jsonBuf, offset);
  for (let i = jsonBuf.length; i < jsonPadded; i++) glbBytes[offset + i] = 0x20; // pad with spaces
  offset += jsonPadded;
  // BIN chunk
  glbView.setUint32(offset, binPadded, true); offset += 4;
  glbView.setUint32(offset, 0x004E4942, true); offset += 4;  // "BIN\0"
  glbBytes.set(new Uint8Array(buf), offset);

  return new Blob([glb], { type: 'model/gltf-binary' });
}
