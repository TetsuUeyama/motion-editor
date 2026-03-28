/**
 * auto-rigger type definitions, constants and classification helpers
 */

import type { Vec3 } from '@/utils/voxelize/core';

// ============================================================
// Type definitions
// ============================================================

// MarkerGroup (UI display: label, marker names, color)
export interface MarkerGroup { label: string; names: string[]; color: string; }

// Part classification
export type PartCategory = 'body' | 'hair' | 'clothing' | 'other' | 'exclude';

// Deformation parameters (voxelization and bone calculation shared)
export interface DeformParams {
  srcH: number[]; tgtH: number[];
  srcWD: number[]; tgtWD: number[];
  baseScale: number; centerX: number; centerZ: number;
  footY: number; bH: number;
}

// Skeletal model JSON export format
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

// contactform-compatible segments bundle export format
export interface SegmentBundleExport {
  grid: { gx: number; gy: number; gz: number };
  palette: number[][];            // [[r,g,b], ...] normalized 0-1
  segments: Record<string, number[]>; // boneName -> flat [x,y,z,colorIndex, ...]
}

// contactform-compatible segments info export format
export interface SegmentsInfoExport {
  voxel_size: number;
  grid: { gx: number; gy: number; gz: number };
  bone_positions: Record<string, { head_voxel: number[]; tail_voxel: number[] }>;
  segments: Record<string, { file: string; voxels: number }>;
}

// Contact motion export format
export interface ContactMotionExport {
  fps: number;
  frame_count: number;
  babylonFormat: true;
  bones: Record<string, { matrices: number[][] }>;
}

// ============================================================
// Constants and classification helpers
// ============================================================

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

export const BODY_SIZE = { x: 85, y: 34, z: 102 };
// VSCALE は voxel-core.ts の VOXEL_SCALE からエイリアス (後方互換)
export { VOXEL_SCALE as VSCALE } from '@/utils/voxelize/core';

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

export const MIRROR_PAIRS: Record<string, string> = {
  RightWrist: 'LeftWrist', RightElbow: 'LeftElbow', RightKnee: 'LeftKnee',
};
