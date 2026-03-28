import type { PartCategory } from '@/utils/auto-rigger';
import { ALL_MARKER_NAMES } from '@/utils/auto-rigger';

// ============================================================
// 型定義
// ============================================================

/** ワークフローの4ステップ */
export type Step = 'upload' | 'parts' | 'markers' | 'result';

/** 各メッシュパーツの設定情報 */
export interface PartConfig {
  category: PartCategory;  // カテゴリ（body/hair/clothing/other/exclude）
  meshName: string;        // 元のメッシュ��
  vertexCount: number;     // 頂点数（UI表示用）
  visible: boolean;        // 3Dビューでの表示/非表示
}

// ============================================================
// 定数
// ============================================================

// モーション一覧（プレビュー確認用）
// game-assetsディレクトリから読み込まれるMixamoモーションクリップ
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
