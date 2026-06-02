/**
 * feature1 (retarget/bind) の中心 API。
 *
 * モデル GLB を 1 つロードし、複数のアニメ GLB からクリップを取り出して
 * BindingProfile に従ってモデル側ノードへ貼り替え、共通契約 `CharacterRig`
 * を生成して返す。pose(feature2) / combat(feature3) はこの CharacterRig を
 * 消費する。
 */

import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";

import "@babylonjs/loaders/glTF";

import type { CharacterRig, BindingProfile } from "../fighting/types";
import { retarget, type RetargetResult } from "./retarget";

export interface LoadFightingCharacterOptions {
  /** baseUrl からの相対パス。モデル(可視メッシュ+スケルトン)の GLB */
  modelGlbPath: string;
  /** baseUrl からの相対パス。アニメだけが入った GLB 群 */
  animGlbPaths: string[];
  /** リターゲット設定。省略時は同一リグ(名前一致)経路 */
  binding?: BindingProfile;
  /** アセットのベース URL。既定 "/assets/" */
  baseUrl?: string;
}

/** loadFightingCharacter の戻り。CharacterRig + リターゲット統計 */
export interface FightingCharacter {
  rig: CharacterRig;
  /** 取り込んだ各アニメ GLB のリターゲット統計 (UI 表示用) */
  retargetStats: RetargetResult[];
}

/**
 * モデル + アニメ GLB 群をロードしてリターゲット済み CharacterRig を作る。
 *
 * 処理:
 *  1. モデル GLB をロード (mesh + skeleton + transformNodes)。LOD1+ は非表示。
 *  2. 各アニメ GLB をロードし AnimationGroup を取り出す。
 *  3. binding に従ってモデル側ノードへクリップを貼り替える。
 *  4. アニメ GLB 側の rig/mesh/元グループは dispose。
 *  5. CharacterRig(root, skeleton, meshes, nodesByName, clips) を返す。
 */
export async function loadFightingCharacter(
  scene: Scene,
  opts: LoadFightingCharacterOptions,
): Promise<FightingCharacter> {
  const baseUrl = normalizeBase(opts.baseUrl ?? "/assets/");

  // 1) モデル GLB
  const model = await importGlb(scene, baseUrl + opts.modelGlbPath);
  hideNonLod0(model.meshes);

  // 貼り替え先 = モデル側の全ノード (transformNode + mesh)。
  // GLB の skin joint は transformNode として現れるためこれで網羅できる。
  const targetNodes: Node[] = [...model.transformNodes, ...model.meshes];

  // nodesByName: ボーン名 → TransformNode (mesh は除外、joint/ボーン階層のみ)
  const nodesByName = new Map<string, TransformNode>();
  for (const tn of model.transformNodes) {
    if (!nodesByName.has(tn.name)) nodesByName.set(tn.name, tn);
  }

  // 2)+3) アニメ GLB をロード → リターゲット
  const clips = new Map<string, AnimationGroup>();
  const retargetStats: RetargetResult[] = [];

  for (const animPath of opts.animGlbPaths) {
    const anim = await importGlb(scene, baseUrl + animPath);

    const result = retarget(
      scene,
      anim.animationGroups,
      targetNodes,
      opts.binding,
    );
    retargetStats.push(result);

    for (const g of result.groups) {
      g.stop();
      // 同名クリップが複数 GLB に出る場合は後勝ち。基本は一意。
      clips.set(g.name, g);
    }

    // 4) アニメ GLB の元データを破棄 (rig / mesh / 元グループ)
    for (const g of anim.animationGroups) g.dispose();
    for (const n of anim.transformNodes) n.dispose();
    for (const s of anim.skeletons) s.dispose();
    for (const m of anim.meshes) m.dispose();
  }

  // root: __root__ があればそれ、無ければ親を持たない最初の TransformNode
  const root = findRoot(model.transformNodes, model.meshes, scene);

  const rig: CharacterRig = {
    scene,
    root,
    skeleton: model.skeletons[0] ?? null,
    meshes: model.meshes,
    nodesByName,
    clips,
  };

  return { rig, retargetStats };
}

interface GlbResult {
  meshes: AbstractMesh[];
  transformNodes: TransformNode[];
  skeletons: Skeleton[];
  animationGroups: AnimationGroup[];
}

async function importGlb(scene: Scene, url: string): Promise<GlbResult> {
  const idx = url.lastIndexOf("/");
  const rootUrl = url.substring(0, idx + 1);
  const fileName = url.substring(idx + 1);
  const res = await SceneLoader.ImportMeshAsync("", rootUrl, fileName, scene);
  return {
    meshes: res.meshes,
    transformNodes: res.transformNodes,
    skeletons: res.skeletons,
    animationGroups: res.animationGroups,
  };
}

/** LOD1 以降のメッシュを非表示にする (LOD0 のみ可視) */
function hideNonLod0(meshes: readonly AbstractMesh[]): void {
  for (const m of meshes) {
    if (/_LOD[1-9]/i.test(m.name)) m.setEnabled(false);
  }
}

/** baseUrl 末尾に / を保証 */
function normalizeBase(base: string): string {
  return base.endsWith("/") ? base : base + "/";
}

/**
 * キャラのルート TransformNode を決める。
 * glTF ローダは "__root__" を作るのでそれを優先。無ければ親無しの
 * TransformNode、それも無ければ新規に空の root を作って包む。
 */
function findRoot(
  transformNodes: readonly TransformNode[],
  meshes: readonly AbstractMesh[],
  scene: Scene,
): TransformNode {
  const gltfRoot = [...transformNodes, ...meshes].find(
    (n) => n.name === "__root__",
  );
  if (gltfRoot instanceof TransformNode) return gltfRoot;

  const parentless = transformNodes.find((n) => !n.parent);
  if (parentless) return parentless;

  // フォールバック: 包む空ノード (通常ここには来ない)
  return new TransformNode("characterRoot", scene);
}
