#!/usr/bin/env tsx
/**
 * Unity の FBX `.meta`（ModelImporter.clipAnimations）から各クリップの
 * 「再生設定」を抜き出して clip-settings.json を生成する。
 *
 * GLB にはボーンの曲線しか焼かれない（loop/root motion/events は入らない）ため、
 * これらの設定を別ファイルにしてランタイムが参照できるようにする。
 *
 * 使い方:
 *   npx tsx tools/unity-import/cli/extract-clip-settings.ts \
 *     --project "C:\\Users\\user\\My project" --out public/assets
 *
 * 入力: <out>/assets-manifest.json（import:unity が生成済みのもの）
 * 出力: <out>/clip-settings.json
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";

interface ManifestEntry {
  id: string;
  sourcePath: string;
  animationClips: string[];
}
interface Manifest {
  assets: ManifestEntry[];
}

interface RootMotionAxes {
  /** true = ルートモーションがこの軸を駆動する（Bake Into Pose が OFF） */
  rotation: boolean;
  positionY: boolean;
  positionXZ: boolean;
}
interface ClipSettings {
  name: string;
  /** ループ再生するか (loopTime) */
  loop: boolean;
  firstFrame: number;
  lastFrame: number;
  /** ルートモーションが各軸を動かすか。positionXZ=true なら水平移動する */
  rootMotion: RootMotionAxes;
  /** Bake Into Pose の生フラグ（loopBlend*） */
  bakeIntoPose: RootMotionAxes;
  /** アニメイベント（FAP は基本空） */
  events: { time: number; functionName: string }[];
}
interface ClipSettingsAsset {
  id: string;
  sourcePath: string;
  clips: ClipSettings[];
}
interface ClipSettingsJson {
  generatedAt: string;
  source: string;
  assets: ClipSettingsAsset[];
}

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      project: { type: "string" },
      out: { type: "string", default: "public/assets" },
    },
  });
  if (!values.project) throw new Error("--project <UnityProjectDir> is required");

  const projectAbs = resolve(values.project);
  const outAbs = resolve(values.out!);
  const manifestPath = join(outAbs, "assets-manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `assets-manifest.json not found at ${manifestPath}. Run import:unity first.`,
    );
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const result: ClipSettingsJson = {
    generatedAt: new Date().toISOString(),
    source: "Unity ModelImporter clipAnimations (.meta)",
    assets: [],
  };

  let totalClips = 0;
  for (const entry of manifest.assets) {
    if (!entry.sourcePath.toLowerCase().endsWith(".fbx")) continue;
    const metaPath = join(projectAbs, entry.sourcePath + ".meta");
    if (!existsSync(metaPath)) {
      console.warn(`[clip-settings] .meta not found, skip: ${metaPath}`);
      continue;
    }
    const clips = parseClipAnimations(readFileSync(metaPath, "utf8"));
    if (clips.length === 0) continue;
    result.assets.push({ id: entry.id, sourcePath: entry.sourcePath, clips });
    totalClips += clips.length;
  }

  writeFileSync(
    join(outAbs, "clip-settings.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    `[clip-settings] wrote ${result.assets.length} asset(s), ${totalClips} clip(s) → ${join(outAbs, "clip-settings.json")}`,
  );
}

/**
 * .meta の `clipAnimations:` 配下を行スキャンで解析する。
 * 各クリップは "    - serializedVersion:" で始まり、フィールドは 6 スペース字下げ。
 */
function parseClipAnimations(metaText: string): ClipSettings[] {
  const lines = metaText.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*clipAnimations:\s*$/.test(l));
  if (start < 0) return [];

  const clips: ClipSettings[] = [];
  let cur: Record<string, string> | null = null;
  const push = () => {
    if (!cur) return;
    const num = (k: string, d = 0) => {
      const v = cur![k];
      return v === undefined ? d : Number(v);
    };
    const bool = (k: string) => num(k) === 1;
    clips.push({
      name: cur["name"] ?? cur["takeName"] ?? "(unnamed)",
      loop: bool("loopTime"),
      firstFrame: num("firstFrame"),
      lastFrame: num("lastFrame"),
      // Bake Into Pose (loopBlend*) が ON のとき root はその軸を動かさない
      rootMotion: {
        rotation: num("loopBlendOrientation") === 0,
        positionY: num("loopBlendPositionY") === 0,
        positionXZ: num("loopBlendPositionXZ") === 0,
      },
      bakeIntoPose: {
        rotation: bool("loopBlendOrientation"),
        positionY: bool("loopBlendPositionY"),
        positionXZ: bool("loopBlendPositionXZ"),
      },
      events: [], // FAP は events: [] 。非空対応は将来拡張
    });
  };

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s{4}- serializedVersion:/.test(line)) {
      push();
      cur = {};
      continue;
    }
    // 6 スペース以上のフィールド行
    const f = line.match(/^\s{6,}([A-Za-z0-9_]+):\s*(.*)$/);
    if (f && cur) {
      // transformMask / curves 内のネスト行は無視したい。既知キーだけ拾う。
      const known = new Set([
        "name",
        "takeName",
        "firstFrame",
        "lastFrame",
        "loopTime",
        "loopBlendOrientation",
        "loopBlendPositionY",
        "loopBlendPositionXZ",
      ]);
      if (known.has(f[1]) && cur[f[1]] === undefined) cur[f[1]] = f[2];
      continue;
    }
    // 4 スペース以下の通常キー（"- " でない）に当たったら clipAnimations 終了
    if (/^\s{0,4}[A-Za-z0-9_]+:/.test(line) && !/^\s*-\s/.test(line)) {
      break;
    }
  }
  push();
  return clips;
}

main();
