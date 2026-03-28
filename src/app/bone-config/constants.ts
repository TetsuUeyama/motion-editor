/**
 * bone-config ページ固有の定数・型定義・ヘルパー関数
 * ページコンポーネントから分離して管理する
 */

import { Scene, Mesh, VertexData, Vector3 } from '@babylonjs/core';
import { SCALE, FACE_DIRS, FACE_VERTS, FACE_NORMALS } from '@/lib/vox-parser';
import type { VoxelEntry } from '@/lib/vox-parser';
import { type Vec3, createUnlitMaterial } from '@/lib/voxel-skeleton';

// ========================================================================
// マーカー定義
// ユーザーがボクセルモデル上に配置する解剖学的マーカー（顎、手首、肘、膝、股間）
// これらのマーカー位置から全41ボーンの位置を自動計算する
// ========================================================================

// マーカー1つの定義情報
export interface MarkerDef {
  name: string;       // マーカーの識別名（例: "Chin", "LeftWrist"）
  label: string;      // UI表示用ラベル（日本語併記）
  color: string;      // マーカー球体の色（16進カラーコード）
  side: 'center' | 'left' | 'right'; // center=中央（単体）, left/right=左右対称ペア
  mirrorOf?: string;  // right側マーカーのみ: ミラー元のleft側マーカー名
}

// 8つのマーカー定義（中央2つ + 左3つ + 右3つ）
// 左右対称モード時は左側のみ配置し、右側は自動ミラーされる
export const MARKER_DEFS: MarkerDef[] = [
  { name: 'Chin',        label: 'Chin (顎)',          color: '#ffee44', side: 'center' },  // 顎（頭部の基準点）
  { name: 'Groin',       label: 'Groin (股間)',        color: '#ff4444', side: 'center' },  // 股間（体幹と脚の分岐点）
  { name: 'LeftWrist',   label: 'L.Wrist (左手首)',    color: '#4444ff', side: 'left' },    // 左手首
  { name: 'LeftElbow',   label: 'L.Elbow (左肘)',      color: '#4488ff', side: 'left' },    // 左肘
  { name: 'LeftKnee',    label: 'L.Knee (左膝)',       color: '#44ff66', side: 'left' },    // 左膝
  { name: 'RightWrist',  label: 'R.Wrist (右手首)',    color: '#ff4466', side: 'right', mirrorOf: 'LeftWrist' },  // 右手首（左手首のミラー）
  { name: 'RightElbow',  label: 'R.Elbow (右肘)',      color: '#ff4488', side: 'right', mirrorOf: 'LeftElbow' },  // 右肘（左肘のミラー）
  { name: 'RightKnee',   label: 'R.Knee (右膝)',       color: '#88ff44', side: 'right', mirrorOf: 'LeftKnee' },   // 右膝（左膝のミラー）
];

// ========================================================================
// 固定カメラビュー定義
// 正面・右・背面・左の4方向から、マーカーのドラッグ操作時に
// どの軸が編集可能かを定義する
// ========================================================================

// カメラビュー方向の識別型
export type ViewDirection = 'front' | 'right' | 'back' | 'left';

// カメラビュー1つの定義情報
export interface ViewDef {
  key: ViewDirection;              // ビュー方向の識別キー
  label: string;                   // UI表示用ラベル（日本語）
  alpha: number;                   // カメラの水平回転角度（ラジアン）
  dragAxes: ('x' | 'y' | 'z')[];  // このビューでドラッグ編集可能な軸
  axisLabels: string;              // 軸の説明テキスト
}

// 4方向のビュー定義
export const VIEW_DEFS: ViewDef[] = [
  { key: 'front', label: '正面',  alpha: Math.PI / 2,     dragAxes: ['x', 'z'], axisLabels: 'X(左右) + Z(高さ)' },
  { key: 'right', label: '右',    alpha: 0,               dragAxes: ['y', 'z'], axisLabels: 'Y(前後) + Z(高さ)' },
  { key: 'back',  label: '背面',  alpha: Math.PI * 3 / 2, dragAxes: ['x', 'z'], axisLabels: 'X(左右) + Z(高さ)' },
  { key: 'left',  label: '左',    alpha: Math.PI,         dragAxes: ['y', 'z'], axisLabels: 'Y(前後) + Z(高さ)' },
];

// ========================================================================
// モーションファイル一覧
// /models/character-motion/ ディレクトリのMixamoモーションクリップ
// ========================================================================
export const MOTION_FILES: { name: string; label: string; file: string }[] = [
  { name: 'hip_hop', label: 'Hip Hop Dancing', file: '/models/character-motion/Hip Hop Dancing.motion.json' },
  { name: 'belly_dance', label: 'Belly Dance', file: '/models/character-motion/Belly Dance.motion.json' },
  { name: 'jump', label: 'Jump', file: '/models/character-motion/Jump.motion.json' },
  { name: 'martelo', label: 'Martelo 3', file: '/models/character-motion/Martelo 3.motion.json' },
  { name: 'mma_kick', label: 'MMA Kick', file: '/models/character-motion/Mma Kick.motion.json' },
  { name: 'roundhouse', label: 'Roundhouse Kick', file: '/models/character-motion/Roundhouse Kick.motion.json' },
  { name: 'snake_hip_hop', label: 'Snake Hip Hop', file: '/models/character-motion/Snake Hip Hop Dance.motion.json' },
];

// ========================================================================
// その他の型定義
// ========================================================================

// 装備パーツの情報（髪、衣装等の追加ボクセルパーツ）
export interface EquipPart { key: string; file: string; default_on: boolean; voxels: number; }

// ページモード: edit=マーカー編集, preview=モーションプレビュー
export type PageMode = 'edit' | 'preview';

// クォータニオン変換方式の定義
// Three.js座標系（右手系）→ ビューワー座標系（左手系、Babylon.js）への変換
export type QuatConversion = 'correct' | 'conv1' | 'conv2' | 'identity';
export const QUAT_CONVERSIONS: { key: QuatConversion; label: string; desc: string }[] = [
  { key: 'correct',  label: '(x,-y,-z,w)',  desc: 'X-reflect (correct)' },
  { key: 'conv1',    label: '(-x,-y,z,w)',   desc: 'Z-flip only (old)' },
  { key: 'conv2',    label: '(x,y,-z,w)',    desc: 'Negate Z only' },
  { key: 'identity', label: '(x,y,z,w)',     desc: 'No conversion' },
];

// ========================================================================
// ヘルパー関数
// ========================================================================

// ボディ全体のボクセルメッシュを構築する（非スケルタル、プレビュー用）
// alpha: 透明度（0-1。モーションプレビュー時に半透明にする用）
export function buildBodyMesh(voxels: VoxelEntry[], scene: Scene, cx: number, cy: number, alpha: number): Mesh {
  const occupied = new Set<string>();
  for (const v of voxels) occupied.add(`${v.x},${v.y},${v.z}`);
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], indices: number[] = [];
  for (const voxel of voxels) {
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = FACE_DIRS[f];
      if (occupied.has(`${voxel.x + dx},${voxel.y + dy},${voxel.z + dz}`)) continue;
      const bi = positions.length / 3;
      const fv = FACE_VERTS[f], fn = FACE_NORMALS[f];
      for (let vi = 0; vi < 4; vi++) {
        positions.push(
          (voxel.x + fv[vi][0] - cx) * SCALE,
          (voxel.z + fv[vi][2]) * SCALE,
          -(voxel.y + fv[vi][1] - cy) * SCALE,
        );
        normals.push(fn[0], fn[2], -fn[1]);
        colors.push(voxel.r * 0.6, voxel.g * 0.6, voxel.b * 0.6, alpha);
      }
      indices.push(bi, bi + 1, bi + 2, bi, bi + 2, bi + 3);
    }
  }
  const vd = new VertexData();
  vd.positions = positions; vd.normals = normals; vd.colors = colors; vd.indices = indices;
  const mesh = new Mesh('body', scene);
  vd.applyToMesh(mesh);
  mesh.material = createUnlitMaterial(scene, 'body_unlit');
  mesh.isPickable = false;
  return mesh;
}

// ビューワー座標→ボクセル座標への逆変換（マーカードラッグ時に使用）
export function viewerToVoxel(viewerPos: Vector3, cx: number, cy: number): Vec3 {
  return {
    x: viewerPos.x / SCALE + cx,
    y: -(viewerPos.z / SCALE) + cy,
    z: viewerPos.y / SCALE,
  };
}

// 数値を小数第1位に丸める（UI表示用）
export function r1(n: number): number { return Math.round(n * 10) / 10; }
