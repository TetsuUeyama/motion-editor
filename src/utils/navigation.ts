/** ナビゲーション用のページ定義 */
export interface NavPage {
  href: string;
  title: string;
  desc: string;
}

export const NAV_PAGES: NavPage[] = [
  { href: '/bone-config', title: 'Bone Config', desc: 'ボクセルキャラクターのボーン設定・モーション再生' },
  { href: '/model-import', title: 'Model Import', desc: '3Dモデル読み込み・パーツ分類・ボクセル化' },
  { href: '/character-viewer', title: 'Character Viewer', desc: 'character-config.jsonの3Dボディメッシュ表示' },
];
