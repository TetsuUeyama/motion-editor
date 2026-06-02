#!/usr/bin/env tsx
/**
 * FAP リグの rest スケルトン（全ノードの階層＋rest 局所回転＋標準ボーン名）を
 * GLB から書き出す。全 GLB で同一リグなので 1 本から生成すれば足りる。
 *
 * リターゲット(v2)の FK に必要:
 *  - 各ノードの parent
 *  - rest 局所回転 (node.rotation の既定値)
 *  - source名 → 標準名 (bone-mapping.json)
 *
 * 出力: public/assets/motions/fap-skeleton.json
 * 使い方: npx tsx tools/motion-lib/export-fap-skeleton.ts --out public/assets
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";

interface GltfNode {
  name?: string;
  rotation?: [number, number, number, number];
  children?: number[];
}

function readGlbJson(path: string): { nodes?: GltfNode[] } {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`not GLB: ${path}`);
  const clen = buf.readUInt32LE(12);
  return JSON.parse(buf.toString("utf8", 20, 20 + clen));
}

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { out: { type: "string", default: "public/assets" } },
  });
  const outAbs = resolve(values.out!);
  const manifest = JSON.parse(
    readFileSync(join(outAbs, "assets-manifest.json"), "utf8"),
  ) as { assets: { id: string; glbPath?: string; boneMappingPath?: string }[] };

  // GLB と bone-mapping を持つ最初のアセット
  const asset = manifest.assets.find((a) => a.glbPath && a.boneMappingPath);
  if (!asset) throw new Error("no asset with glb + boneMapping");

  const json = readGlbJson(join(outAbs, asset.glbPath!));
  const nodes = json.nodes ?? [];

  // source名 → 標準名
  const bm = JSON.parse(
    readFileSync(join(outAbs, asset.boneMappingPath!), "utf8"),
  ) as { entries: { standardName: string; sourceName: string }[] };
  const srcToStd: Record<string, string> = {};
  for (const e of bm.entries) srcToStd[e.sourceName] = e.standardName;

  // child → parent
  const parent = new Array<number>(nodes.length).fill(-1);
  nodes.forEach((n, i) => {
    for (const c of n.children ?? []) parent[c] = i;
  });

  const out = {
    generatedAt: new Date().toISOString(),
    source: asset.id,
    nodes: nodes.map((n, i) => ({
      name: n.name ?? `node${i}`,
      parent: parent[i],
      rest: n.rotation ?? [0, 0, 0, 1],
      std: (n.name && srcToStd[n.name]) || null,
    })),
  };

  if (!existsSync(join(outAbs, "motions")))
    throw new Error("run export:motions first (motions/ dir missing)");
  writeFileSync(
    join(outAbs, "motions", "fap-skeleton.json"),
    JSON.stringify(out, null, 2),
  );
  const mapped = out.nodes.filter((n) => n.std).length;
  console.log(
    `[fap-skeleton] ${out.nodes.length} nodes (${mapped} mapped to standard) → motions/fap-skeleton.json`,
  );
}

main();
