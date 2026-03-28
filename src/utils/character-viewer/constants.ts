// ============================================================
// 型定義
// ============================================================
export interface BoneEntry { name: string; parent: string | null; worldPosition: [number, number, number]; }
export interface BodyPartDef { bone: string; childBone: string; size: [number, number, number]; thickness: number; skin?: boolean; }
export interface CharacterConfig { name: string; bodyParts: Record<string, BodyPartDef>; }
export interface BoneData { bones: BoneEntry[]; }
export interface GridVoxel { gx: number; gy: number; gz: number; r: number; g: number; b: number; }

// パーツ別ボクセルデータ
export interface PerBoneVoxels {
  boneNames: string[];                    // 検出されたボーン名一覧
  perBone: Record<string, GridVoxel[]>;   // ボーン名 → ボクセル配列
  allVoxels: GridVoxel[];                 // 全ボクセル（表示用）
}

export type BodyCategory = 'head' | 'torso' | 'arm' | 'hand' | 'leg' | 'foot';

export interface ScaleSettings {
  global: number; head: number; torso: number; arm: number; hand: number; leg: number; foot: number;
}

export interface AlignInfo { scale: number; tx: number; ty: number; tz: number; }

// ============================================================
// 定数
// ============================================================
export const VOXEL_SIZE = 0.012;
export const MIN_RADIUS = VOXEL_SIZE * 0.7;
export const SKIN_COLOR = { r: 0.85, g: 0.72, b: 0.60 };
export const BODY_COLOR = { r: 0.40, g: 0.50, b: 0.70 };

export const CATEGORY_LABELS: Record<BodyCategory, string> = {
  head: 'Head (頭)', torso: 'Torso (胴体)', arm: 'Arms (腕)',
  hand: 'Hands (手指)', leg: 'Legs (脚)', foot: 'Feet (足)',
};

export function getCategory(partName: string): BodyCategory {
  const n = partName.toLowerCase();
  if (n.includes('head') || n.includes('neck')) return 'head';
  if (n.includes('thumb') || n.includes('index') || n.includes('hand')) return 'hand';
  if (n.includes('shoulder') || n.includes('upper_arm') || n.includes('forearm') || n.includes('arm')) return 'arm';
  if (n.includes('toe') || n.includes('foot')) return 'foot';
  if (n.includes('thigh') || n.includes('shin') || n.includes('leg')) return 'leg';
  return 'torso';
}

export const DEFAULT_SCALES: ScaleSettings = { global: 1, head: 1, torso: 1, arm: 1, hand: 1, leg: 1, foot: 1 };
