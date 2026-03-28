// MagicaVoxel (.vox) ファイルのパーサーと関連型定義

// VoxelEntry は voxel-core.ts で定義されている唯一の情報源からre-export
export type { VoxelEntry } from '@/utils/voxel-core';
import type { VoxelEntry } from '@/utils/voxel-core';

// VOXファイルをパースした結果のモデルデータ
export interface VoxModel {
  sizeX: number; sizeY: number; sizeZ: number;
  voxels: { x: number; y: number; z: number; colorIndex: number }[];
  palette: { r: number; g: number; b: number }[];
}

// VOXバイナリファイルをパースしてVoxModelを返す
// VOXフォーマット: https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox.txt
export function parseVox(buf: ArrayBuffer): VoxModel {
  const view = new DataView(buf);
  let offset = 0;
  // 4バイトの符号なし整数をリトルエンディアンで読む
  const readU32 = () => { const v = view.getUint32(offset, true); offset += 4; return v; };
  // 1バイトの符号なし整数を読む
  const readU8 = () => { const v = view.getUint8(offset); offset += 1; return v; };
  // 指定バイト数の文字列を読む（ASCII）
  const readStr = (n: number) => {
    let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(view.getUint8(offset + i));
    offset += n; return s;
  };
  // マジックナンバー "VOX " の確認（VOXファイルでなければエラー）
  if (readStr(4) !== 'VOX ') throw new Error('Not a VOX file');
  // バージョン番号を読み飛ばす（通常200）
  readU32();
  // グリッドサイズの初期値
  let sizeX = 0, sizeY = 0, sizeZ = 0;
  // パース結果のボクセル配列
  const voxels: VoxModel['voxels'] = [];
  // パレット（RGBAチャンクから読み込む。なければデフォルトを使用）
  let palette: VoxModel['palette'] | null = null;
  // チャンクを再帰的に読み込む関数
  const readChunks = (end: number) => {
    while (offset < end) {
      // チャンクID（4文字）、チャンク自体のサイズ、子チャンクの合計サイズ
      const id = readStr(4); const cs = readU32(); const ccs = readU32(); const ce = offset + cs;
      if (id === 'SIZE') {
        // SIZEチャンク: ボクセルグリッドの寸法（X, Y, Z）
        sizeX = readU32(); sizeY = readU32(); sizeZ = readU32();
      }
      else if (id === 'XYZI') {
        // XYZIチャンク: ボクセルデータ（個数 + 各ボクセルのx,y,z,colorIndex）
        const n = readU32();
        for (let i = 0; i < n; i++) voxels.push({ x: readU8(), y: readU8(), z: readU8(), colorIndex: readU8() });
      }
      else if (id === 'RGBA') {
        // RGBAチャンク: 256色パレット（各色4バイト: R,G,B,A）
        palette = [];
        for (let i = 0; i < 256; i++) {
          const r = readU8(), g = readU8(), b = readU8();
          readU8(); // Aは読み飛ばす
          // 0-255を0-1に正規化して格納
          palette.push({ r: r / 255, g: g / 255, b: b / 255 });
        }
      }
      // チャンク本体の末尾へ移動
      offset = ce;
      // 子チャンクがあれば再帰的に読み込む
      if (ccs > 0) readChunks(offset + ccs);
    }
  };
  // MAINチャンクの確認（VOXファイルのルートチャンク）
  if (readStr(4) !== 'MAIN') throw new Error('Expected MAIN');
  // MAINチャンク自体のサイズと子チャンクの合計サイズを読む
  const mc = readU32(); const mcc = readU32();
  // MAINチャンク本体を読み飛ばす（通常0バイト）
  offset += mc;
  // MAINの子チャンクを全て読み込む
  readChunks(offset + mcc);
  // パレットが含まれていなかった場合、デフォルトのグレーパレットを生成
  if (!palette) { palette = []; for (let i = 0; i < 256; i++) palette.push({ r: 0.8, g: 0.8, b: 0.8 }); }
  return { sizeX, sizeY, sizeZ, voxels, palette };
}

// URLからVOXファイルを非同期で読み込み、パースしてVoxModelとVoxelEntry配列を返す
export async function loadVoxFile(url: string): Promise<{ model: VoxModel; voxels: VoxelEntry[] }> {
  // キャッシュバスティング用のクエリパラメータを付与してフェッチ
  const resp = await fetch(url + `?v=${Date.now()}`);
  if (!resp.ok) throw new Error(`Failed: ${url} (${resp.status})`);
  // バイナリデータをパースしてVoxModelを取得
  const model = parseVox(await resp.arrayBuffer());
  // 各ボクセルのcolorIndexをパレットから実際のRGB値に変換
  // colorIndexは1始まり（0はパレット未使用）なので-1して参照する
  const voxels: VoxelEntry[] = model.voxels.map(v => {
    const col = model.palette[v.colorIndex - 1] ?? { r: 0.8, g: 0.8, b: 0.8 };
    return { x: v.x, y: v.y, z: v.z, r: col.r, g: col.g, b: col.b };
  });
  return { model, voxels };
}

// ボクセルメッシュ構築用の定数群

// SCALE は voxel-core.ts の VOXEL_SCALE からエイリアス (後方互換)
export { VOXEL_SCALE as SCALE } from '@/utils/voxel-core';

