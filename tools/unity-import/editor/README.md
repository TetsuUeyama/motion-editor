# MotionEditor Unity Editor Extension

Unity プロジェクト側にコピーして使う、Babylon.js 連携用のアセット・エクスポータ。

## インストール

1. Unity プロジェクトの `Assets/MotionEditor/Editor/` を作って、このフォルダ
   (`tools/unity-import/editor/`) のファイルを **すべてコピー** する。
2. Package Manager から **UnityGLTF** (`org.khronos.unitygltf`) をインストール
   (Add package from git URL: `https://github.com/KhronosGroup/UnityGLTF.git`)。
3. Unity 2021.3 LTS 以降推奨。

`MotionEditor.Editor.asmdef` には UnityGLTF への version define が入っているので、
インストールすると自動的に `MOTION_EDITOR_HAS_UNITYGLTF` が立って GLB 出力が
有効になる。未インストールでは Animator JSON と BoneMapping JSON のみ出力される。

> **注意**: `references` の `GUID:0d9d9b3c1ff6c1547b3f04cc5a2bac7b` は UnityGLTF
> のランタイム asmdef の GUID。別のフォークなどでズレた場合は、自プロジェクトの
> `UnityGLTF.Runtime.asmdef` の GUID で書き換えること。

## 出力されるもの

任意の出力ディレクトリ `<out>/` に対して、選択されたアセットごとに

```
<out>/
  <asset-id>/
    <asset-id>.glb          # メッシュ + AnimationClip (UnityGLTF 経由)
    bone-mapping.json       # Humanoid Avatar のみ。標準名 ↔ FBX ボーン名
    animator.json           # AnimatorController 単体エクスポート時のみ
  assets-manifest.json      # 全エクスポート結果のインデックス
```

`<asset-id>` は元アセット名を slug 化したもの。

## 使い方

### A. メニューから

Project Window で Prefab / Model / AnimatorController を選択し、
`Tools > MotionEditor > Export Selected Assets...`

### B. コマンドラインから（CI / CLI 統合）

```bash
"<UnityEditor>" -batchmode -nographics -quit \
  -projectPath /path/to/UnityProject \
  -executeMethod MotionEditor.BatchExporter.ExportFromCommandLine \
  -motionEditorOutput /path/to/motion-editor/public/assets \
  -motionEditorAssets "Assets/Models/Hero.fbx,Assets/Animations/HeroController.controller"
```

`-motionEditorAssets` を省略すると `Assets/` 以下の全 Prefab / Model / Controller が対象になる。

このコマンドは Phase 4 で作る Node CLI (`npm run import:unity`) からも呼び出される。

## 制限事項 (MVP)

- AnimatorController は **State / Transition / 4種パラメータ** のみ。BlendTree / SubStateMachine / Layer Mask / IK は未対応。
- Humanoid Avatar からのボーンマッピングのみ自動生成。Generic リグはマッピング JSON を手動で書く。
- マテリアルは UnityGLTF の変換に依存 (Standard / URP Lit はだいたい OK、HDRP は未検証)。
