// アプリケーション全体のメタデータを定義するオブジェクト
export const metadata = {
  // ブラウザのタブに表示されるページタイトルを設定
  title: 'Motion Editor',
};

// ルートレイアウトコンポーネント（全ページ共通のHTML構造を定義する）
// children: 各ページのコンテンツがここに渡される
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // html要素にlang属性を日本語（ja）に設定
    <html lang="ja">
      {/* body要素の中に子コンポーネント（各ページの内容）を描画する */}
      <body>{children}</body>
    </html>
  );
}
