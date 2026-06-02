"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";

import type { AssetManifestJson, AssetManifestEntry } from "@/runtime";
import type { BindingProfile, CharacterRig } from "@/runtime/fighting/types";
import {
  loadFightingCharacter,
  type FightingCharacter,
} from "@/runtime/retarget";
import { SceneCanvas } from "@/components/SceneCanvas";

const MASKMAN_ID = "maskman_loded2";

interface Props {
  manifest: AssetManifestJson;
}

export function BindViewer({ manifest }: Props) {
  const maskman = manifest.assets.find((a) => a.id === MASKMAN_ID && a.glbPath);
  const animEntries = manifest.assets.filter(
    (a) => a.glbPath && a.id !== MASKMAN_ID && a.animationClips.length > 0,
  );

  // 既定で取り込むアニメ GLB (movement / punches があればそれ、無ければ先頭2つ)
  const defaultSelected = useMemo(() => {
    const wanted = animEntries.filter((a) =>
      /movement|punch/i.test(a.id),
    );
    const base = wanted.length > 0 ? wanted : animEntries.slice(0, 2);
    return new Set(base.map((a) => a.id));
  }, [animEntries]);

  const [selected, setSelected] = useState<Set<string>>(defaultSelected);
  // boneNameMap(JSON) の入力。空 = binding なし(同一リグ経路)。
  const [mapText, setMapText] = useState<string>("");
  // 適用ボタンで確定した binding。これが変わると Viewer を作り直す。
  const [applied, setApplied] = useState<{
    binding?: BindingProfile;
    token: number;
  }>({ token: 0 });
  const [parseError, setParseError] = useState<string | null>(null);

  if (!maskman) {
    return (
      <Centered>
        Maskman モデル (`{MASKMAN_ID}`) が manifest にありません。先に
        `import:unity` を実行してください。
      </Centered>
    );
  }

  const animPaths = animEntries
    .filter((a) => selected.has(a.id))
    .map((a) => a.glbPath!);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyBinding = () => {
    const text = mapText.trim();
    if (text === "") {
      setParseError(null);
      setApplied((p) => ({ binding: undefined, token: p.token + 1 }));
      return;
    }
    try {
      const parsed = JSON.parse(text) as Record<string, string>;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("オブジェクト {target: source} を入力してください");
      }
      setParseError(null);
      setApplied((p) => ({
        binding: { boneNameMap: parsed },
        token: p.token + 1,
      }));
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    }
  };

  // 選択アニメ・binding が変わるたび key を変えて作り直す。
  const viewerKey = `${[...selected].sort().join(",")}|${applied.token}`;

  return (
    <BindViewerInner
      key={viewerKey}
      modelGlbPath={maskman.glbPath!}
      animPaths={animPaths}
      binding={applied.binding}
      animEntries={animEntries}
      selected={selected}
      onToggle={toggle}
      mapText={mapText}
      onMapTextChange={setMapText}
      onApply={applyBinding}
      parseError={parseError}
      hasBinding={!!applied.binding}
    />
  );
}

function BindViewerInner({
  modelGlbPath,
  animPaths,
  binding,
  animEntries,
  selected,
  onToggle,
  mapText,
  onMapTextChange,
  onApply,
  parseError,
  hasBinding,
}: {
  modelGlbPath: string;
  animPaths: string[];
  binding?: BindingProfile;
  animEntries: AssetManifestEntry[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  mapText: string;
  onMapTextChange: (v: string) => void;
  onApply: () => void;
  parseError: string | null;
  hasBinding: boolean;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [clipNames, setClipNames] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [stats, setStats] = useState<{ matched: number; skipped: number; fix: number } | null>(
    null,
  );

  const rigRef = useRef<CharacterRig | null>(null);

  const handleSceneReady = async (scene: Scene): Promise<() => void> => {
    setupEnvironment(scene);
    try {
      const fc: FightingCharacter = await loadFightingCharacter(scene, {
        modelGlbPath,
        animGlbPaths: animPaths,
        binding,
      });
      rigRef.current = fc.rig;

      // 全アニメ GLB ぶんの統計を合算
      let matched = 0;
      let skipped = 0;
      let fix = 0;
      for (const s of fc.retargetStats) {
        matched += s.matched;
        skipped += s.skipped;
        fix += s.rotationFixApplied;
      }
      setStats({ matched, skipped, fix });

      const names = [...fc.rig.clips.keys()].sort(
        (a, b) => rank(a) - rank(b) || a.localeCompare(b),
      );
      setClipNames(names);
      setStatus("ready");

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
      const rig = rigRef.current;
      if (rig) {
        for (const g of rig.clips.values()) g.dispose();
      }
      rigRef.current = null;
    };
  };

  const playClip = (name: string) => {
    const rig = rigRef.current;
    if (!rig) return;
    const target = rig.clips.get(name);
    if (!target) return;
    for (const [n, g] of rig.clips) {
      if (n !== name) g.stop();
    }
    target.start(true);
    target.setWeightForAllAnimatables(1);
    setActive(name);
  };

  return (
    <div className="relative h-full">
      <SceneCanvas onSceneReady={handleSceneReady} />

      <div className="absolute left-4 top-4 flex max-h-[calc(100vh-32px)] w-96 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/85 p-4 shadow-lg backdrop-blur">
        <Link href="/" className="text-xs text-neutral-400 hover:text-neutral-200">
          ← Home
        </Link>
        <h2 className="mt-1 text-sm font-semibold">Retarget / Bind デモ</h2>
        <p className="mt-1 text-[11px] text-neutral-500">
          Maskman に FAP クリップを再バインドして再生 (同一リグ経路の実証)。
          下の boneNameMap で「指定ボーンへの反映」を試せます。
        </p>

        {/* アニメ GLB 選択 */}
        <div className="mt-3 border-t border-neutral-800 pt-2">
          <div className="mb-1 text-xs text-neutral-400">Animation GLBs</div>
          <div className="grid max-h-28 grid-cols-1 gap-1 overflow-auto">
            {animEntries.map((a) => (
              <label
                key={a.id}
                className="flex cursor-pointer items-center gap-2 text-[11px] text-neutral-300"
              >
                <input
                  type="checkbox"
                  checked={selected.has(a.id)}
                  onChange={() => onToggle(a.id)}
                />
                {a.id} ({a.animationClips.length})
              </label>
            ))}
          </div>
        </div>

        {/* boneNameMap 入力 */}
        <div className="mt-3 border-t border-neutral-800 pt-2">
          <div className="mb-1 text-xs text-neutral-400">
            boneNameMap (target → source) JSON
          </div>
          <textarea
            value={mapText}
            onChange={(e) => onMapTextChange(e.target.value)}
            placeholder={'空 = 同一リグ\n例: {"LeftHand":"LeftForeArm"}'}
            rows={3}
            className="w-full resize-none rounded border border-neutral-700 bg-neutral-800 px-2 py-1 font-mono text-[11px] text-neutral-200"
          />
          <button
            type="button"
            onClick={onApply}
            className="mt-1 rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500"
          >
            再バインド
          </button>
          {parseError && (
            <div className="mt-1 text-[11px] text-red-400">{parseError}</div>
          )}
          <div className="mt-1 text-[10px] text-neutral-500">
            現在: {hasBinding ? "boneNameMap 適用中" : "同一リグ (名前一致)"}
          </div>
        </div>

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
                retarget: {stats.matched} matched, {stats.skipped} skipped
                {stats.fix > 0 && `, ${stats.fix} rotationFix`}
              </div>
            )}
            <div className="mt-2 min-h-0 flex-1 overflow-auto border-t border-neutral-800 pt-2">
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
