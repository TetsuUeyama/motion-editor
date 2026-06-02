"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

import "@babylonjs/loaders/glTF";

import {
  retargetAnimationGroups,
  type AssetManifestJson,
  type AssetManifestEntry,
} from "@/runtime";
import {
  PoseLayerController,
  LookAtController,
  compileSpineBend,
  type PoseLayer,
} from "@/runtime/pose";
import { SceneCanvas } from "@/components/SceneCanvas";

const MASKMAN_ID = "maskman_loded2";
const MOVEMENT_ID = "kb_movement";
/** ベースで再生するクリップ候補 (上から順に探す) */
const BASE_CLIP_CANDIDATES = ["KB_Idle_1", "KB_WalkFwd1"];

interface Props {
  manifest: AssetManifestJson;
}

/** スライダーで動かす個性パラメータ */
interface PoseParams {
  spineBend: number; // ラジアン (前傾+/後傾-)
  leftArm: number; // LeftArm Z オフセット (ラジアン)
  rightArm: number; // RightArm Z オフセット (ラジアン)
  weight: number; // ポーズレイヤー全体の効き
  look: boolean; // 注視 ON/OFF
}

const DEFAULT_PARAMS: PoseParams = {
  spineBend: 0,
  leftArm: 0,
  rightArm: 0,
  weight: 1,
  look: false,
};

export function PoseViewer({ manifest }: Props) {
  const maskman = manifest.assets.find(
    (a) => a.id === MASKMAN_ID && a.glbPath,
  );
  const movement = manifest.assets.find(
    (a) => a.id === MOVEMENT_ID && a.glbPath,
  );

  if (!maskman) {
    return (
      <Centered>
        Maskman モデル (`{MASKMAN_ID}`) が manifest にありません。
      </Centered>
    );
  }
  if (!movement) {
    return (
      <Centered>
        movement アセット (`{MOVEMENT_ID}`) が manifest にありません。
      </Centered>
    );
  }

  return <PoseViewerInner maskman={maskman} movement={movement} />;
}

function PoseViewerInner({
  maskman,
  movement,
}: {
  maskman: AssetManifestEntry;
  movement: AssetManifestEntry;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [baseClip, setBaseClip] = useState<string>("");
  const [params, setParams] = useState<PoseParams>(DEFAULT_PARAMS);

  // Babylon 側オブジェクトへの参照 (描画ループ間で保持)
  const poseCtrlRef = useRef<PoseLayerController | null>(null);
  const lookCtrlRef = useRef<LookAtController | null>(null);
  const lookTargetRef = useRef<TransformNode | null>(null);
  const groupsRef = useRef<Map<string, AnimationGroup>>(new Map());

  const handleSceneReady = async (scene: Scene): Promise<() => void> => {
    setupEnvironment(scene);

    try {
      // 1) Maskman をロード
      const maskmanRes = await loadGlb(scene, maskman.glbPath!);
      hideNonLod0(maskmanRes.meshes);

      // 2) ボーン名 → TransformNode マップ (CharacterRig 相当を自前で構築)
      const nodesByName = new Map<string, TransformNode>();
      for (const n of maskmanRes.transformNodes) {
        if (!nodesByName.has(n.name)) nodesByName.set(n.name, n);
      }

      const targetNodes: Node[] = [
        ...maskmanRes.transformNodes,
        ...maskmanRes.meshes,
      ];

      // 3) movement GLB をロードして AnimationGroup を Maskman へ貼り替え
      const animRes = await loadGlb(scene, movement.glbPath!);
      const { groups } = retargetAnimationGroups(
        scene,
        animRes.animationGroups,
        targetNodes,
      );
      // 元データ破棄
      for (const g of animRes.animationGroups) g.dispose();
      for (const n of animRes.transformNodes) n.dispose();
      for (const s of animRes.skeletons) s.dispose();
      for (const m of animRes.meshes) m.dispose();

      const map = new Map<string, AnimationGroup>();
      for (const g of groups) {
        g.stop();
        map.set(g.name, g);
      }
      groupsRef.current = map;

      // 4) ベースクリップを選んで再生
      const chosen =
        BASE_CLIP_CANDIDATES.find((c) => map.has(c)) ??
        [...map.keys()].find((n) => !/bindpose|tpose/i.test(n)) ??
        [...map.keys()][0];
      if (chosen) {
        const g = map.get(chosen)!;
        g.start(true);
        g.setWeightForAllAnimatables(1);
        setBaseClip(chosen);
      }

      // 5) 注視ターゲット: キャラ前方やや上に置いた球。頭がこれを追う
      const target = MeshBuilder.CreateSphere(
        "lookTarget",
        { diameter: 0.12 },
        scene,
      );
      target.position.set(0.6, 1.7, 1.2);
      const tMat = new StandardMaterial("lookTargetMat", scene);
      tMat.emissiveColor = new Color3(0.9, 0.4, 0.2);
      tMat.disableLighting = true;
      target.material = tMat;
      target.setEnabled(false); // 注視 OFF のうちは隠す
      lookTargetRef.current = target;

      // 6) ポーズ系コントローラ (アニメ評価後に毎フレーム合成)
      const poseCtrl = new PoseLayerController({ scene, nodesByName });
      poseCtrlRef.current = poseCtrl;

      const lookCtrl = new LookAtController(
        { scene, nodesByName },
        { bones: ["Neck", "Head"], weight: 0 },
      );
      lookCtrl.setTarget(target);
      lookCtrlRef.current = lookCtrl;

      // 初期パラメータを反映
      applyParams(DEFAULT_PARAMS, poseCtrl, lookCtrl, target);

      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }

    return () => {
      poseCtrlRef.current?.dispose();
      lookCtrlRef.current?.dispose();
      for (const g of groupsRef.current.values()) g.dispose();
      groupsRef.current.clear();
    };
  };

  // スライダー変更時にコントローラへ反映
  useEffect(() => {
    const poseCtrl = poseCtrlRef.current;
    const lookCtrl = lookCtrlRef.current;
    if (!poseCtrl || !lookCtrl) return;
    applyParams(params, poseCtrl, lookCtrl, lookTargetRef.current);
  }, [params]);

  const switchClip = (name: string) => {
    const map = groupsRef.current;
    const g = map.get(name);
    if (!g) return;
    for (const [n, other] of map) if (n !== name) other.stop();
    g.start(true);
    g.setWeightForAllAnimatables(1);
    setBaseClip(name);
  };

  return (
    <div className="relative h-full">
      <SceneCanvas onSceneReady={handleSceneReady} />

      <div className="absolute left-4 top-4 flex w-80 flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900/85 p-4 shadow-lg backdrop-blur">
        <Link
          href="/"
          className="text-xs text-neutral-400 hover:text-neutral-200"
        >
          ← Home
        </Link>
        <h2 className="text-sm font-semibold">
          Pose Layer — キャラ個性 (feature2)
        </h2>

        {status === "loading" && (
          <div className="text-xs text-neutral-400">読み込み中…</div>
        )}
        {error && (
          <div className="rounded border border-red-700/50 bg-red-900/30 p-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {status === "ready" && (
          <>
            <label className="block text-xs text-neutral-400">
              ベースモーション
              <select
                value={baseClip}
                onChange={(e) => switchClip(e.target.value)}
                className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-200"
              >
                {BASE_CLIP_CANDIDATES.filter((c) =>
                  groupsRef.current.has(c),
                ).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <Slider
              label="腰の曲げ (spineBend)"
              min={-0.6}
              max={0.6}
              step={0.01}
              value={params.spineBend}
              onChange={(v) => setParams((p) => ({ ...p, spineBend: v }))}
              fmt={(v) => `${deg(v)}°`}
            />
            <Slider
              label="左腕の角度 (LeftArm)"
              min={-1.2}
              max={1.2}
              step={0.01}
              value={params.leftArm}
              onChange={(v) => setParams((p) => ({ ...p, leftArm: v }))}
              fmt={(v) => `${deg(v)}°`}
            />
            <Slider
              label="右腕の角度 (RightArm)"
              min={-1.2}
              max={1.2}
              step={0.01}
              value={params.rightArm}
              onChange={(v) => setParams((p) => ({ ...p, rightArm: v }))}
              fmt={(v) => `${deg(v)}°`}
            />
            <Slider
              label="効き (weight)"
              min={0}
              max={1}
              step={0.01}
              value={params.weight}
              onChange={(v) => setParams((p) => ({ ...p, weight: v }))}
              fmt={(v) => v.toFixed(2)}
            />

            <label className="flex items-center gap-2 text-xs text-neutral-300">
              <input
                type="checkbox"
                checked={params.look}
                onChange={(e) =>
                  setParams((p) => ({ ...p, look: e.target.checked }))
                }
              />
              頭の注視 (lookAt) ON
            </label>

            <button
              type="button"
              onClick={() => setParams(DEFAULT_PARAMS)}
              className="mt-1 rounded border border-neutral-700 bg-neutral-800/60 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
            >
              リセット
            </button>

            <p className="text-[11px] leading-relaxed text-neutral-500">
              再生中のアニメの上に個性が乗ります。weight=0 で素のアニメに
              戻ります。
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * スライダー値 → コントローラ反映。
 * spineBend と左右腕オフセットを 1 枚の PoseLayer に畳んで適用し、
 * 注視は LookAtController の weight で ON/OFF する。
 */
function applyParams(
  params: PoseParams,
  poseCtrl: PoseLayerController,
  lookCtrl: LookAtController,
  target: TransformNode | null,
): void {
  // 腕オフセットを base レイヤーに入れ、spineBend を畳む
  const baseLayer: PoseLayer = {
    offsets: {
      LeftArm: [0, 0, params.leftArm],
      RightArm: [0, 0, params.rightArm],
    },
    weight: params.weight,
  };
  const layer = compileSpineBend(params.spineBend, baseLayer);
  poseCtrl.setLayer(layer);
  poseCtrl.setWeight(params.weight);

  lookCtrl.setWeight(params.look ? 1 : 0);
  if (target) target.setEnabled(params.look);
}

interface GlbResult {
  meshes: AbstractMesh[];
  transformNodes: TransformNode[];
  skeletons: Skeleton[];
  animationGroups: AnimationGroup[];
}

async function loadGlb(scene: Scene, relPath: string): Promise<GlbResult> {
  const url = "/assets/" + relPath;
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

function hideNonLod0(meshes: AbstractMesh[]): void {
  for (const m of meshes) {
    if (/_LOD[1-9]/i.test(m.name)) m.setEnabled(false);
  }
}

function deg(rad: number): number {
  return Math.round((rad * 180) / Math.PI);
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  fmt,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  fmt: (v: number) => string;
}) {
  return (
    <label className="block text-xs text-neutral-400">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="text-neutral-300">{fmt(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mt-1 w-full accent-blue-500"
      />
    </label>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-neutral-400">
      {children}
    </div>
  );
}

function setupEnvironment(scene: Scene): void {
  scene.clearColor.set(0.04, 0.05, 0.07, 1);

  const camera = new ArcRotateCamera(
    "camera",
    -Math.PI / 2,
    Math.PI / 2.4,
    3.2,
    new Vector3(0, 1, 0),
    scene,
  );
  camera.attachControl(undefined, true);
  camera.lowerRadiusLimit = 1.2;
  camera.upperRadiusLimit = 12;
  camera.wheelDeltaPercentage = 0.02;

  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.75;

  const dir = new DirectionalLight("dir", new Vector3(-0.5, -1, -0.4), scene);
  dir.intensity = 0.6;

  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: 12, height: 12 },
    scene,
  );
  const groundMat = new StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = new Color3(0.15, 0.16, 0.2);
  groundMat.specularColor = Color3.Black();
  ground.material = groundMat;
}
