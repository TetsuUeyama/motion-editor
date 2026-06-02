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
- **anna voxel 移植（段階A・FAP モーション再生まで動作）**: `src/runtime/voxel/`。デモ `/demo/anna`。vox/skeleton は `public/anna/`（gitignore, `game-assets/vox-model/qm_mustardui` からコピー）。
  - `parseVox`(MagicaVoxel)/`buildVoxelMesh`(thin instances, Z-up→Y-up, ※`@babylonjs/core/Meshes/thinInstanceMesh` 副作用 import 必須)
  - `buildAnnaSkeleton`: skeleton.json(303本ARP) → TransformNode 階層（identity-rest, 位置のみ）
  - **★ARP 階層は使用不可**: skeleton.json は 303本中131本がルート直下（拘束駆動の補助ボーン）で変形階層が無い。→ `buildCleanSkeleton` で**ボーン head 位置から標準 humanoid 階層を組み直す**（segment 名=標準名で命名）。`arpSegments.ts` の `arpToSegment` が 158 weights ボーン→標準セグメントへ集約（toe ボーンは thumb1/index1 を含むので**脚・足を手指より先に判定**）。`AnnaMotionPlayer` の STD_TO_ANNA は恒等(標準→セグメント)。
  - `buildWeightedVoxelMesh`（現行・本採用）: **本物のスムーススキニング**。**body_clean.vox(93403) ↔ body_clean.weights.json(93403) が index 一致**（同グリッド 196×69×251）で、per-voxel 最大4ボーンの実荷重を使用。各ボクセルを毎フレーム CPU リニアブレンド（thin instance 動的更新）。**関節が連続変形・指も指ボーンにバインドして動く**。荷重ボーン名(ARP)は skeleton.json の全ボーンに存在→TransformNode へ直結。`public/anna/body_clean.{vox,weights.json}` を使用。
  - （旧）`buildRiggedVoxel`=剛体(隙間), `buildSkinnedVoxel`=2ボーン自動近似(不十分)。現行は weighted 版。
  - `AnnaMotionPlayer` の STD_TO_ANNA に**手指30ボーン**(thumb1.l/c_thumb2.l… ↔ Left/RightThumb/Index/Middle/Ring/Little Proximal/Intermediate/Distal)も追加済み。
  - `AnnaMotionPlayer` + `export-fap-skeleton.ts`(fap-skeleton.json) + `export-motions.ts`(motions/*.json): **v2 ワールド空間 delta リターゲット**。FAP を FK→ rest からの world delta → anna(rest=identity)へ。
  - **★handedness 注意**: Blender→Babylon を `(x,z,y)` にしたため深さ(Babylon Z)軸の鏡像。リターゲット delta を鏡像補正 `(x,y,z,w)→(-x,-y,z,w)` で整合済み。左右(X)は元々OK。もし逆に見える技があれば残り軸符号を1つ反転。
  - 残課題: LBS の伸び/痩せ・首/頭のチャンク感、root motion 未適用、衣装パーツ未追加。
- **各モーションのファイル化（アクションライブラリ）**: `tools/motion-lib/export-motions.ts`（`npx tsx tools/motion-lib/export-motions.ts`）が GLB の各アニメを **1クリップ=1 JSON**（`public/assets/motions/<clip>.motion.json`、計238本）に分解。**標準(Humanoid)ボーン名キーの TRS トラック＋clip-settings＋auxTracks(twist等)＋boneMap** を持つモデル非依存形式。`index.json` に一覧。→ 別モデルへは「標準名→ターゲットボーン名」マップで適用する設計。次タスク = anna(qm_mustardui) 用 voxel ローダー＋ARP 適用。
- **モーション設定のファイル化**: `tools/unity-import/cli/extract-clip-settings.ts`（`npx tsx tools/unity-import/cli/extract-clip-settings.ts --project "<UnityProj>"` ※npm run 経由は PowerShell で `--` が壊れる）が FBX `.meta` から **`public/assets/clip-settings.json`** を生成（clip 名→ loop / rootMotion 各軸 / bakeIntoPose / events）。ランタイムは `loadClipSettings()`（`src/runtime/loader/clipSettings.ts`）で読み、FapViewer が**クリップごとの loop を反映**＋設定を表示。※GLB＝曲線、clip-settings.json＝再生設定 の二本立て。rootMotion フラグは FAP 全クリップ true（root motion ベース設計の反映）で、実移動量は別途 GLB の Root 曲線解析が必要。events は FAP は空。
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
