// モデルレジストリ: bone-configやfbx-viewerで使用可能なボクセルモデルの一覧を管理する

// キャラクターの性別を表す型（モーション選択に影響する）
export type CharacterGender = 'male' | 'female';

// 1つのボクセルモデルの定義情報
export interface ModelEntry {
  id: string;           // モデルの一意識別子（URLパラメータ等で使用）
  label: string;        // UI上に表示するモデル名
  dir: string;          // /publicディレクトリ以下のフォルダ名（例: "box5"）
  bodyFile: string;     // ボディ用VOXファイルのパス（publicからの絶対パス）
  partsManifest: string; // パーツ一覧JSONファイルのパス（publicからの絶対パス）
  bodyKey: string;      // parts.json内でボディを識別するキー名
  gender: CharacterGender; // キャラクターの性別（モーション選択に影響）
}

// 利用可能なモデルの一覧（配列に追加することでモデルを増やせる）
export const MODEL_REGISTRY: ModelEntry[] = [
  // Vagrant: 男性キャラクター（box5フォルダ）
  {
    id: 'vagrant',
    label: 'Vagrant',
    dir: 'box5',
    bodyFile: '/box5/vagrant_rig_vagrant_body.vox',
    partsManifest: '/box5/vagrant_rig_parts.json',
    bodyKey: 'vagrant_body',
    gender: 'male',
  },
  // Cyberpunk Elf: 女性キャラクター（box2フォルダ）
  {
    id: 'cyberpunk_elf',
    label: 'Cyberpunk Elf',
    dir: 'box2',
    bodyFile: '/box2/cyberpunk_elf_body_base.vox',
    partsManifest: '/box2/cyberpunk_elf_parts.json',
    bodyKey: 'body',
    gender: 'female',
  },
  // Queen Marika: 女性キャラクター（box4-qmフォルダ）
  // parts.jsonにはボディキーがなく、全パーツが装備品扱い
  {
    id: 'queen_marika',
    label: 'Queen Marika',
    dir: 'box4-qm',
    bodyFile: '/box4/queenmarika_rigged_mustardui_body.vox',
    partsManifest: '/box4/queenmarika_rigged_mustardui_parts.json',
    bodyKey: 'body',
    gender: 'female',
  },
  // Dark Elf: 女性キャラクター（box4-deフォルダ）
  {
    id: 'dark_elf',
    label: 'Dark Elf',
    dir: 'box4-de',
    bodyFile: '/box4/darkelfblader_arp_body.vox',
    partsManifest: '/box4/darkelfblader_arp_parts.json',
    bodyKey: 'body',
    gender: 'female',
  },
];

// IDからモデル定義を検索する関数
// 見つからなければundefinedを返す
export function getModelById(id: string): ModelEntry | undefined {
  return MODEL_REGISTRY.find(m => m.id === id);
}

// アプリ起動時にデフォルトで選択されるモデルのID
export const DEFAULT_MODEL_ID = 'vagrant';
