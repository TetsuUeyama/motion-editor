import { ALL_MARKER_NAMES } from '@/utils/auto-rigger';

// ============================================================
// モーション一覧（プレビュー確認用）
// game-assetsディレクトリから読み込まれるMixamoモーションクリップ
// ============================================================
export const MOTIONS = [
  { name: 'Hip Hop Dancing', label: 'Hip Hop Dancing' },
  { name: 'Belly Dance', label: 'Belly Dance' },
  { name: 'Jump', label: 'Jump' },
  { name: 'Mma Kick', label: 'MMA Kick' },
  { name: 'Roundhouse Kick', label: 'Roundhouse Kick' },
  { name: 'Snake Hip Hop Dance', label: 'Snake Hip Hop' },
];

export const MOTION_BASE = '/api/game-assets/motion';

// ユーザーが配置するマーカー（対称モード時は左側+中央のみ、右側は自動ミラー）
export const PLACEABLE_MARKERS = ['Chin', 'LeftWrist', 'LeftElbow', 'LeftKnee', 'Groin'];

// 非対称モード時は全8マーカーを手動配置
export const PLACEABLE_MARKERS_NO_SYM = ALL_MARKER_NAMES;
