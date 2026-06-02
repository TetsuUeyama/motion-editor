import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";

/**
 * Unity Editor 実行ファイルのパスを解決する。
 *
 * 解決優先順:
 *   1. 明示指定 (CLI --unity または引数)
 *   2. 環境変数 UNITY_PATH
 *   3. プラットフォームごとの既知のインストール場所を探索
 *      (Unity Hub の `Editor/<version>/Editor/...` 構造を含む)
 *
 * 複数バージョンが見つかった場合はバージョン文字列で降順ソートして最新を返す。
 */
export function locateUnity(explicit?: string): string {
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`Unity executable not found: ${explicit}`);
    }
    return explicit;
  }

  const fromEnv = process.env.UNITY_PATH;
  if (fromEnv) {
    if (!existsSync(fromEnv)) {
      throw new Error(`UNITY_PATH points to missing file: ${fromEnv}`);
    }
    return fromEnv;
  }

  const candidates = candidatePaths();
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  throw new Error(
    [
      "Could not locate Unity Editor.",
      "Pass --unity <path> or set UNITY_PATH env variable.",
      "Searched:",
      ...candidates.map((p) => "  " + p),
    ].join("\n"),
  );
}

function candidatePaths(): string[] {
  const os = platform();
  const results: string[] = [];

  if (os === "win32") {
    const hubRoots = [
      "C:\\Program Files\\Unity\\Hub\\Editor",
      "C:\\Program Files (x86)\\Unity\\Hub\\Editor",
    ];
    for (const root of hubRoots) {
      if (!existsSync(root)) continue;
      for (const ver of safeReaddir(root)) {
        const exe = join(root, ver, "Editor", "Unity.exe");
        if (existsSync(exe)) results.push(exe);
      }
    }
    const single = "C:\\Program Files\\Unity\\Editor\\Unity.exe";
    if (existsSync(single)) results.push(single);
  } else if (os === "darwin") {
    const hubRoot = "/Applications/Unity/Hub/Editor";
    if (existsSync(hubRoot)) {
      for (const ver of safeReaddir(hubRoot)) {
        const exe = join(
          hubRoot,
          ver,
          "Unity.app",
          "Contents",
          "MacOS",
          "Unity",
        );
        if (existsSync(exe)) results.push(exe);
      }
    }
    const single = "/Applications/Unity/Unity.app/Contents/MacOS/Unity";
    if (existsSync(single)) results.push(single);
  } else {
    // linux
    const hubRoot = "/opt/unityhub/editor";
    if (existsSync(hubRoot)) {
      for (const ver of safeReaddir(hubRoot)) {
        const exe = join(hubRoot, ver, "Editor", "Unity");
        if (existsSync(exe)) results.push(exe);
      }
    }
    const candidates = ["/opt/Unity/Editor/Unity", "/usr/bin/unity-editor"];
    for (const c of candidates) if (existsSync(c)) results.push(c);
  }

  // バージョン降順 (Hub のディレクトリ名は "2022.3.55f1" 等なので文字列降順で十分)
  results.sort((a, b) => b.localeCompare(a));
  return results;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir).filter((entry) =>
      statSync(join(dir, entry)).isDirectory(),
    );
  } catch {
    return [];
  }
}
