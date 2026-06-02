# 再開用 引き継ぎ記録（Fighting Animset Pro → 3D 格闘ゲーム）

最終更新: 2026-05-31。次回はまずこのファイルを読めば状況を把握できる。

---

## 1. いまどこまで出来ているか（ひとことで）
Kubold **Fighting Animset Pro (FAP)** を Babylon.js に取り込み（265モーション＋Maskman モデル）、その上に
**3D 格闘ゲームの3システム（リターゲット / 個性ポーズ / 戦闘）** を個別デモとして実装・統合・検証済み。
まだ「個別デモが動く」段階で、**1キャラに合流させた遊べる本体は未着手**。

## 2. 完了済み（検証済み）
- **フェーズ0（実データ変換）**: `public/assets/` に Maskman GLB ＋ 265 アニメ GLB（曲線焼き込み済み）＋ bone-mapping.json ＋ manifest。`assets-manifest.json` 参照。
- **フェーズ1（再生）**: `/demo/fap` で Maskman に FAP を名前一致リバインドして再生。
- **3システム（並行実装）**:
  - feature1 リターゲット/バインド → `src/runtime/retarget/`・`/demo/bind`
  - feature2 ポーズ/個性 → `src/runtime/pose/`・`/demo/pose`
  - feature3 戦闘（hitbox/フレームデータ）→ `src/runtime/combat/`・`/demo/combat`
- **共通契約**: `src/runtime/fighting/types.ts`（`CharacterRig` / `MoveDefinition` / `PoseLayer` / `BindingProfile`）。3システムはこれにのみ依存。
- 統合済み: `src/runtime/index.ts` で公開、`src/app/page.tsx`（ホーム）に4デモのナビ。
- **検証**: `npm run typecheck` = 0 / ホーム＋4デモ全て HTTP 200 / OOM・エラー無し。

## 3. 動かし方・検証
```
cd C:\Users\user\developsecond\motion-editor
npm run dev            # ★既定は webpack（next dev は 15.5 でも webpack。--turbopack はオプトイン）
# → http://localhost:3000/  からホーム経由で /demo/{fap,bind,pose,combat}
npm run typecheck      # tsc --noEmit（型ゲート）
```
- 検証時に別ポートを使うなら `npx next dev -p 3100`。
- アセット再生成（Unity から変換し直す）: `npx tsx tools/unity-import/cli/import.ts --project "C:\Users\user\My project" --assets <csv> --out public/assets`
  （`npm run import:unity -- ...` は PowerShell で引数が壊れるので **tsx 直叩き**を使う）。

## 4. ハマりどころ（重要・既知）
- **dev/build の OOM は解決済み**: 真因は **Tailwind v4 の自動コンテンツ検出が親 `developsecond/` まで走査**していたこと。`src/app/globals.css` を `@import "tailwindcss" source("../");` に限定して解消。**この行を消すと全 3D ルートが OOM 再発するので触らない**。`next.config.ts` のルート固定も併用。
- **import パイプライン**:
  1. `.unitypackage` は `-batchmode` で import 不可 → 手動展開して Assets/ に再構築（実施済み。FAP は `My project/Assets/FightingAnimsetPro/`）。
  2. Unity プロジェクトをエディタで開いたまま batchmode 実行すると失敗（ロック）。
  3. **UnityGLTF は `#release/2.19.5` 必須**（2.19.4 未満は Unity6.4/URP17 で compile error）。`BatchExporter.cs` はクリップを **AnimatorOverrideController でラップ**して焼く（直 Controller だと AnimatorState 破棄で落ちる）。
- **retarget の限界**: rotationFix はベストエフォート。バインドポーズが大きく違う別リグは破綻し得る → 別モデルへの忠実移植は「Unity でそのモデルに再焼き」が堅実。
- **combat のフレーム値**は実測でなく調整値（当たりタイミング要微調整）。**pose の look-at** はリグ軸依存で `forwardAxis` 調整余地。

## 5. 主要 API（`@/runtime` から）
```ts
// feature1
loadFightingCharacter(scene, { modelGlbPath, animGlbPaths, binding? }): Promise<FightingCharacter>  // { rig: CharacterRig, ... }
// feature2
new PoseLayerController(rig).setLayer({offsets:{Spine:[x,y,z],...}, weight}); new LookAtController(rig).setTarget(node)
// feature3
const c = new CombatController(rig); c.setupHurtboxes(SAMPLE_HURTBOXES); c.addOpponent(other); c.onHit(cb); c.playMove(jab)
```

## 6. 次にやること（再開時の第一候補）
**3システムを1キャラに合流させた playable プロトタイプ**:
retarget でキャラ生成 → pose で個性付与 → combat ＋ **入力** ＋ **手組みステートマシン**（待機/歩行/技/被弾/ダウン）＋ **リアクション**（ヒットストップ/のけぞり/ノックバック）。
- 補助課題: Root Motion（踏み込み移動）、ロコモーションの Blend Tree、クリップごとのループ可否を manifest に反映。
- 進め方: 再び3クリエーターに分担指示するか（プロデューサー方式）、特定システムを作り込むか、をユーザに確認してから。

## 7. 関連ドキュメント
- 設計ディレクション: `docs/FIGHTING_GAME_DESIGN.md`
- 変換パイプライン: `tools/unity-import/README.md`, `editor/README.md`
