#!/usr/bin/env tsx
/**
 * 各 GLB に焼かれたアニメーションを「1クリップ = 1 JSON」に分解し、
 * ボーン名を標準(Humanoid)名へ正規化したモデル非依存の "アクションファイル" を出力する。
 *
 * - 入力: public/assets/assets-manifest.json（各アセットの glbPath / boneMappingPath）
 *         public/assets/clip-settings.json（loop / rootMotion / events）
 * - 出力: public/assets/motions/<clipName>.motion.json （クリップごと）
 *         public/assets/motions/index.json （一覧）
 *
 * JSON にはボーン別の TRS キーフレームが入るので、どのモデルでも
 * 「標準名 → ターゲットのボーン名」マップさえあれば適用できる。
 *
 * 使い方: npx tsx tools/motion-lib/export-motions.ts --out public/assets
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { parseArgs } from "node:util";

// ----------------------------------------------------------------- glTF 型
interface Gltf {
  nodes?: { name?: string }[];
  accessors?: GltfAccessor[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  animations?: GltfAnimation[];
}
interface GltfAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number; // 5126 = FLOAT
  count: number;
  type: "SCALAR" | "VEC2" | "VEC3" | "VEC4";
}
interface GltfAnimation {
  name?: string;
  channels: { sampler: number; target: { node: number; path: string } }[];
  samplers: { input: number; output: number; interpolation?: string }[];
}

const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

// --------------------------------------------------------- 出力モーション型
interface Keyframe {
  t: number;
  v: number[];
}
interface BoneTrack {
  rotation?: Keyframe[];
  position?: Keyframe[];
  scale?: Keyframe[];
}
interface MotionFile {
  name: string;
  source: string;
  frameRate: number;
  duration: number;
  settings: unknown;
  /** 標準(Humanoid)ボーン名 → トラック（マップ済み主要ボーン） */
  tracks: Record<string, BoneTrack>;
  /** 標準名に対応しない生ボーン名 → トラック（twist / Root 等） */
  auxTracks: Record<string, BoneTrack>;
  /** 標準名 → このソースの生ボーン名（参考） */
  boneMap: Record<string, string>;
}

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      out: { type: "string", default: "public/assets" },
      round: { type: "string", default: "6" },
    },
  });
  const outAbs = resolve(values.out!);
  const round = Number(values.round);
  const motionsDir = join(outAbs, "motions");
  mkdirSync(motionsDir, { recursive: true });

  const manifest = JSON.parse(
    readFileSync(join(outAbs, "assets-manifest.json"), "utf8"),
  ) as { assets: { id: string; glbPath?: string; boneMappingPath?: string }[] };

  const clipSettings = loadClipSettings(join(outAbs, "clip-settings.json"));

  const index: { name: string; file: string; source: string; bones: number }[] = [];
  let totalClips = 0;
  // 同名クリップ（BindPose/tpose や複数 FBX に跨る共有クリップ）の重複を排除
  const seen = new Set<string>();
  const SKIP = new Set(["BindPose", "tpose"]);

  for (const asset of manifest.assets) {
    if (!asset.glbPath) continue;
    const glbPath = join(outAbs, asset.glbPath);
    if (!existsSync(glbPath)) continue;

    // source(FAP)名 → standard名 の逆引き
    const sourceToStandard = asset.boneMappingPath
      ? loadSourceToStandard(join(outAbs, asset.boneMappingPath))
      : {};

    const { json, bin } = parseGlb(glbPath);
    const nodeName = (i: number) => json.nodes?.[i]?.name ?? `node${i}`;

    for (const anim of json.animations ?? []) {
      const clipName = anim.name ?? "(unnamed)";
      if (SKIP.has(clipName) || seen.has(clipName)) continue;
      seen.add(clipName);
      const motion: MotionFile = {
        name: clipName,
        source: `Fighting Animset Pro / ${asset.id}`,
        frameRate: 0,
        duration: 0,
        settings: clipSettings[clipName] ?? null,
        tracks: {},
        auxTracks: {},
        boneMap: {},
      };

      let maxT = 0;
      for (const ch of anim.channels) {
        const sampler = anim.samplers[ch.sampler];
        if (!sampler) continue;
        const times = readAccessor(json, bin, sampler.input); // SCALAR
        const values = readAccessor(json, bin, sampler.output); // VEC3/VEC4
        const comp =
          ch.target.path === "rotation" ? 4 : 3; // rotation=quat(4), translation/scale=vec3
        const keys: Keyframe[] = [];
        for (let k = 0; k < times.length; k++) {
          const t = times[k];
          if (t > maxT) maxT = t;
          keys.push({
            t: r(t, round),
            v: Array.from({ length: comp }, (_, c) => r(values[k * comp + c], round)),
          });
        }

        const src = nodeName(ch.target.node);
        const std = sourceToStandard[src];
        const bucket = std ? motion.tracks : motion.auxTracks;
        const key = std ?? src;
        if (std) motion.boneMap[std] = src;
        const track = (bucket[key] ??= {});
        const prop =
          ch.target.path === "rotation"
            ? "rotation"
            : ch.target.path === "translation"
              ? "position"
              : ch.target.path === "scale"
                ? "scale"
                : null;
        if (prop) (track as Record<string, Keyframe[]>)[prop] = keys;
      }

      motion.duration = r(maxT, round);
      // fps 推定: 隣接キーの最小間隔から
      motion.frameRate = estimateFps(anim, json, bin);

      const fileName = `${clipName}.motion.json`;
      writeFileSync(join(motionsDir, fileName), JSON.stringify(motion));
      index.push({
        name: clipName,
        file: `motions/${fileName}`,
        source: motion.source,
        bones:
          Object.keys(motion.tracks).length + Object.keys(motion.auxTracks).length,
      });
      totalClips++;
    }
  }

  writeFileSync(
    join(motionsDir, "index.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), motions: index }, null, 2),
  );
  console.log(
    `[export-motions] wrote ${totalClips} motion file(s) → ${motionsDir}`,
  );
}

// ----------------------------------------------------------------- helpers

function r(n: number, digits: number): number {
  const p = Math.pow(10, digits);
  return Math.round(n * p) / p;
}

function parseGlb(path: string): { json: Gltf; bin: Buffer } {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`not a GLB: ${path}`);
  let off = 12;
  let json: Gltf | null = null;
  let bin: Buffer | null = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8")); // JSON
    else if (type === 0x004e4942) bin = data; // BIN
    off += 8 + len;
  }
  if (!json || !bin) throw new Error(`GLB missing JSON/BIN: ${path}`);
  return { json, bin };
}

/** アクセサを Float32 配列として読む（FLOAT・非インターリーブ前提） */
function readAccessor(json: Gltf, bin: Buffer, accessorIndex: number): Float32Array {
  const acc = json.accessors![accessorIndex];
  if (acc.componentType !== 5126) {
    throw new Error(`unsupported componentType ${acc.componentType} (expected FLOAT)`);
  }
  const view = json.bufferViews![acc.bufferView];
  const comps = TYPE_COMPONENTS[acc.type];
  const byteOffset = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const count = acc.count * comps;
  // bin の中で該当領域を Float32 として解釈
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = bin.readFloatLE(byteOffset + i * 4);
  }
  return out;
}

function estimateFps(anim: GltfAnimation, json: Gltf, bin: Buffer): number {
  // 最もキー数が多い sampler の input から平均間隔を取って 1/Δt
  let best: Float32Array | null = null;
  for (const s of anim.samplers) {
    const t = readAccessor(json, bin, s.input);
    if (!best || t.length > best.length) best = t;
  }
  if (!best || best.length < 2) return 30;
  const dt = (best[best.length - 1] - best[0]) / (best.length - 1);
  return dt > 0 ? Math.round(1 / dt) : 30;
}

function loadClipSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const j = JSON.parse(readFileSync(path, "utf8")) as {
    assets: { clips: { name: string }[] }[];
  };
  const map: Record<string, unknown> = {};
  for (const a of j.assets) for (const c of a.clips) map[c.name] = c;
  return map;
}

function loadSourceToStandard(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const j = JSON.parse(readFileSync(path, "utf8")) as {
    entries: { standardName: string; sourceName: string }[];
  };
  const map: Record<string, string> = {};
  for (const e of j.entries) map[e.sourceName] = e.standardName;
  return map;
}

void dirname; // (reserved)
main();
