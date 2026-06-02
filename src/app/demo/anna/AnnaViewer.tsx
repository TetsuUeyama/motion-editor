"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

import {
  parseVox,
  buildCleanSkeleton,
  buildWeightedVoxelMesh,
  AnnaMotionPlayer,
  type AnnaSkeleton,
  type SkeletonJson,
  type BoneRegionMap,
  type VoxelWeights,
  type MotionFile,
} from "@/runtime/voxel";
import { SceneCanvas } from "@/components/SceneCanvas";

/** スライダーで動かすテスト用ボーン（剛体バインドの追従確認） */
interface TestBone {
  key: string;
  label: string;
  bone: string;
  axis: "x" | "y" | "z";
  /** 指定時はこのボーン群を同じ角度で曲げる（指のカール用：3関節を分割して屈曲） */
  chain?: string[];
}
/** 指1本の3関節（付け根→中節→末節）をまとめて曲げるチェーン */
const fingerChain = (side: "Left" | "Right", finger: string): string[] => [
  `${side}${finger}Proximal`,
  `${side}${finger}Intermediate`,
  `${side}${finger}Distal`,
];
const TEST_BONES: TestBone[] = [
  { key: "rArm", label: "右上腕", bone: "RightUpperArm", axis: "z" },
  { key: "lArm", label: "左上腕", bone: "LeftUpperArm", axis: "z" },
  { key: "rForearm", label: "右前腕", bone: "RightLowerArm", axis: "z" },
  { key: "spine", label: "背骨(前傾)", bone: "Spine", axis: "x" },
  { key: "head", label: "首", bone: "Neck", axis: "x" },
  // 指は3関節を分割して曲げる（1本に Proximal/中節/末節）。スライダーで握る/開くを再現
  { key: "lIndex", label: "左人差し指(屈曲)", bone: "LeftIndexProximal", axis: "z", chain: fingerChain("Left", "Index") },
  { key: "lThumb", label: "左親指(屈曲)", bone: "LeftThumbProximal", axis: "z", chain: fingerChain("Left", "Thumb") },
  { key: "rIndex", label: "右人差し指(屈曲)", bone: "RightIndexProximal", axis: "z", chain: fingerChain("Right", "Index") },
];

export function AnnaViewer() {
  const skelRef = useRef<AnnaSkeleton | null>(null);
  const playerRef = useRef<AnnaMotionPlayer | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ rendered: number; total: number } | null>(null);
  const [angles, setAngles] = useState<Record<string, number>>({});
  const [motions, setMotions] = useState<string[]>([]);
  const [selMotion, setSelMotion] = useState<string>("");
  const [playing, setPlaying] = useState<string | null>(null);

  const handleSceneReady = async (scene: Scene): Promise<void> => {
    setupEnvironment(scene);
    try {
      const [skinBuf, weightsJson, skelJson, brm] = await Promise.all([
        fetch("/anna/body_clean.vox").then((r) => r.arrayBuffer()),
        fetch("/anna/body_clean.weights.json").then((r) => r.json() as Promise<VoxelWeights>),
        fetch("/anna/skeleton.json").then((r) => r.json() as Promise<SkeletonJson>),
        fetch("/anna/bone_region_map.json").then((r) => r.json() as Promise<BoneRegionMap>),
      ]);

      const skinVox = parseVox(skinBuf);
      const skeleton = buildCleanSkeleton(scene, skelJson);
      skelRef.current = skeleton;

      const built = buildWeightedVoxelMesh(scene, skinVox, weightsJson, skeleton, brm);
      const player = new AnnaMotionPlayer(scene, skeleton);
      playerRef.current = player;
      // v2 リターゲットに必要な FAP rest スケルトンをロード
      try {
        const fap = await fetch("/assets/motions/fap-skeleton.json").then((r) => r.json());
        player.setFapSkeleton(fap);
      } catch {
        /* 無ければ play 時にエラー表示 */
      }

      // モーション一覧を取得（FAP アクションライブラリ）
      try {
        const idx = (await fetch("/assets/motions/index.json").then((r) => r.json())) as {
          motions: { name: string }[];
        };
        const names = idx.motions.map((m) => m.name);
        setMotions(names);
        setSelMotion(
          names.find((n) => /KB_Idle_1/.test(n)) ??
            names.find((n) => /Walk/i.test(n)) ??
            names[0] ??
            "",
        );
      } catch {
        /* モーション未生成でも静止表示は可能 */
      }

      const cam = scene.activeCamera as ArcRotateCamera | null;
      if (cam) {
        const h = built.bounds.maxY;
        cam.setTarget(new Vector3(0, h * 0.5, 0));
        cam.radius = Math.max(h * 1.5, 2);
      }

      setStats({ rendered: built.rendered, total: built.total });
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  };

  const setAngle = (t: TestBone, deg: number) => {
    // 手動操作時はモーション再生を止める
    playerRef.current?.stop();
    setPlaying(null);
    setAngles((a) => ({ ...a, [t.key]: deg }));
    const rad = (deg * Math.PI) / 180;
    // chain 指定（指）なら各関節を同角度で曲げてカールさせる
    const bones = t.chain ?? [t.bone];
    for (const bn of bones) {
      const node = skelRef.current?.nodesByName.get(bn);
      if (!node) continue;
      node.rotationQuaternion = null; // Euler を有効にする
      node.rotation = new Vector3(
        t.axis === "x" ? rad : 0,
        t.axis === "y" ? rad : 0,
        t.axis === "z" ? rad : 0,
      );
    }
  };

  const resetPose = () => {
    playerRef.current?.stop();
    setPlaying(null);
    for (const t of TEST_BONES) {
      for (const bn of t.chain ?? [t.bone]) {
        const node = skelRef.current?.nodesByName.get(bn);
        if (node) {
          node.rotationQuaternion = null;
          node.rotation = Vector3.Zero();
        }
      }
    }
    setAngles({});
  };

  const playMotion = async () => {
    if (!selMotion || !playerRef.current) return;
    try {
      const motion = (await fetch(
        `/assets/motions/${selMotion}.motion.json`,
      ).then((r) => r.json())) as MotionFile;
      playerRef.current.play(motion);
      setPlaying(selMotion);
      setAngles({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const stopMotion = () => {
    playerRef.current?.resetPose();
    setPlaying(null);
  };

  return (
    <div className="relative h-full">
      <SceneCanvas onSceneReady={handleSceneReady} />

      <div className="absolute left-4 top-4 w-72 rounded-lg border border-neutral-800 bg-neutral-900/85 p-4 shadow-lg backdrop-blur">
        <Link href="/" className="text-xs text-neutral-400 hover:text-neutral-200">
          ← Home
        </Link>
        <h2 className="mt-1 text-sm font-semibold">anna — スムーススキン</h2>

        {status === "loading" && (
          <div className="mt-3 text-xs text-neutral-400">読み込み中…</div>
        )}
        {error && (
          <div className="mt-3 rounded border border-red-700/50 bg-red-900/30 p-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {stats && (
          <>
            <div className="mt-3 text-[11px] text-neutral-400">
              <div>rendered: {stats.rendered.toLocaleString()} / {stats.total.toLocaleString()}</div>
              <div className="text-neutral-500">
                smooth skin（body_clean.weights.json・最大4ボーン・指対応）
              </div>
            </div>

            <div className="mt-3 border-t border-neutral-800 pt-3">
              <div className="mb-2 text-xs text-neutral-400">
                FAP モーション適用（v1・崩れ確認）
              </div>
              <select
                value={selMotion}
                onChange={(e) => setSelMotion(e.target.value)}
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200"
              >
                {motions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <div className="mt-2 flex gap-1">
                <button
                  type="button"
                  onClick={playMotion}
                  className="flex-1 rounded bg-emerald-600/80 px-2 py-1 text-xs text-white hover:bg-emerald-600"
                >
                  ▶ 再生
                </button>
                <button
                  type="button"
                  onClick={stopMotion}
                  className="flex-1 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                >
                  ■ 停止
                </button>
              </div>
              {playing && (
                <div className="mt-1 text-[11px] text-emerald-400">
                  再生中: {playing}
                </div>
              )}
            </div>

            <div className="mt-3 border-t border-neutral-800 pt-3">
              <div className="mb-2 flex items-center justify-between text-xs text-neutral-400">
                <span>ボーンを回す（追従確認）</span>
                <button
                  type="button"
                  onClick={resetPose}
                  className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] hover:bg-neutral-800"
                >
                  リセット
                </button>
              </div>
              <div className="space-y-2">
                {TEST_BONES.map((t) => (
                  <label key={t.key} className="block text-[11px] text-neutral-300">
                    <div className="flex justify-between">
                      <span>{t.label}</span>
                      <span className="font-mono text-neutral-500">
                        {Math.round(angles[t.key] ?? 0)}°
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-90}
                      max={90}
                      value={angles[t.key] ?? 0}
                      onChange={(e) => setAngle(t, Number(e.target.value))}
                      className="w-full"
                    />
                  </label>
                ))}
              </div>
              <div className="mt-2 text-[11px] text-neutral-500">
                スライダーで腕などのボーンを回すと、その部位＋子(前腕/手)のボクセルが追従すれば剛体バインド成功です。
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function setupEnvironment(scene: Scene): void {
  scene.clearColor.set(0.04, 0.05, 0.07, 1);

  const camera = new ArcRotateCamera(
    "camera",
    -Math.PI / 2,
    Math.PI / 2.3,
    3,
    new Vector3(0, 1, 0),
    scene,
  );
  camera.attachControl(undefined, true);
  camera.lowerRadiusLimit = 0.5;
  camera.upperRadiusLimit = 20;
  camera.wheelDeltaPercentage = 0.02;

  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.85;
  const dir = new DirectionalLight("dir", new Vector3(-0.5, -1, -0.4), scene);
  dir.intensity = 0.5;

  const ground = MeshBuilder.CreateGround("ground", { width: 12, height: 12 }, scene);
  const groundMat = new StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = new Color3(0.15, 0.16, 0.2);
  groundMat.specularColor = Color3.Black();
  ground.material = groundMat;
}
