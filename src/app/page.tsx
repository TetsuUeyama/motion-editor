// クライアントコンポーネントとして宣言（ブラウザ側で実行される）
'use client';

// Next.jsのLinkコンポーネントをインポート（ページ遷移用）
import Link from 'next/link';

// ナビゲーション用のページ一覧を配列で定義
const pages = [
  // ボーン設定ページ: パス、タイトル、説明文を持つオブジェクト
  { href: '/bone-config', title: 'Bone Config', desc: 'ボクセルキャラクターのボーン設定・モーション再生' },
  // モデルインポートページ: パス、タイトル、説明文を持つオブジェクト
  { href: '/model-import', title: 'Model Import', desc: '3Dモデル読み込み・パーツ分類・ボクセル化' },
];

// ホームページコンポーネント（トップページの表示を担当）
export default function Home() {
  return (
    // 外側のコンテナ: 画面全体を覆うダークネイビー背景のレイアウト
    <div style={{
      minHeight: '100vh', background: '#1a1a2e', color: '#fff',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '60px 20px',
    }}>
      {/* ページタイトル */}
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Motion Editor</h1>
      {/* サブタイトル（モジュール選択の案内テキスト） */}
      <p style={{ color: '#888', marginBottom: 40 }}>Select a module</p>
      {/* カード一覧のグリッドコンテナ（最小280px幅でレスポンシブ） */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 20, width: '100%', maxWidth: 700,
      }}>
        {/* ページ一覧をループし、各ページのナビゲーションカードを生成 */}
        {pages.map(p => (
          <Link key={p.href} href={p.href} style={{ textDecoration: 'none' }}>
            {/* カード本体: ホバー時にボーダーと背景色が変化する */}
            <div style={{
              background: '#252540', borderRadius: 12, padding: '24px 20px',
              border: '1px solid #333', cursor: 'pointer',
              transition: 'border-color 0.2s, background 0.2s',
            }}
            // マウスホバー時: ボーダーを青紫色に、背景をやや明るく変更
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#5566ff'; e.currentTarget.style.background = '#2a2a50'; }}
            // マウスが離れた時: ボーダーと背景を元の色に戻す
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.background = '#252540'; }}
            >
              {/* カードのタイトル: 青紫色の太字 */}
              <div style={{ fontSize: 18, fontWeight: 'bold', color: '#7788ff', marginBottom: 8 }}>{p.title}</div>
              {/* カードの説明文: 小さめのグレー文字 */}
              <div style={{ fontSize: 13, color: '#aaa', lineHeight: 1.5 }}>{p.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
