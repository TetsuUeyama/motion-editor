# Unity → Babylon.js Asset Import

Unity プロジェクトの Prefab / Model / AnimatorController を、
Babylon.js で読める形 (GLB + JSON) に変換するパイプライン。

## 構成

```
tools/unity-import/
├── editor/          # Unity 側 C# スクリプト (asmdef + Exporters)
└── cli/             # Node.js 側 CLI (Unity を batchmode 起動)
```

詳細:
- Unity 側の手順: [editor/README.md](./editor/README.md)
- 出力フォーマット: `editor/Dto.cs` と `src/runtime/animator/types.ts` を参照

## クイックスタート

### 1. Unity プロジェクト側の準備

`UnityGLTF` パッケージ (`https://github.com/KhronosGroup/UnityGLTF.git`) を
Package Manager 経由でインストールしておく。

### 2. CLI 実行

```bash
npm run import:unity -- \
  --project /path/to/UnityProject \
  --out public/assets
```

これは:
1. Unity Editor 実行ファイルを自動検出 (Hub のインストール先を探索)
2. `tools/unity-import/editor/` を `<UnityProject>/Assets/MotionEditor/Editor/` にコピー
3. Unity を `-batchmode -nographics -quit` で起動し、`MotionEditor.BatchExporter.ExportFromCommandLine` を実行
4. `public/assets/<asset-id>/<asset-id>.glb` などを書き出し
5. `public/assets/assets-manifest.json` を生成

### 3. Babylon.js 側で読み込む

```ts
import { UnityAssetLoader } from "@/runtime";

const loader = new UnityAssetLoader();
const { animator } = await loader.load(scene, "hero");
animator?.setBool("isMoving", true);
```

## オプション

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `--project <dir>` | (必須) | Unity プロジェクトのルート |
| `--out <dir>` | `public/assets` | 出力先 |
| `--unity <path>` | 自動検出 / `UNITY_PATH` | Unity Editor 実行ファイル |
| `--assets <csv>` | 全件 | 対象アセットの Asset Database パスをカンマ区切り |
| `--no-sync` | off | Editor スクリプトの同期をスキップ (既に Unity 側で改造している時) |
| `--log-file <path>` | `<out>/.unity-import.log` | Unity の editor.log 出力先 |

## CI での使用

GitHub Actions など CI で動かす場合、Unity のライセンス活性化が別途必要 (game-ci などを利用)。
Unity 実行ファイルパスは `UNITY_PATH` 環境変数で指定するのが楽。

```yaml
- name: Import Unity assets
  env:
    UNITY_PATH: /opt/unityhub/editor/2022.3.55f1/Editor/Unity
  run: npm run import:unity -- --project unity-project
```
