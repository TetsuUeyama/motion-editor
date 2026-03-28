/**
 * auto-rigger barrel export
 * Re-exports everything for backward compatibility
 */

// Types
export type { MarkerGroup, PartCategory, DeformParams, SkeletalModelExport, SegmentBundleExport, SegmentsInfoExport, ContactMotionExport } from './constants';

// Constants and classification
export { CATEGORY_INFO, PART_CATEGORIES, guessCategory, BODY_SIZE, VSCALE, TARGET_MARKERS, MARKER_GROUPS, ALL_MARKER_NAMES, getMarkerColor, MIRROR_PAIRS } from './constants';

// Voxelization + bone calculation
export { mergeVoxelLayers, worldToVoxel, piecewiseLinear, lerp3, uniformChibiVoxelize, calculateTargetBones } from '@/utils/voxelize/chibi';

// Small exports (mesh, vox, skeletal, segments)
export { buildFlatVoxelMesh, exportVoxBlob, exportSkeletalModelJSON, exportSegmentsBundle, exportSegmentsInfo } from './exports';

// Large exports (kept as separate files)
export { exportSkinnedGLB } from './export-glb';
export { convertMotionToContactFormat } from './export-motion';

// Re-export from voxel-core (backward compat)
export {
  type VoxelEntry, type Vec3, type BoneDef, type BoneFrameData, type MotionClip,
  BONE_DEFS, FACE_DIRS, FACE_VERTS, FACE_NORMALS,
  voxelToViewer, threeQuatToViewer, distToSegSq,
  assignVoxelsToBones, addSphereCaps,
  createUnlitMaterial, buildSkeletalCharacter,
} from '@/utils/voxelize/core';

// Re-export loadMotionClip from voxel-skeleton (backward compat)
export { loadMotionClipFromFile as loadMotionClip } from '@/utils/voxelize/skeleton';
