# 3D 格闘ゲーム — 設計ディレクション

プロデューサー指示書。Kubold Fighting Animset Pro (FAP) のモーション + Maskman モデルを土台に、
Babylon.js 上で 3D 格闘ゲームのキャラクターシステムを作る。

## 既に在るもの (土台)
- `public/assets/` … Maskman GLB + 265 アニメ GLB (FAP を変換済み) + bone-mapping.json + manifest
- `src/runtime/loader/retargetAnimations.ts` … ボーン名一致でアニメを別スケルトンへ貼り替える素朴版
- `src/runtime/avatar/` … StandardSkeleton(53 Humanoid bone) / BoneMapping / プリセット
- `src/runtime/animator/` … AnimatorController 再現ランタイム (State/Transition/Param)
- `src/app/demo/fap/` … Maskman に FAP を再バインドして再生する参照ビューア
- `src/runtime/fighting/types.ts` … ★3システム共通の型契約 (CharacterRig / MoveDefinition / PoseLayer / BindingProfile)

## 3 つの作業ストリーム (1 人 1 ストリーム / ファイル所有を分離)

### Creator A — リターゲット・バインド (feature1)  所有: `src/runtime/retarget/`, `src/app/demo/bind/`
「FAP モーションを、指定したボーン / 自分のモデルに反映して動かす」を実現。
`loadFightingCharacter(...) → CharacterRig` を作り、同一リグ / Humanoid 名マップ / リグ差(回転補正) に対応。

### Creator B — ポーズ・個性レイヤー (feature2)  所有: `src/runtime/pose/`, `src/app/demo/pose/`
「ベースモーションにキャラ特有の動き(腰の曲げ・腕の角度)を足す」を実現。
アニメ評価の後に毎フレーム適用する追加回転レイヤー + 簡易IK/注視。`PoseLayer` を消費。

### Creator C — 戦闘システム (feature3)  所有: `src/runtime/combat/`, `src/app/demo/combat/`
「攻撃判定/当たり判定、発生・持続・硬直・クールタイムのフレーム設定」を実現。
`MoveDefinition` のフレームデータ + ボーン追従 hitbox/hurtbox + 重なり判定 + 状態ゲート。

## 不変のルール (並行作業を壊さないため)
1. 3 システムは `src/runtime/fighting/types.ts` の `CharacterRig` インターフェースにのみ依存する。
   互いの実装を import しない (B/C は A の完成を待たず、Maskman を直接ロードして CharacterRig を自作してよい)。
2. 自分の所有ディレクトリ以外を編集しない。特に `src/runtime/index.ts` と `src/app/page.tsx` は
   **触らない** (プロデューサーが最後に配線する)。各自のディレクトリ内に local な `index.ts` を作って export。
3. 既存の動作 (`/demo/fap`) を壊さない。
4. Tailwind/Next の制約: 新しい demo ルートは `"use client"` のページにし、Babylon は
   `useEffect`/client 内でのみ生成。`globals.css` は変更しない。
5. 各自 `npm run typecheck` (tsc) が通る状態で完了する。

## 完成イメージ (3 つが合流したとき)
Maskman(または任意モデル)をロード → 個性ポーズを乗せた状態で → 入力で技を出し →
発生フレームで hitbox が出て相手の hurtbox に当たればヒット、というキャラが動く。
