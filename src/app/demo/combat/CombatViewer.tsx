"use client";

import { useRef, useState } from "react";
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
  CombatController,
  SAMPLE_MOVES,
  SAMPLE_HURTBOXES,
  type CharacterRig,
  type MoveDefinition,
  type HitEvent,
} from "@/runtime/combat";
import { SceneCanvas } from "@/components/SceneCanvas";

const MASKMAN_ID = "maskman_loded2";
// 技に必要なクリップを含むアニメ GLB
const PUNCH_ID = "kb_punches";
const KICK_ID = "kb_kicks";

interface Props {
  manifest: AssetManifestJson;
}

interface HitLog {
  text: string;
  at: number;
}

export function CombatViewer({ manifest }: Props) {
  const maskman = manifest.assets.find((a) => a.id === MASKMAN_ID && a.glbPath);
  const punches = manifest.assets.find((a) => a.id === PUNCH_ID && a.glbPath);
  const kicks = manifest.assets.find((a) => a.id === KICK_ID && a.glbPath);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState(true);

  // HUD 表示用 (毎フレーム更新)
  const [frame, setFrame] = useState(0);
  const [phase, setPhase] = useState("idle");
  const [moveId, setMoveId] = useState<string | null>(null);
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  const [hits, setHits] = useState<HitLog[]>([]);
  const [totalDamage, setTotalDamage] = useState(0);

  const attackerRef = useRef<CombatController | null>(null);
  const targetRef = useRef<CombatController | null>(null);
  const debugRef = useRef(true);

  const handleSceneReady = async (scene: Scene): Promise<() => void> => {
    setupEnvironment(scene);

    if (!maskman || !punches || !kicks) {
      setError(
        `必要なアセットが manifest にありません (maskman/${PUNCH_ID}/${KICK_ID})。`,
      );
      setStatus("error");
      return () => {};
    }

    try {
      // 攻撃側と標的、2 体の Maskman をロードして CharacterRig を自前で組む。
      const attackerRig = await buildRig(
        scene,
        maskman,
        [punches, kicks],
        new Vector3(-0.55, 0, 0),
      );
      const targetRig = await buildRig(
        scene,
        maskman,
        [punches, kicks],
        new Vector3(0.55, 0, 0),
      );
      // 標的は攻撃側に正対させる
      targetRig.root.rotation.y = Math.PI;
      attackerRig.root.rotation.y = 0;

      // Idle で構える (idle が無ければ最初の非 bindpose クリップ)
      playIdle(attackerRig);
      playIdle(targetRig);

      const attacker = new CombatController(attackerRig);
      const target = new CombatController(targetRig);
      target.setupHurtboxes([...SAMPLE_HURTBOXES]);
      // 攻撃側にも hurtbox を付けておく (相互戦闘の拡張余地)
      attacker.setupHurtboxes([...SAMPLE_HURTBOXES]);

      attacker.addOpponent(target);
      attacker.setDebugVisible(debugRef.current);
      target.setDebugVisible(debugRef.current);

      attacker.onHit((e: HitEvent) => {
        const dmg = e.move.damage ?? 0;
        setHits((prev) =>
          [
            { text: `HIT! ${e.move.label ?? e.move.id} — ${dmg} dmg (frame ${e.frame})`, at: Date.now() },
            ...prev,
          ].slice(0, 6),
        );
        setTotalDamage((d) => d + dmg);
      });

      attackerRef.current = attacker;
      targetRef.current = target;
      setStatus("ready");

      // HUD を毎フレーム更新
      scene.onBeforeRenderObservable.add(() => {
        const s = attacker.getStatus();
        setFrame(s.frame);
        setPhase(s.phase);
        setMoveId(s.moveId);
        setCooldowns(s.cooldowns);
      });

      return () => {
        attacker.dispose();
        target.dispose();
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
      return () => {};
    }
  };

  const handlePlay = (move: MoveDefinition) => {
    attackerRef.current?.playMove(move);
  };

  const toggleDebug = () => {
    const next = !debug;
    setDebug(next);
    debugRef.current = next;
    attackerRef.current?.setDebugVisible(next);
    targetRef.current?.setDebugVisible(next);
  };

  return (
    <div className="relative h-full">
      <SceneCanvas onSceneReady={handleSceneReady} />

      <div className="absolute left-4 top-4 flex max-h-[calc(100vh-40px)] w-80 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/85 p-4 shadow-lg backdrop-blur">
        <Link href="/" className="text-xs text-neutral-400 hover:text-neutral-200">
          ← Home
        </Link>
        <h2 className="mt-1 text-sm font-semibold">Combat — Frame Data Demo</h2>

        {status === "loading" && (
          <div className="mt-3 text-xs text-neutral-400">読み込み中…</div>
        )}
        {error && (
          <div className="mt-3 rounded border border-red-700/50 bg-red-900/30 p-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {status === "ready" && (
          <>
            <label className="mt-3 flex items-center gap-2 text-xs text-neutral-300">
              <input
                type="checkbox"
                checked={debug}
                onChange={toggleDebug}
              />
              デバッグ表示 (hitbox 赤 / hurtbox 緑)
            </label>

            <div className="mt-3 grid grid-cols-2 gap-1">
              {SAMPLE_MOVES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handlePlay(m)}
                  className="rounded border border-neutral-700 bg-neutral-800/60 px-2 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-700"
                >
                  {m.label ?? m.id}
                  <span className="block text-[10px] text-neutral-500">
                    {m.startup}f / {m.active[0]}-{m.active[1]} / r{m.recovery} / cd
                    {m.cooldown}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-3 border-t border-neutral-800 pt-3 text-xs">
              <div className="font-mono text-neutral-300">
                move: <span className="text-blue-300">{moveId ?? "—"}</span>
              </div>
              <div className="font-mono">
                phase:{" "}
                <span className={phaseColor(phase)}>{phase}</span>
                {"  "}frame: <span className="text-neutral-200">{frame}</span>
              </div>
              <div className="mt-1 text-neutral-400">
                total damage:{" "}
                <span className="text-amber-300">{totalDamage}</span>
              </div>
              {Object.keys(cooldowns).length > 0 && (
                <div className="mt-1 text-[11px] text-neutral-500">
                  cooldown:{" "}
                  {Object.entries(cooldowns)
                    .map(([id, f]) => `${id}:${f}f`)
                    .join("  ")}
                </div>
              )}
            </div>

            <div className="mt-3 min-h-[80px] flex-1 overflow-auto border-t border-neutral-800 pt-3">
              <div className="mb-1 text-xs text-neutral-400">Hit log</div>
              {hits.length === 0 && (
                <div className="text-[11px] text-neutral-600">
                  技ボタンで攻撃 → 標的に当たると HIT 表示
                </div>
              )}
              {hits.map((h, i) => (
                <div
                  key={h.at + "_" + i}
                  className="text-[11px] font-mono text-green-300"
                >
                  {h.text}
                </div>
              ))}
            </div>

            <div className="mt-2 border-t border-neutral-800 pt-2 text-[10px] text-neutral-500">
              コンボ例: Jab → Straight → Hook → Uppercut
              (recovery 中に次技でキャンセル)
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function phaseColor(phase: string): string {
  switch (phase) {
    case "startup":
      return "text-yellow-300";
    case "active":
      return "text-red-300";
    case "recovery":
      return "text-orange-300";
    default:
      return "text-neutral-400";
  }
}

// ----------------------------------------------------------- rig building

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

/**
 * Maskman 1 体をロードし、複数のアニメ GLB のクリップを名前一致で貼り替えて
 * CharacterRig を組む (FapViewer のロード手順を流用)。
 */
async function buildRig(
  scene: Scene,
  maskman: AssetManifestEntry,
  animEntries: AssetManifestEntry[],
  position: Vector3,
): Promise<CharacterRig> {
  const maskmanRes = await loadGlb(scene, maskman.glbPath!);
  hideNonLod0(maskmanRes.meshes);

  // root は __root__ もしくは最上位の TransformNode
  const root =
    (maskmanRes.transformNodes.find((n) => n.name === "__root__") as
      | TransformNode
      | undefined) ??
    (maskmanRes.meshes.find((m) => !m.parent) as unknown as TransformNode) ??
    maskmanRes.transformNodes[0];
  root.position.copyFrom(position);

  const targetNodes: Node[] = [
    ...maskmanRes.transformNodes,
    ...maskmanRes.meshes,
  ];

  // ボーン名 → TransformNode
  const nodesByName = new Map<string, TransformNode>();
  for (const n of maskmanRes.transformNodes) {
    if (!nodesByName.has(n.name)) nodesByName.set(n.name, n);
  }

  // 各アニメ GLB を貼り替える
  const clips = new Map<string, AnimationGroup>();
  for (const entry of animEntries) {
    const animRes = await loadGlb(scene, entry.glbPath!);
    const { groups } = retargetAnimationGroups(
      scene,
      animRes.animationGroups,
      targetNodes,
    );
    for (const g of animRes.animationGroups) g.dispose();
    for (const n of animRes.transformNodes) n.dispose();
    for (const s of animRes.skeletons) s.dispose();
    for (const m of animRes.meshes) m.dispose();
    for (const g of groups) {
      g.stop();
      if (!clips.has(g.name)) clips.set(g.name, g);
    }
  }

  return {
    scene,
    root,
    skeleton: maskmanRes.skeletons[0] ?? null,
    meshes: maskmanRes.meshes,
    nodesByName,
    clips,
  };
}

function playIdle(rig: CharacterRig): void {
  let group: AnimationGroup | undefined;
  for (const [name, g] of rig.clips) {
    if (/idle/i.test(name)) {
      group = g;
      break;
    }
  }
  if (!group) {
    for (const [name, g] of rig.clips) {
      if (!/bindpose|tpose/i.test(name)) {
        group = g;
        break;
      }
    }
  }
  if (group) {
    group.start(true);
    group.setWeightForAllAnimatables(1);
  }
}

function hideNonLod0(meshes: AbstractMesh[]): void {
  for (const m of meshes) {
    if (/_LOD[1-9]/i.test(m.name)) m.setEnabled(false);
  }
}

function setupEnvironment(scene: Scene): void {
  scene.clearColor.set(0.04, 0.05, 0.07, 1);

  const camera = new ArcRotateCamera(
    "camera",
    -Math.PI / 2,
    Math.PI / 2.3,
    4.2,
    new Vector3(0, 1, 0),
    scene,
  );
  camera.attachControl(undefined, true);
  camera.lowerRadiusLimit = 1.5;
  camera.upperRadiusLimit = 14;
  camera.wheelDeltaPercentage = 0.02;

  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.8;

  const dir = new DirectionalLight("dir", new Vector3(-0.5, -1, -0.4), scene);
  dir.intensity = 0.6;

  const ground = MeshBuilder.CreateGround("ground", { width: 14, height: 14 }, scene);
  const groundMat = new StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = new Color3(0.15, 0.16, 0.2);
  groundMat.specularColor = Color3.Black();
  ground.material = groundMat;
}
