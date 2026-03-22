/**
 * ボクセルスケルトン共有ユーティリティ
 * bone-config（キャラクター作成）とFightGame（ゲームプレイ）で共通使用する。
 * このファイルが以下の唯一の情報源（Single Source of Truth）:
 *   - ボーン定義（Mixamo標準41ボーン）
 *   - マーカー → ボーン位置計算
 *   - ボクセル → ボーン割り当て
 *   - ボーンメッシュ構築
 *   - モーションクリップの型定義と再生ヘルパー
 */

// Babylon.jsのコアモジュールからシーン、メッシュ、シェーダー等をインポート
import {
  Scene, Mesh, VertexData, ShaderMaterial, Effect,
  TransformNode, Vector3, Quaternion,
} from '@babylonjs/core';
// vox-parserから描画用定数とボクセル型をインポート
import { SCALE, FACE_DIRS, FACE_VERTS, FACE_NORMALS } from '@/lib/vox-parser';
import type { VoxelEntry } from '@/lib/vox-parser';

// ========================================================================
// 型定義
// ========================================================================
// 3次元座標を表すインターフェース（ボクセル空間用）
export interface Vec3 { x: number; y: number; z: number; }
// マーカー名をキーとした座標のマップ型
export type MarkerData = Record<string, Vec3>;

// ボーン1本の定義情報
export interface BoneDef {
  name: string;        // ボーン名（Mixamo標準名: "Hips", "Spine"等）
  label: string;       // UI表示用ラベル
  parent: string | null; // 親ボーン名（ルートはnull）
  color: string;       // UI表示用の色（16進カラーコード）
}

// ========================================================================
// ボーン定義（Mixamo標準41ボーン）
// 階層構造: Hips → Spine → Spine1 → Spine2 → Neck → Head
//           Spine2 → LeftShoulder → LeftArm → LeftForeArm → LeftHand → 指
//           Spine2 → RightShoulder → RightArm → ...（左右対称）
//           Hips → LeftUpLeg → LeftLeg → LeftFoot → LeftToeBase → LeftToe_End
//           Hips → RightUpLeg → ...（左右対称）
// ========================================================================
export const BONE_DEFS: BoneDef[] = [
  // 中央チェーン（体幹）
  { name: 'Hips',           label: 'Hips',           parent: null,             color: '#ff4444' },
  { name: 'Spine',          label: 'Spine',          parent: 'Hips',           color: '#ff6644' },
  { name: 'Spine1',         label: 'Spine1',         parent: 'Spine',          color: '#ff8844' },
  { name: 'Spine2',         label: 'Spine2',         parent: 'Spine1',         color: '#ffaa44' },
  { name: 'Neck',           label: 'Neck',           parent: 'Spine2',         color: '#ffcc44' },
  { name: 'Head',           label: 'Head',           parent: 'Neck',           color: '#ffee44' },
  // 左腕チェーン
  { name: 'LeftShoulder',   label: 'L.Shoulder',     parent: 'Spine2',         color: '#44aaff' },
  { name: 'LeftArm',        label: 'L.Arm',          parent: 'LeftShoulder',   color: '#4488ff' },
  { name: 'LeftForeArm',    label: 'L.ForeArm',      parent: 'LeftArm',        color: '#4466ff' },
  { name: 'LeftHand',       label: 'L.Hand',         parent: 'LeftForeArm',    color: '#4444ff' },
  // 左手の指（親指・人差し指、各4関節）
  { name: 'LeftHandThumb1', label: 'L.Thumb1',       parent: 'LeftHand',       color: '#5555ff' },
  { name: 'LeftHandThumb2', label: 'L.Thumb2',       parent: 'LeftHandThumb1', color: '#5555ee' },
  { name: 'LeftHandThumb3', label: 'L.Thumb3',       parent: 'LeftHandThumb2', color: '#5555dd' },
  { name: 'LeftHandThumb4', label: 'L.Thumb4',       parent: 'LeftHandThumb3', color: '#5555cc' },
  { name: 'LeftHandIndex1', label: 'L.Index1',       parent: 'LeftHand',       color: '#6666ff' },
  { name: 'LeftHandIndex2', label: 'L.Index2',       parent: 'LeftHandIndex1', color: '#6666ee' },
  { name: 'LeftHandIndex3', label: 'L.Index3',       parent: 'LeftHandIndex2', color: '#6666dd' },
  { name: 'LeftHandIndex4', label: 'L.Index4',       parent: 'LeftHandIndex3', color: '#6666cc' },
  // 右腕チェーン
  { name: 'RightShoulder',  label: 'R.Shoulder',     parent: 'Spine2',         color: '#ff44aa' },
  { name: 'RightArm',       label: 'R.Arm',          parent: 'RightShoulder',  color: '#ff4488' },
  { name: 'RightForeArm',   label: 'R.ForeArm',      parent: 'RightArm',       color: '#ff4466' },
  { name: 'RightHand',      label: 'R.Hand',         parent: 'RightForeArm',   color: '#ff4444' },
  // 右手の指
  { name: 'RightHandThumb1',label: 'R.Thumb1',       parent: 'RightHand',      color: '#ff5555' },
  { name: 'RightHandThumb2',label: 'R.Thumb2',       parent: 'RightHandThumb1',color: '#ee5555' },
  { name: 'RightHandThumb3',label: 'R.Thumb3',       parent: 'RightHandThumb2',color: '#dd5555' },
  { name: 'RightHandThumb4',label: 'R.Thumb4',       parent: 'RightHandThumb3',color: '#cc5555' },
  { name: 'RightHandIndex1',label: 'R.Index1',       parent: 'RightHand',      color: '#ff6666' },
  { name: 'RightHandIndex2',label: 'R.Index2',       parent: 'RightHandIndex1',color: '#ee6666' },
  { name: 'RightHandIndex3',label: 'R.Index3',       parent: 'RightHandIndex2',color: '#dd6666' },
  { name: 'RightHandIndex4',label: 'R.Index4',       parent: 'RightHandIndex3',color: '#cc6666' },
  // 左脚チェーン
  { name: 'LeftUpLeg',      label: 'L.UpLeg',        parent: 'Hips',           color: '#44ff88' },
  { name: 'LeftLeg',        label: 'L.Leg',          parent: 'LeftUpLeg',      color: '#44ff66' },
  { name: 'LeftFoot',       label: 'L.Foot',         parent: 'LeftLeg',        color: '#44ff44' },
  { name: 'LeftToeBase',    label: 'L.ToeBase',      parent: 'LeftFoot',       color: '#44ee44' },
  { name: 'LeftToe_End',    label: 'L.ToeEnd',       parent: 'LeftToeBase',    color: '#44dd44' },
  // 右脚チェーン
  { name: 'RightUpLeg',     label: 'R.UpLeg',        parent: 'Hips',           color: '#aaff44' },
  { name: 'RightLeg',       label: 'R.Leg',          parent: 'RightUpLeg',     color: '#88ff44' },
  { name: 'RightFoot',      label: 'R.Foot',         parent: 'RightLeg',       color: '#66ff44' },
  { name: 'RightToeBase',   label: 'R.ToeBase',      parent: 'RightFoot',      color: '#55ee44' },
  { name: 'RightToe_End',   label: 'R.ToeEnd',       parent: 'RightToeBase',   color: '#55dd44' },
];

// ========================================================================
// マーカー → 全41ボーン位置の自動計算
// 5つのマーカー（顎、股間、左右手首、左右肘、左右膝）から全ボーン位置を導出する
// ========================================================================
// 左側マーカーをX軸中心で反転し、右側マーカーを生成する
export function mirrorMarker(leftPos: Vec3, mirrorCenterX: number): Vec3 {
  return { x: mirrorCenterX + (mirrorCenterX - leftPos.x), y: leftPos.y, z: leftPos.z };
}

// デフォルトのマーカー位置を返す（初期配置用）
// centerX: ボクセルグリッドの中心X座標
export function getDefaultMarkers(centerX: number): MarkerData {
  const left: MarkerData = {
    Chin:       { x: 42.5, y: 13, z: 82 },   // 顎の位置
    Groin:      { x: 41, y: 13, z: 47.5 },    // 股間の位置
    LeftWrist:  { x: 9, y: 13, z: 63.5 },     // 左手首の位置
    LeftElbow:  { x: 23, y: 13, z: 70 },      // 左肘の位置
    LeftKnee:   { x: 32.5, y: 15.5, z: 27.5 }, // 左膝の位置
  };
  // 右側マーカーは左側をミラーして自動生成
  left['RightWrist'] = mirrorMarker(left['LeftWrist'], centerX);
  left['RightElbow'] = mirrorMarker(left['LeftElbow'], centerX);
  left['RightKnee']  = mirrorMarker(left['LeftKnee'], centerX);
  return left;
}

// マーカー位置から全41ボーンの位置を計算する
// markers: 8マーカーの座標マップ
// bodyMaxZ: ボクセルボディの最大Z座標（頭頂の上限）
export function calculateAllBones(
  markers: MarkerData, bodyMaxZ: number,
): Record<string, Vec3> {
  // 各マーカー位置を取得
  const chin = markers['Chin'];       // 顎
  const groin = markers['Groin'];     // 股間
  const lWrist = markers['LeftWrist'];  // 左手首
  const lElbow = markers['LeftElbow'];  // 左肘
  const lKnee = markers['LeftKnee'];    // 左膝
  const rWrist = markers['RightWrist']; // 右手首
  const rElbow = markers['RightElbow']; // 右肘
  const rKnee = markers['RightKnee'];   // 右膝

  // 2点間の線形補間ヘルパー（t=0でa、t=1でb）
  const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  });

  // 体幹チェーン: Hips（股間）→ Spine → Spine1 → Spine2 → Neck → Head
  const hips: Vec3 = { x: groin.x, y: groin.y, z: groin.z };
  const neck: Vec3 = { x: chin.x, y: chin.y, z: chin.z - 4 }; // 顎から4ボクセル下
  const head: Vec3 = { x: chin.x, y: chin.y, z: Math.min(chin.z + 8, bodyMaxZ) }; // 顎から8ボクセル上（上限あり）

  // Spine系はHipsとNeckの間を25%/50%/75%で補間
  const spine  = lerp3(hips, neck, 0.25);
  const spine1 = lerp3(hips, neck, 0.50);
  const spine2 = lerp3(hips, neck, 0.75);

  // 左腕チェーン: Shoulder → Arm → ForeArm(肘) → Hand(手首) → 指
  // 肩はSpine2から肘方向に35%オフセット、Z+2で少し上に配置
  const lShoulderOffset = (lElbow.x - spine2.x) * 0.35;
  const lShoulder: Vec3 = { x: spine2.x + lShoulderOffset, y: spine2.y, z: spine2.z + 2 };
  const lArm = lerp3(lShoulder, lElbow, 0.3); // 上腕は肩から肘の30%地点
  const lForeArm: Vec3 = { ...lElbow };        // 前腕 = 肘位置
  const lHand: Vec3 = { ...lWrist };            // 手 = 手首位置

  // 左手の指: 手→前腕方向の単位ベクトルに沿って小さくオフセット
  const lFingerDir = { x: lHand.x - lForeArm.x, y: lHand.y - lForeArm.y, z: lHand.z - lForeArm.z };
  const lFingerLen = Math.sqrt(lFingerDir.x ** 2 + lFingerDir.y ** 2 + lFingerDir.z ** 2) || 1;
  const lFD = { x: lFingerDir.x / lFingerLen, y: lFingerDir.y / lFingerLen, z: lFingerDir.z / lFingerLen };
  // 親指: 手から1, 1.8, 2.5, 3ボクセル先
  const lThumb1: Vec3 = { x: lHand.x + lFD.x * 1, y: lHand.y + lFD.y * 1, z: lHand.z + lFD.z * 1 };
  const lThumb2: Vec3 = { x: lThumb1.x + lFD.x * 0.8, y: lThumb1.y + lFD.y * 0.8, z: lThumb1.z + lFD.z * 0.8 };
  const lThumb3: Vec3 = { x: lThumb2.x + lFD.x * 0.7, y: lThumb2.y + lFD.y * 0.7, z: lThumb2.z + lFD.z * 0.7 };
  const lThumb4: Vec3 = { x: lThumb3.x + lFD.x * 0.5, y: lThumb3.y + lFD.y * 0.5, z: lThumb3.z + lFD.z * 0.5 };
  // 人差し指: 手から1.5, 2.5, 3.3, 4ボクセル先
  const lIndex1: Vec3 = { x: lHand.x + lFD.x * 1.5, y: lHand.y + lFD.y * 1.5, z: lHand.z + lFD.z * 1.5 };
  const lIndex2: Vec3 = { x: lIndex1.x + lFD.x * 1, y: lIndex1.y + lFD.y * 1, z: lIndex1.z + lFD.z * 1 };
  const lIndex3: Vec3 = { x: lIndex2.x + lFD.x * 0.8, y: lIndex2.y + lFD.y * 0.8, z: lIndex2.z + lFD.z * 0.8 };
  const lIndex4: Vec3 = { x: lIndex3.x + lFD.x * 0.7, y: lIndex3.y + lFD.y * 0.7, z: lIndex3.z + lFD.z * 0.7 };

  // 右腕チェーン（左腕と同じロジック、独立した座標）
  const rShoulderOffset = (rElbow.x - spine2.x) * 0.35;
  const rShoulder: Vec3 = { x: spine2.x + rShoulderOffset, y: spine2.y, z: spine2.z + 2 };
  const rArm = lerp3(rShoulder, rElbow, 0.3);
  const rForeArm: Vec3 = { ...rElbow };
  const rHand: Vec3 = { ...rWrist };

  // 右手の指
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

  // 左脚チェーン: UpLeg(太もも) → Leg(膝) → Foot → ToeBase → Toe_End
  const lLegOffsetX = (lKnee.x - groin.x) * 0.8; // 太もも付け根は股間から膝方向に80%オフセット
  const lUpLeg: Vec3 = { x: groin.x + lLegOffsetX, y: groin.y, z: groin.z };
  const lLeg: Vec3 = { ...lKnee };                 // 膝位置
  const lFoot: Vec3 = { x: lKnee.x, y: Math.max(lKnee.y - 4, 0), z: 2 };     // 足首（地面近く）
  const lToeBase: Vec3 = { x: lFoot.x, y: Math.max(lFoot.y - 3, 0), z: 1 };   // つま先の付け根
  const lToeEnd: Vec3 = { x: lToeBase.x, y: Math.max(lToeBase.y - 2, 0), z: 0 }; // つま先の先端

  // 右脚チェーン（左脚と同じロジック）
  const rLegOffsetX = (rKnee.x - groin.x) * 0.8;
  const rUpLeg: Vec3 = { x: groin.x + rLegOffsetX, y: groin.y, z: groin.z };
  const rLeg: Vec3 = { ...rKnee };
  const rFoot: Vec3 = { x: rKnee.x, y: Math.max(rKnee.y - 4, 0), z: 2 };
  const rToeBase: Vec3 = { x: rFoot.x, y: Math.max(rFoot.y - 3, 0), z: 1 };
  const rToeEnd: Vec3 = { x: rToeBase.x, y: Math.max(rToeBase.y - 2, 0), z: 0 };

  // 全41ボーンの位置をボーン名→座標のマップとして返す
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
// 座標変換ヘルパー
// ボクセル空間（X=右, Y=奥行き, Z=上）→ ビューワー空間（Babylon.js: X=右, Y=上, Z=手前）
// ========================================================================
export function voxelToViewer(vx: number, vy: number, vz: number, cx: number, cy: number): Vector3 {
  // cx, cy: グリッド中心座標。ボクセル空間の原点をグリッド中心に合わせる
  // X: (vx - cx) * SCALE → そのまま右方向
  // Y: vz * SCALE → ボクセルのZ（上方向）をビューワーのY（上方向）に
  // Z: -(vy - cy) * SCALE → ボクセルのY（奥行き）をビューワーのZ（手前方向、符号反転）に
  return new Vector3((vx - cx) * SCALE, vz * SCALE, -(vy - cy) * SCALE);
}

// ========================================================================
// ボクセル → ボーン割り当て
// 各ボクセルを最も近いボーンセグメントに割り当てる
// ========================================================================

// 点Pから線分ABまでの距離の二乗を計算する
// px,py,pz: 点P、ax,ay,az: 線分始点A、bx,by,bz: 線分終点B
function distToSegmentSq(px: number, py: number, pz: number,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az; // AB方向ベクトル
  const apx = px - ax, apy = py - ay, apz = pz - az; // AP方向ベクトル
  const lenSq = abx * abx + aby * aby + abz * abz;   // ABの長さの二乗
  // ABが退化（長さ0）の場合はAまでの点距離を返す
  if (lenSq < 0.0001) return apx * apx + apy * apy + apz * apz;
  // t = APをABに射影したパラメータ（0-1にクランプ）
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / lenSq));
  // 最近接点からPまでのベクトル
  const cx = ax + abx * t - px, cy = ay + aby * t - py, cz = az + abz * t - pz;
  return cx * cx + cy * cy + cz * cz; // 距離の二乗を返す
}

// 全ボクセルを最も近いボーンに割り当てる
// voxels: 割り当て対象のボクセル配列
// bones: ボーン名→座標のマップ
// 戻り値: ボーン名→そのボーンに属するボクセル配列のマップ
export function assignVoxelsToBones(
  voxels: VoxelEntry[],
  bones: Record<string, Vec3>,
): Record<string, VoxelEntry[]> {
  const boneNames = Object.keys(bones);
  // 各ボーン用の空配列を用意
  const result: Record<string, VoxelEntry[]> = {};
  for (const name of boneNames) result[name] = [];

  // 子ボーンマップを構築（各ボーンの子ボーン一覧）
  const childrenMap = new Map<string, string[]>();
  for (const name of boneNames) childrenMap.set(name, []);
  for (const def of BONE_DEFS) {
    if (boneNames.includes(def.name) && def.parent && boneNames.includes(def.parent)) {
      childrenMap.get(def.parent)!.push(def.name);
    }
  }

  // ボーンセグメント（線分）を構築
  // 各ボーンは自身の位置から子ボーンの位置までの線分を持つ
  // 葉ボーン（子なし）は点として扱う（始点=終点）
  type Segment = { name: string; ax: number; ay: number; az: number; bx: number; by: number; bz: number };
  const segments: Segment[] = [];
  for (const name of boneNames) {
    const b = bones[name];
    const children = childrenMap.get(name) ?? [];
    if (children.length > 0) {
      // 子がある場合: 自分→各子ボーンの線分を生成
      for (const childName of children) {
        const c = bones[childName];
        segments.push({ name, ax: b.x, ay: b.y, az: b.z, bx: c.x, by: c.y, bz: c.z });
      }
    } else {
      // 葉ボーン: 退化した線分（点距離として計算される）
      segments.push({ name, ax: b.x, ay: b.y, az: b.z, bx: b.x, by: b.y, bz: b.z });
    }
  }

  // 全ボクセルを最も近いセグメントのボーンに割り当て
  for (const v of voxels) {
    let bestBone = segments[0].name;
    let bestDist = Infinity;
    for (const seg of segments) {
      const dist = distToSegmentSq(v.x, v.y, v.z, seg.ax, seg.ay, seg.az, seg.bx, seg.by, seg.bz);
      if (dist < bestDist) { bestDist = dist; bestBone = seg.name; }
    }
    result[bestBone].push(v);
  }

  // 連結性チェック: 各ボーンのボクセル群が空間的に連結しているか確認
  // 分離したクラスターは最も近い隣接ボーンに再割り当てする
  const globalMap = new Map<string, string>(); // 座標→ボーン名のグローバルマップ
  for (const [boneName, bvs] of Object.entries(result)) {
    for (const v of bvs) globalMap.set(`${v.x},${v.y},${v.z}`, boneName);
  }

  for (const boneName of boneNames) {
    const bvs = result[boneName];
    if (bvs.length === 0) continue;

    // このボーンのボクセル位置セットとマップを構築
    const posSet = new Set<string>();
    const posMap = new Map<string, VoxelEntry>();
    for (const v of bvs) {
      const k = `${v.x},${v.y},${v.z}`;
      posSet.add(k);
      posMap.set(k, v);
    }

    // フラッドフィルで連結成分を検出
    const visited = new Set<string>();
    const components: VoxelEntry[][] = [];
    for (const v of bvs) {
      const k = `${v.x},${v.y},${v.z}`;
      if (visited.has(k)) continue;
      const component: VoxelEntry[] = [];
      const queue = [k];
      visited.add(k);
      while (queue.length > 0) {
        const ck = queue.pop()!;
        component.push(posMap.get(ck)!);
        const cv = posMap.get(ck)!;
        // 6方向の隣接ボクセルを探索
        for (const [dx, dy, dz] of FACE_DIRS) {
          const nk = `${cv.x + dx},${cv.y + dy},${cv.z + dz}`;
          if (posSet.has(nk) && !visited.has(nk)) { visited.add(nk); queue.push(nk); }
        }
      }
      components.push(component);
    }

    // 連結成分が1つなら問題なし
    if (components.length <= 1) continue;
    // 最大のクラスターを残し、小さいクラスターは再割り当て
    components.sort((a, b) => b.length - a.length);
    result[boneName] = components[0]; // 最大クラスターを保持
    for (let ci = 1; ci < components.length; ci++) {
      for (const v of components[ci]) {
        // まず隣接する他のボーンを探す
        let reassignTo: string | null = null;
        let reassignDist = Infinity;
        for (const [dx, dy, dz] of FACE_DIRS) {
          const nk = `${v.x + dx},${v.y + dy},${v.z + dz}`;
          const nb = globalMap.get(nk);
          if (nb && nb !== boneName) {
            for (const seg of segments) {
              if (seg.name !== nb) continue;
              const d = distToSegmentSq(v.x, v.y, v.z, seg.ax, seg.ay, seg.az, seg.bx, seg.by, seg.bz);
              if (d < reassignDist) { reassignDist = d; reassignTo = nb; }
            }
          }
        }
        // 隣接ボーンが見つからなければ、最も近いセグメントのボーンに割り当て
        if (!reassignTo) {
          let bestDist = Infinity;
          for (const seg of segments) {
            if (seg.name === boneName) continue;
            const d = distToSegmentSq(v.x, v.y, v.z, seg.ax, seg.ay, seg.az, seg.bx, seg.by, seg.bz);
            if (d < bestDist) { bestDist = d; reassignTo = seg.name; }
          }
        }
        if (reassignTo) {
          result[reassignTo].push(v);
          globalMap.set(`${v.x},${v.y},${v.z}`, reassignTo);
        }
      }
    }
  }
  return result;
}

// ========================================================================
// ボーン境界の球体キャップ
// 隣接する2つのボーンの境界面に球状のボクセルを追加し、
// アニメーション時にボーン間の隙間が見えないようにする
// ========================================================================
export function addSphereCaps(boneVoxels: Record<string, VoxelEntry[]>): void {
  // 各ボーンのボクセルを座標→VoxelEntryのマップに変換
  const boneMaps = new Map<string, Map<string, VoxelEntry>>();
  for (const [boneName, voxels] of Object.entries(boneVoxels)) {
    const m = new Map<string, VoxelEntry>();
    for (const v of voxels) m.set(`${v.x},${v.y},${v.z}`, v);
    boneMaps.set(boneName, m);
  }

  // 処理済みのボーンペアを記録（同じペアを2回処理しない）
  const processedPairs = new Set<string>();
  // 追加するボクセルを一時保存（イテレーション中の変更を避けるため）
  const toAdd = new Map<string, VoxelEntry[]>();
  for (const name of Object.keys(boneVoxels)) toAdd.set(name, []);

  for (const [boneName] of Object.entries(boneVoxels)) {
    const thisMap = boneMaps.get(boneName)!;
    // 隣接する他ボーンとの境界ボクセルをグループ化
    const adjBoundary = new Map<string, Map<string, VoxelEntry>>();
    for (const [k, v] of thisMap) {
      for (const [dx, dy, dz] of FACE_DIRS) {
        const nk = `${v.x + dx},${v.y + dy},${v.z + dz}`;
        if (thisMap.has(nk)) continue; // 同じボーン内の隣接は無視
        for (const [otherName, otherMap] of boneMaps) {
          if (otherName !== boneName && otherMap.has(nk)) {
            // 他ボーンのボクセルが隣接 → 境界として記録
            if (!adjBoundary.has(otherName)) adjBoundary.set(otherName, new Map());
            adjBoundary.get(otherName)!.set(k, v);
            break;
          }
        }
      }
    }

    // 各隣接ボーンペアについて球体キャップを生成
    for (const [otherName, thisBnd] of adjBoundary) {
      // ペアキーでソートして重複処理を防止
      const pairKey = [boneName, otherName].sort().join('|');
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);

      const otherMap = boneMaps.get(otherName)!;
      // 相手側の境界ボクセルを検出
      const otherBnd = new Map<string, VoxelEntry>();
      for (const [, v] of otherMap) {
        for (const [dx, dy, dz] of FACE_DIRS) {
          const nk = `${v.x + dx},${v.y + dy},${v.z + dz}`;
          if (thisMap.has(nk)) { otherBnd.set(`${v.x},${v.y},${v.z}`, v); break; }
        }
      }

      // 両側の境界ボクセルの重心を計算
      let tx = 0, ty = 0, tz = 0;
      for (const v of thisBnd.values()) { tx += v.x; ty += v.y; tz += v.z; }
      tx /= thisBnd.size; ty /= thisBnd.size; tz /= thisBnd.size;

      let ox = 0, oy = 0, oz = 0;
      for (const v of otherBnd.values()) { ox += v.x; oy += v.y; oz += v.z; }
      ox /= otherBnd.size; oy /= otherBnd.size; oz /= otherBnd.size;

      // 中間点と法線（2つの重心を結ぶ方向）を計算
      const mx = (tx + ox) / 2, my = (ty + oy) / 2, mz = (tz + oz) / 2;
      const ndx = ox - tx, ndy = oy - ty, ndz = oz - tz;
      const nLen = Math.sqrt(ndx * ndx + ndy * ndy + ndz * ndz) || 1;
      const nnx = ndx / nLen, nny = ndy / nLen, nnz = ndz / nLen; // 正規化法線

      // 球体の半径を決定（境界ボクセルの最大距離の半分）
      let maxDistSq = 0;
      for (const v of thisBnd.values()) {
        const dsq = (v.x - mx) ** 2 + (v.y - my) ** 2 + (v.z - mz) ** 2;
        if (dsq > maxDistSq) maxDistSq = dsq;
      }
      for (const v of otherBnd.values()) {
        const dsq = (v.x - mx) ** 2 + (v.y - my) ** 2 + (v.z - mz) ** 2;
        if (dsq > maxDistSq) maxDistSq = dsq;
      }
      const radius = Math.max(1, Math.sqrt(maxDistSq) / 2);
      const radiusSq = radius * radius;
      const ri = Math.ceil(radius); // 探索範囲（整数）

      // 境界ボクセル全体（色のサンプリング用）
      const allBnd = [...thisBnd.values(), ...otherBnd.values()];
      // 球体領域内の各座標をチェック
      for (let sx = -ri; sx <= ri; sx++) {
        for (let sy = -ri; sy <= ri; sy++) {
          for (let sz = -ri; sz <= ri; sz++) {
            const vx = Math.round(mx) + sx;
            const vy = Math.round(my) + sy;
            const vz = Math.round(mz) + sz;
            // 球体の外なら無視
            if ((vx - mx) ** 2 + (vy - my) ** 2 + (vz - mz) ** 2 > radiusSq) continue;

            const k = `${vx},${vy},${vz}`;
            // 最も近い境界ボクセルの色を使用
            let nearestDist = Infinity;
            let nearestColor = { r: 0.5, g: 0.5, b: 0.5 };
            for (const bv of allBnd) {
              const d = (vx - bv.x) ** 2 + (vy - bv.y) ** 2 + (vz - bv.z) ** 2;
              if (d < nearestDist) { nearestDist = d; nearestColor = { r: bv.r, g: bv.g, b: bv.b }; }
            }
            const entry: VoxelEntry = { x: vx, y: vy, z: vz, r: nearestColor.r, g: nearestColor.g, b: nearestColor.b };

            // 法線方向への射影で、どちら側のボーンに追加するか決定
            // depthProj > 0: 相手側の領域 → 自分側のキャップとして追加
            // depthProj <= 0: 自分側の領域 → 相手側のキャップとして追加
            const depthProj = (vx - mx) * nnx + (vy - my) * nny + (vz - mz) * nnz;
            if (depthProj > 0) {
              if (!thisMap.has(k)) toAdd.get(boneName)!.push(entry);
            } else {
              if (!otherMap.has(k)) toAdd.get(otherName)!.push(entry);
            }
          }
        }
      }
    }
  }

  // 計算した追加ボクセルを各ボーンに適用
  for (const [boneName, addVoxels] of toAdd) {
    if (addVoxels.length > 0) boneVoxels[boneName].push(...addVoxels);
  }
}

// ========================================================================
// Unlitシェーダーマテリアル（ライティングなしで頂点カラーをそのまま表示）
// ボクセルメッシュの描画に使用する
// ========================================================================
export function createUnlitMaterial(scene: Scene, name: string): ShaderMaterial {
  // 頂点シェーダー: 位置変換と頂点カラーの受け渡し
  Effect.ShadersStore[name + 'VertexShader'] = `
    precision highp float;
    attribute vec3 position;       // 頂点位置
    attribute vec4 color;          // 頂点カラー（RGBA）
    uniform mat4 worldViewProjection; // モデル・ビュー・プロジェクション行列
    varying vec4 vColor;           // フラグメントシェーダーへ渡す色
    void main() { gl_Position = worldViewProjection * vec4(position, 1.0); vColor = color; }
  `;
  // フラグメントシェーダー: 頂点カラーをそのまま出力（ライティング計算なし）
  Effect.ShadersStore[name + 'FragmentShader'] = `
    precision highp float;
    varying vec4 vColor;
    void main() { gl_FragColor = vColor; }
  `;
  // ShaderMaterialを作成して設定
  const mat = new ShaderMaterial(name, scene, { vertex: name, fragment: name }, {
    attributes: ['position', 'color'], uniforms: ['worldViewProjection'],
    needAlphaBlending: false, // アルファブレンディング不要
  });
  mat.backFaceCulling = false;  // 裏面も描画
  mat.forceDepthWrite = true;   // 深度書き込みを強制
  return mat;
}

// ========================================================================
// メッシュビルダー
// ========================================================================

// ボーンローカル座標系でボクセルメッシュを構築する
// voxels: このボーンに属するボクセル配列
// cx, cy: グリッド中心座標
// bonePos: このボーンの位置（メッシュ頂点をボーン位置からの相対座標にするため）
function buildBoneMeshLocal(
  voxels: VoxelEntry[], scene: Scene, name: string,
  cx: number, cy: number, bonePos: Vec3,
): Mesh {
  // ボーン位置をビューワー座標に変換（頂点のオフセット量として使用）
  const boneViewX = (bonePos.x - cx) * SCALE;
  const boneViewY = bonePos.z * SCALE;
  const boneViewZ = -(bonePos.y - cy) * SCALE;

  // 隣接ボクセルの有無でフェイスカリング用のセットを構築
  const occupied = new Set<string>();
  for (const v of voxels) occupied.add(`${v.x},${v.y},${v.z}`);
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], indices: number[] = [];
  for (const voxel of voxels) {
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = FACE_DIRS[f];
      // 隣にボクセルがある面は描画しない
      if (occupied.has(`${voxel.x + dx},${voxel.y + dy},${voxel.z + dz}`)) continue;
      const bi = positions.length / 3; // 現在の頂点インデックスベース
      const fv = FACE_VERTS[f], fn = FACE_NORMALS[f];
      for (let vi = 0; vi < 4; vi++) {
        // ボクセルのワールド位置からボーン位置を引いて、ボーンローカル座標にする
        // これによりボーンのTransformNodeが動くと、メッシュも一緒に動く
        positions.push(
          (voxel.x + fv[vi][0] - cx) * SCALE - boneViewX,
          (voxel.z + fv[vi][2]) * SCALE - boneViewY,
          -(voxel.y + fv[vi][1] - cy) * SCALE - boneViewZ,
        );
        // 法線をボクセル空間→ビューワー空間に変換
        normals.push(fn[0], fn[2], -fn[1]);
        // 頂点カラー（RGBA）
        colors.push(voxel.r, voxel.g, voxel.b, 1);
      }
      // 四角形を2つの三角形としてインデックスを追加
      indices.push(bi, bi + 1, bi + 2, bi, bi + 2, bi + 3);
    }
  }
  // VertexDataをメッシュに適用
  const vd = new VertexData();
  vd.positions = positions; vd.normals = normals; vd.colors = colors; vd.indices = indices;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  mesh.material = createUnlitMaterial(scene, name + '_unlit');
  return mesh;
}

/**
 * ボーン階層付きの完全なスケルタルボクセルキャラクターを構築する
 * TransformNode（アニメーション制御用）とMesh（描画用）のマップを返す
 * voxels: 全ボクセルデータ
 * bones: ボーン名→位置のマップ
 * scene: Babylon.jsシーン
 * cx, cy: グリッド中心座標
 * prefix: ノード名のプレフィックス（複数キャラ共存時の衝突防止）
 */
export function buildSkeletalCharacter(
  voxels: VoxelEntry[], bones: Record<string, Vec3>,
  scene: Scene, cx: number, cy: number,
  prefix: string = 'char',
): { nodes: Map<string, TransformNode>; meshes: Map<string, Mesh> } {
  // 全ボクセルをボーンに割り当てて、境界にスフィアキャップを追加
  const boneVoxels = assignVoxelsToBones(voxels, bones);
  addSphereCaps(boneVoxels);

  const nodes = new Map<string, TransformNode>();
  const meshes = new Map<string, Mesh>();

  // 第1パス: 全ボーンのTransformNodeを生成
  for (const boneDef of BONE_DEFS) {
    const bonePos = bones[boneDef.name];
    if (!bonePos) continue;
    const node = new TransformNode(`${prefix}_bone_${boneDef.name}`, scene);
    nodes.set(boneDef.name, node);
  }

  // 第2パス: 親子関係と相対位置を設定
  for (const boneDef of BONE_DEFS) {
    const node = nodes.get(boneDef.name);
    const bonePos = bones[boneDef.name];
    if (!node || !bonePos) continue;
    const viewPos = voxelToViewer(bonePos.x, bonePos.y, bonePos.z, cx, cy);

    if (boneDef.parent) {
      const parentNode = nodes.get(boneDef.parent);
      const parentPos = bones[boneDef.parent];
      if (parentNode && parentPos) {
        // 親ノードを設定し、位置を親からの相対座標にする
        node.parent = parentNode;
        const parentViewPos = voxelToViewer(parentPos.x, parentPos.y, parentPos.z, cx, cy);
        node.position = viewPos.subtract(parentViewPos);
      } else {
        node.position = viewPos; // 親が見つからなければ絶対位置
      }
    } else {
      node.position = viewPos; // ルートボーンは絶対位置
    }
  }

  // 第3パス: 各ボーンのボクセルメッシュを構築してノードに接続
  for (const boneDef of BONE_DEFS) {
    const bv = boneVoxels[boneDef.name];
    const node = nodes.get(boneDef.name);
    const bonePos = bones[boneDef.name];
    if (!bv || bv.length === 0 || !node || !bonePos) continue;

    // ボーンローカル座標のメッシュを構築
    const mesh = buildBoneMeshLocal(bv, scene, `${prefix}_${boneDef.name}`, cx, cy, bonePos);
    mesh.parent = node;       // メッシュをボーンノードの子に設定
    mesh.isPickable = false;  // マウスピック対象外に設定
    meshes.set(boneDef.name, mesh);
  }

  return { nodes, meshes };
}

// ========================================================================
// モーションクリップの型定義
// ========================================================================

// 1フレーム中の1ボーンのアニメーションデータ
export interface BoneFrameData {
  dq: [number, number, number, number]; // デルタクォータニオン [x,y,z,w]（ワールド空間、Three.js座標系）
  dp?: [number, number, number];        // デルタポジション [x,y,z]（ワールド空間、Three.js座標系。Hipsのみ使用）
}

// モーションクリップ全体のデータ
export interface MotionClip {
  name: string;            // モーション識別名
  label: string;           // UI表示用ラベル
  duration: number;        // 再生時間（秒）
  fps: number;             // フレームレート
  frameCount: number;      // 総フレーム数
  fbxBodyHeight: number;   // FBXのHips→Head距離（スケーリング計算用）
  outputBones: string[];   // 出力対象のボーン名リスト
  bindWorldPositions?: Record<string, [number, number, number]>; // FBXバインドポーズのワールド座標
  frames: Record<string, BoneFrameData>[]; // フレーム配列（各フレームはボーン名→データのマップ）
}

/**
 * URLからモーションクリップJSONを非同期読み込みする
 * url: モーションJSONファイルのURL
 * name: モーション識別名
 * label: UI表示用ラベル
 */
export async function loadMotionClipFromFile(url: string, name: string, label: string): Promise<MotionClip> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load ${url}`);
  const data = await resp.json();
  return {
    name, label,
    duration: data.duration,
    fps: data.fps,
    frameCount: data.frameCount,
    fbxBodyHeight: data.fbxBodyHeight || 2.854, // デフォルト値はMixamo標準キャラの高さ
    outputBones: data.outputBones || [],
    bindWorldPositions: data.bindWorldPositions,
    frames: data.frames,
  };
}

/**
 * Three.jsのクォータニオンをビューワー座標系に変換する
 * Three.js座標系: X=右, Y=上, Z=手前（右手系）
 * ビューワー座標系: X=右, Y=上, Z=奥（左手系、Babylon.js）
 * 変換: q_viewer = (x, -y, -z, w)
 * dq: Three.js空間のクォータニオン [x, y, z, w]
 */
export function threeQuatToViewer(dq: [number, number, number, number]): Quaternion {
  return new Quaternion(dq[0], -dq[1], -dq[2], dq[3]);
}

/**
 * ボーン階層の深さを取得する（UIのインデント表示用）
 * boneName: 深さを調べるボーン名
 * 戻り値: ルートからの階層深さ（Hips=0, Spine=1, Spine1=2, ...）
 */
export function getBoneDepth(boneName: string): number {
  let depth = 0;
  let current = BONE_DEFS.find(b => b.name === boneName);
  // 親を辿ってルートまでの深さをカウント
  while (current?.parent) {
    depth++;
    current = BONE_DEFS.find(b => b.name === current!.parent);
  }
  return depth;
}
