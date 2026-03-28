/**
 * auto-rigger type definitions
 */

import type { Vec3 } from '@/utils/voxel-core';

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
