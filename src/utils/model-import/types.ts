import type { PartCategory } from '@/utils/auto-rigger';

/** ワークフローの4ステップ */
export type Step = 'upload' | 'parts' | 'markers' | 'result';

/** 各メッシュパーツの設定情報 */
export interface PartConfig {
  category: PartCategory;  // カテゴリ（body/hair/clothing/other/exclude）
  meshName: string;        // 元のメッシュ名
  vertexCount: number;     // 頂点数（UI表示用）
  visible: boolean;        // 3Dビューでの表示/非表示
}
