/**
 * auto-rigger barrel export
 * Re-exports everything for backward compatibility
 */

// Types
export type { MarkerGroup, PartCategory, DeformParams, SkeletalModelExport, SegmentBundleExport, SegmentsInfoExport, ContactMotionExport } from './types';

// Constants and classification
export { CATEGORY_INFO, PART_CATEGORIES, guessCategory, BODY_SIZE, VSCALE, TARGET_MARKERS, MARKER_GROUPS, ALL_MARKER_NAMES, getMarkerColor, MIRROR_PAIRS } from './constants';

// Voxelization
export { mergeVoxelLayers, worldToVoxel, piecewiseLinear, lerp3, uniformChibiVoxelize } from './voxelize';

// Bone calculation
export { calculateTargetBones } from './bones';

// Mesh
export { buildFlatVoxelMesh } from './mesh';

// Exports
export { exportVoxBlob } from './export-vox';
export { exportSkeletalModelJSON } from './export-skeletal';
export { exportSegmentsBundle, exportSegmentsInfo } from './export-segments';
export { exportSkinnedGLB } from './export-glb';
export { convertMotionToContactFormat } from './export-motion';

// Re-export from voxel-core (backward compat)
export {
  type VoxelEntry, type Vec3, type BoneDef, type BoneFrameData, type MotionClip,
  BONE_DEFS, FACE_DIRS, FACE_VERTS, FACE_NORMALS,
  voxelToViewer, threeQuatToViewer, distToSegSq,
  assignVoxelsToBones, addSphereCaps,
  createUnlitMaterial, buildSkeletalCharacter,
} from '@/utils/voxel-core';

// Re-export loadMotionClip from voxel-skeleton (backward compat)
export { loadMotionClipFromFile as loadMotionClip } from '@/utils/voxel-skeleton';
