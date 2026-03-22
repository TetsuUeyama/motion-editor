// Next.jsのサーバー側API用の型をインポート
// NextRequest: 受信したHTTPリクエストの情報を持つオブジェクト
// NextResponse: HTTPレスポンスを組み立てて返すためのオブジェクト
import { NextRequest, NextResponse } from 'next/server';
// Node.jsの標準モジュール: ファイルの読み書きを行う
import fs from 'fs';
// Node.jsの標準モジュール: ファイルパスの結合・解決を行う
import path from 'path';

// アセットファイルが置かれているディレクトリのルートパス
// 環境変数 GAME_ASSETS_DIR が設定されていればそれを使い、
// 未設定の場合はデフォルトのローカルパスを使用する
const ASSETS_BASE = process.env.GAME_ASSETS_DIR || 'C:\\Users\\user\\developsecond\\game-assets';

// パスの各セグメント（フォルダ名やファイル名）に使える文字を制限する正規表現
// 英数字、ドット、アンダースコア、ハイフン、スペースのみ許可
// これにより「../」等を使ったディレクトリトラバーサル攻撃を防止する
const SAFE_SEGMENT = /^[a-zA-Z0-9._\- ]+$/;

// 拡張子とHTTPレスポンスのContent-Typeヘッダの対応表
// ここに記載されていない拡張子のファイルは配信を拒否する
const CONTENT_TYPES: Record<string, string> = {
  '.vox': 'application/octet-stream',   // MagicaVoxelボクセルファイル（バイナリ）
  '.json': 'application/json',           // JSONファイル（モーションクリップ等）
  '.fbx': 'application/octet-stream',    // FBX 3Dモデルファイル（バイナリ）
};

// GETリクエストを処理するハンドラ関数
// Next.js App Routerの規約で、exportされたGET関数がHTTP GETに対応する
// URLの例: /api/game-assets/motion/Hip Hop Dancing.motion.json
//          → segments = ['motion', 'Hip Hop Dancing.motion.json']
export async function GET(
  _request: NextRequest, // リクエストオブジェクト（この関数では使わないので_で明示）
  { params }: { params: Promise<{ path: string[] }> } // [...path]キャッチオールルートから取得したパス配列
) {
  // URLのキャッチオールセグメントを取得する
  // 例: /api/game-assets/motion/walk.json → segments = ['motion', 'walk.json']
  const { path: segments } = await params;

  // セキュリティチェック第1段階: 各セグメントが安全な文字のみで構成されているか確認
  // 「..」によるディレクトリトラバーサルや、特殊文字によるパスインジェクションを防ぐ
  for (const seg of segments) {
    if (!SAFE_SEGMENT.test(seg) || seg === '..') {
      // 不正なセグメントが含まれていたら400 Bad Requestを返す
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }
  }

  // セグメントをベースディレクトリと結合して実際のファイルパスを組み立てる
  // 例: 'C:\Users\user\...\game-assets' + 'motion' + 'walk.json'
  const filePath = path.join(ASSETS_BASE, ...segments);
  // path.resolveで絶対パスに正規化する（シンボリックリンク等も解決）
  const resolved = path.resolve(filePath);
  // セキュリティチェック第2段階: 解決後のパスがベースディレクトリ内に収まっているか確認
  // path.joinだけでは巧妙なパスで突破される可能性があるため、resolveした結果を検証する
  if (!resolved.startsWith(path.resolve(ASSETS_BASE))) {
    // ベースディレクトリ外へのアクセスは400 Bad Requestで拒否
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  // ファイルが実際に存在するか確認する
  if (!fs.existsSync(resolved)) {
    // 存在しなければ404 Not Foundを返す
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // ファイルの拡張子を取得して小文字に統一する（例: '.JSON' → '.json'）
  const ext = path.extname(resolved).toLowerCase();
  // 拡張子に対応するContent-Typeを引く
  const contentType = CONTENT_TYPES[ext];
  // 許可リストにない拡張子の場合は配信を拒否する
  if (!contentType) {
    // 403 Forbiddenを返す（.exe等の危険なファイルの配信を防ぐ）
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 403 });
  }

  // ファイルをバイナリとして同期的に読み込む
  const data = fs.readFileSync(resolved);
  // HTTPレスポンスを組み立てて返す
  return new NextResponse(data, {
    headers: {
      'Content-Type': contentType,                // ファイル形式に応じたMIMEタイプ
      'Cache-Control': 'public, max-age=3600',    // ブラウザに1時間キャッシュさせる
    },
  });
}
