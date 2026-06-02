import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";

/**
 * tools/unity-import/editor/ を Unity プロジェクトの Assets/MotionEditor/Editor/ に
 * 同期する。すでにあるファイルは上書き。Unity 側で改造したい場合は
 * CLI 側で `--no-sync` を渡して呼ばないようにする。
 */
export function syncEditorScripts(opts: {
  source: string;
  unityProjectPath: string;
}): { dest: string; copied: string[] } {
  const dest = join(opts.unityProjectPath, "Assets", "MotionEditor", "Editor");
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const copied: string[] = [];
  walk(opts.source, opts.source, dest, copied);
  return { dest, copied };
}

function walk(
  root: string,
  current: string,
  destBase: string,
  copied: string[],
): void {
  for (const name of readdirSync(current)) {
    const abs = join(current, name);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      walk(root, abs, destBase, copied);
      continue;
    }
    if (!shouldCopy(name)) continue;

    const rel = abs.substring(root.length + 1);
    const out = join(destBase, rel);
    const outDir = dirname(out);
    if (outDir && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    cpSync(abs, out);
    copied.push(rel);
  }
}

function shouldCopy(name: string): boolean {
  // README は同期不要、.meta は Unity が自動生成するので触らない
  if (name === "README.md") return false;
  if (name.endsWith(".meta")) return false;
  return true;
}
