"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";

import "@babylonjs/loaders/glTF";

import {
  retargetAnimationGroups,
  loadClipSettings,
  type ClipSettings,
  type AssetManifestJson,
  type AssetManifestEntry,
} from "@/runtime";
import { SceneCanvas } from "@/components/SceneCanvas";

const MASKMAN_ID = "maskman_loded2";

interface Props {
  manifest: AssetManifestJson;
}

export function FapViewer({ manifest }: Props) {
  const maskman = manifest.assets.find((a) => a.id === MASKMAN_ID && a.glbPath);
  const animEntries = manifest.assets.filter(
    (a) => a.glbPath && a.id !== MASKMAN_ID && a.animationClips.length > 0,
  );
  const [animId, setAnimId] = useState(animEntries[0]?.id ?? "");
  const animEntry = animEntries.find((a) => a.id === animId);

  if (!maskman) {
    return (
      <Centered>
        Maskman モデル (`{MASKMAN_ID}`) が manifest にありません。先に
        `import:unity` を実行してください。
      </Centered>
    );
  }
  if (!animEntry) {
    return <Centered>アニメーション GLB が manifest にありません。</Centered>;
  }

  return (
    <FapViewerInner
      key={animEntry.id}
      maskman={maskman}
      animEntry={animEntry}
      animEntries={animEntries}
      onSelectAnim={setAnimId}
    />
  );
}

function FapViewerInner({
  maskman,
  animEntry,
  animEntries,
  onSelectAnim,
}: {
  maskman: AssetManifestEntry;
  animEntry: AssetManifestEntry;
  animEntries: AssetManifestEntry[];
  onSelectAnim: (id: string) => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [clipNames, setClipNames] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [stats, setStats] = useState<{ matched: number; skipped: number } | null>(
    null,
  );

  // 再バインド済み AnimationGroup を name で引けるよう保持
  const groupsRef = useRef<Map<string, AnimationGroup>>(new Map());
  // clip-settings.json（loop / root motion / events）。曲線は GLB、設定はこちら。
  const clipSettingsRef = useRef<Map<string, ClipSettings>>(new Map());
  const [activeSettings, setActiveSettings] = useState<ClipSettings | null>(null);

  const handleSceneReady = async (scene: Scene): Promise<() => void> => {
    setupEnvironment(scene);

    try {
      // 1) Maskman (可視メッシュ + スケルトン) をロード
      const maskmanRes = await loadGlb(scene, maskman.glbPath!);
      hideNonLod0(maskmanRes.meshes);
      // 再バインド先 = Maskman 側の全ノード (joint も含む)
      const targetNodes: Node[] = [
        ...maskmanRes.transformNodes,
        ...maskmanRes.meshes,
      ];

      // 2) アニメ GLB をロードして AnimationGroup を取り出す
      const animRes = await loadGlb(scene, animEntry.glbPath!);

      // 3) 名前一致で Maskman へ貼り替え
      const { groups, matched, skipped } = retargetAnimationGroups(
        scene,
        animRes.animationGroups,
        targetNodes,
      );

      // 4) アニメ GLB 側の元データは破棄 (rig / mesh / 元グループ)
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
      // 各クリップの再生設定（loop 等）をロード。無ければ空＝loop 既定 true。
      clipSettingsRef.current = await loadClipSettings();

      // BindPose / tpose は最後に回しつつ全クリップを並べる
      const names = groups
        .map((g) => g.name)
        .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
      setClipNames(names);
      setStats({ matched, skipped });
      setStatus("ready");

      // 既定クリップを自動再生 (Idle 系があればそれ)
      const first =
        names.find((n) => /idle/i.test(n)) ??
        names.find((n) => !/bindpose|tpose/i.test(n)) ??
        names[0];
      if (first) playClip(first);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }

    return () => {
      for (const g of groupsRef.current.values()) g.dispose();
      groupsRef.current.clear();
    };
  };

  const playClip = (name: string) => {
    const target = groupsRef.current.get(name);
    if (!target) return;
    for (const [n, g] of groupsRef.current) {
      if (n !== name) g.stop();
    }
    // clip-settings.json の loop を反映（攻撃などは 1 回再生、Idle/Walk はループ）
    const settings = clipSettingsRef.current.get(name) ?? null;
    target.start(settings?.loop ?? true);
    target.setWeightForAllAnimatables(1);
    setActive(name);
    setActiveSettings(settings);
  };

  return (
    <div className="relative h-full">
      <SceneCanvas onSceneReady={handleSceneReady} />

      <div className="absolute left-4 top-4 flex max-h-[calc(100vh-120px)] w-80 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/85 p-4 shadow-lg backdrop-blur">
        <Link href="/" className="text-xs text-neutral-400 hover:text-neutral-200">
          ← Home
        </Link>
        <h2 className="mt-1 text-sm font-semibold">Fighting Animset Pro</h2>

        <label className="mt-2 block text-xs text-neutral-400">
          Animation set
          <select
            value={animEntry.id}
            onChange={(e) => onSelectAnim(e.target.value)}
            className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-200"
          >
            {animEntries.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id} ({a.animationClips.length})
              </option>
            ))}
          </select>
        </label>

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
            {stats && (
              <div className="mt-2 text-[11px] text-neutral-500">
                retarget: {stats.matched} channels matched
                {stats.skipped > 0 && `, ${stats.skipped} skipped`}
              </div>
            )}
            {active && (
              <div className="mt-1 text-[11px] text-neutral-400">
                <span className="font-mono text-neutral-200">{active}</span>
                {activeSettings ? (
                  <>
                    {" — "}loop:{" "}
                    <span className={activeSettings.loop ? "text-emerald-400" : "text-neutral-500"}>
                      {activeSettings.loop ? "ON" : "OFF"}
                    </span>
                    {" / rootXZ:"}
                    {activeSettings.rootMotion.positionXZ ? "✓" : "—"}
                    {" / frames "}
                    {activeSettings.firstFrame}-{activeSettings.lastFrame}
                  </>
                ) : (
                  <span className="text-neutral-600"> — (no clip-settings.json)</span>
                )}
              </div>
            )}
            <div className="mt-3 min-h-0 flex-1 overflow-auto border-t border-neutral-800 pt-3">
              <div className="mb-2 text-xs text-neutral-400">
                Clips ({clipNames.length})
              </div>
              <div className="grid grid-cols-1 gap-1">
                {clipNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => playClip(name)}
                    className={
                      "rounded px-2 py-1 text-left text-xs " +
                      (active === name
                        ? "bg-blue-500/30 text-blue-100"
                        : "border border-neutral-700 bg-neutral-800/50 text-neutral-300 hover:bg-neutral-800")
                    }
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// BindPose / tpose を末尾へ、Idle を先頭へ
function rank(name: string): number {
  if (/idle/i.test(name)) return 0;
  if (/bindpose|tpose/i.test(name)) return 2;
  return 1;
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

  const ground = MeshBuilder.CreateGround("ground", { width: 12, height: 12 }, scene);
  const groundMat = new StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = new Color3(0.15, 0.16, 0.2);
  groundMat.specularColor = Color3.Black();
  ground.material = groundMat;
}
