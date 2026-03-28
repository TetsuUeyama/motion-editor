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
