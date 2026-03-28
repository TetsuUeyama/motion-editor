/**
 * auto-rigger constants and classification helpers
 */

import type { MarkerGroup, PartCategory } from './types';

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
export const VSCALE = 0.01;

import type { Vec3 } from '@/utils/voxel-core';

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
