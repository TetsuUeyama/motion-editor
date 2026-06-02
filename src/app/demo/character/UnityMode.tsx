"use client";

import { useEffect, useRef, useState } from "react";
import type { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";

import {
  UnityAssetLoader,
  type AnimatorJson,
  type AssetManifestEntry,
  type AssetManifestJson,
  type LoadedUnityAsset,
} from "@/runtime";
import { SceneCanvas } from "@/components/SceneCanvas";
import { AnimatorParameterUI } from "./AnimatorParameterUI";

interface Props {
  manifest: AssetManifestJson;
}

export function UnityMode({ manifest }: Props) {
  const exportable = manifest.assets.filter((a) => a.glbPath);
  const [selectedId, setSelectedId] = useState(exportable[0]?.id ?? "");
  const entry = exportable.find((a) => a.id === selectedId);

  if (!entry) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-400">
        manifest.assets に GLB を含むエントリがありません。
      </div>
    );
  }

  return (
    // key で SceneCanvas を再マウントして切替時に scene をスクラッチで作り直す
    <UnityModeInner key={entry.id} entry={entry} entries={exportable} onSelect={setSelectedId} />
  );
}

function UnityModeInner({
  entry,
  entries,
  onSelect,
}: {
  entry: AssetManifestEntry;
  entries: AssetManifestEntry[];
  onSelect: (id: string) => void;
}) {
  const [loaded, setLoaded] = useState<LoadedUnityAsset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentState, setCurrentState] = useState<string>("");
  const loadedRef = useRef<LoadedUnityAsset | null>(null);
  loadedRef.current = loaded;

  useEffect(() => {
    if (!loaded?.animator) return;
    const id = window.setInterval(() => {
      const s = loaded.animator?.getCurrentState();
      if (s) setCurrentState(s);
    }, 100);
    return () => window.clearInterval(id);
  }, [loaded]);

  const handleSceneReady = async (scene: Scene): Promise<() => void> => {
    setupEnvironment(scene);

    try {
      const loader = new UnityAssetLoader({ baseUrl: "/assets/" });
      const result = await loader.loadEntry(scene, entry);
      setLoaded(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }

    return () => {
      const r = loadedRef.current;
      r?.animator?.dispose();
      // mesh / skeleton は scene.dispose() で一括解放される
      setLoaded(null);
    };
  };

  return (
    <div className="relative h-full">
      <SceneCanvas onSceneReady={handleSceneReady} />

      <div className="absolute left-4 top-4 w-80 max-h-[calc(100vh-120px)] overflow-auto rounded-lg border border-neutral-800 bg-neutral-900/85 p-4 shadow-lg backdrop-blur">
        <h2 className="text-sm font-semibold">Unity Asset</h2>

        <label className="mt-2 block text-xs text-neutral-400">
          Asset
          <select
            value={entry.id}
            onChange={(e) => onSelect(e.target.value)}
            className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-200"
          >
            {entries.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-3 text-[11px] text-neutral-500">
          source: <span className="font-mono">{entry.sourcePath}</span>
        </div>

        {error && (
          <div className="mt-3 rounded border border-red-700/50 bg-red-900/30 p-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {loaded && (
          <>
            {loaded.animator ? (
              <>
                <div className="mt-4 border-t border-neutral-800 pt-3 text-xs">
                  Current State:{" "}
                  <span className="font-mono text-neutral-200">
                    {currentState}
                  </span>
                </div>
                <div className="mt-3">
                  <AnimatorParameterUI
                    animator={loaded.animator}
                    parameters={loaded.animatorJson?.parameters ?? []}
                  />
                </div>
              </>
            ) : (
              <ClipPicker groups={loaded.animationGroups} />
            )}

            <div className="mt-4 border-t border-neutral-800 pt-3 text-xs text-neutral-500">
              <div className="text-neutral-400">Asset info</div>
              <ul className="mt-1 space-y-0.5">
                <li>meshes: {loaded.meshes.length}</li>
                <li>skeletons: {loaded.skeletons.length}</li>
                <li>animationGroups: {loaded.animationGroups.length}</li>
                <li>
                  boneMapping: {loaded.boneMapping ? loaded.boneMapping.rigType : "—"}
                </li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ClipPicker({ groups }: { groups: readonly AnimationGroup[] }) {
  const [active, setActive] = useState<string | null>(null);

  const play = (g: AnimationGroup) => {
    for (const other of groups) {
      if (other !== g) other.stop();
    }
    g.start(true);
    g.setWeightForAllAnimatables(1);
    setActive(g.name);
  };

  return (
    <div className="mt-4 border-t border-neutral-800 pt-3">
      <div className="mb-2 text-xs text-neutral-400">
        Animator JSON が無いので AnimationGroup を直接再生:
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {groups.map((g) => (
          <button
            key={g.name}
            type="button"
            onClick={() => play(g)}
            className={
              "rounded px-2 py-1 text-xs " +
              (active === g.name
                ? "bg-blue-500/30 text-blue-100"
                : "border border-neutral-700 bg-neutral-800/50 text-neutral-300 hover:bg-neutral-800")
            }
          >
            {g.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function setupEnvironment(scene: Scene): void {
  scene.clearColor.set(0.04, 0.05, 0.07, 1);

  const camera = new ArcRotateCamera(
    "camera",
    -Math.PI / 2,
    Math.PI / 2.6,
    4,
    new Vector3(0, 1, 0),
    scene,
  );
  camera.attachControl(undefined, true);
  camera.lowerRadiusLimit = 1.5;
  camera.upperRadiusLimit = 12;
  camera.wheelDeltaPercentage = 0.02;

  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.7;

  const dir = new DirectionalLight("dir", new Vector3(-0.5, -1, -0.4), scene);
  dir.intensity = 0.6;

  const ground = MeshBuilder.CreateGround("ground", { width: 12, height: 12 }, scene);
  const groundMat = new StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = new Color3(0.15, 0.16, 0.2);
  groundMat.specularColor = Color3.Black();
  ground.material = groundMat;
}
