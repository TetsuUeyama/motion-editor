#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";

import { locateUnity } from "./locate-unity";
import { syncEditorScripts } from "./sync-editor";

interface CliOptions {
  project: string;
  out: string;
  unity?: string;
  assets?: string;
  noSync?: boolean;
  logFile?: string;
}

const HELP = `motion-editor :: Unity → Babylon.js asset import

Usage:
  npm run import:unity -- --project <UnityProjectDir> [options]

Options:
  --project <dir>   (required) Unity project root (contains Assets/, ProjectSettings/)
  --out <dir>       Output directory for converted assets (default: public/assets)
  --unity <path>    Unity Editor executable. Defaults to UNITY_PATH env or auto-detect.
  --assets <csv>    Comma-separated Asset Database paths to export.
                    Example: Assets/Models/Hero.fbx,Assets/Animations/HeroController.controller
                    If omitted, BatchExporter will export all Prefabs / Models / AnimatorControllers.
  --no-sync         Skip copying tools/unity-import/editor/ into the Unity project.
  --log-file <path> Path to capture Unity's editor.log (default: <out>/.unity-import.log)
  --help            Print this help.
`;

async function main(): Promise<void> {
  const opts = parseCli();

  const projectAbs = resolve(opts.project);
  if (!existsSync(join(projectAbs, "Assets"))) {
    throw new Error(
      `--project is not a Unity project (no Assets/ folder): ${projectAbs}`,
    );
  }

  const outAbs = resolve(opts.out);
  mkdirSync(outAbs, { recursive: true });

  const unityExe = locateUnity(opts.unity);
  console.log(`[motion-editor] Unity   : ${unityExe}`);
  console.log(`[motion-editor] Project : ${projectAbs}`);
  console.log(`[motion-editor] Output  : ${outAbs}`);

  // Editor スクリプト同期 (npm run cwd = リポジトリルートを前提)
  if (!opts.noSync) {
    const editorSrc = resolve(
      process.cwd(),
      "tools",
      "unity-import",
      "editor",
    );
    if (!existsSync(editorSrc)) {
      throw new Error(
        `Editor scripts not found at ${editorSrc}. ` +
          "Run this command from the repository root (where tools/ lives).",
      );
    }
    const result = syncEditorScripts({
      source: editorSrc,
      unityProjectPath: projectAbs,
    });
    console.log(
      `[motion-editor] Synced ${result.copied.length} editor file(s) → ${result.dest}`,
    );
  }

  const logFile = opts.logFile
    ? resolve(opts.logFile)
    : join(outAbs, ".unity-import.log");

  const exit = await runUnity(unityExe, {
    projectPath: projectAbs,
    output: outAbs,
    assets: opts.assets,
    logFile,
  });

  if (exit !== 0) {
    console.error(
      `[motion-editor] Unity exited with code ${exit}. Log: ${logFile}`,
    );
    process.exitCode = exit;
    return;
  }

  reportManifest(outAbs);
}

function parseCli(): CliOptions {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      project: { type: "string" },
      out: { type: "string", default: "public/assets" },
      unity: { type: "string" },
      assets: { type: "string" },
      "no-sync": { type: "boolean", default: false },
      "log-file": { type: "string" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (!values.project) {
    console.error(HELP);
    throw new Error("--project is required");
  }

  return {
    project: values.project,
    out: values.out!,
    unity: values.unity,
    assets: values.assets,
    noSync: values["no-sync"] === true,
    logFile: values["log-file"],
  };
}

function runUnity(
  unityExe: string,
  args: {
    projectPath: string;
    output: string;
    assets?: string;
    logFile: string;
  },
): Promise<number> {
  const cliArgs = [
    "-batchmode",
    "-nographics",
    "-quit",
    "-projectPath",
    args.projectPath,
    "-executeMethod",
    "MotionEditor.BatchExporter.ExportFromCommandLine",
    "-motionEditorOutput",
    args.output,
    "-logFile",
    args.logFile,
  ];
  if (args.assets) {
    cliArgs.push("-motionEditorAssets", args.assets);
  }

  console.log(
    `[motion-editor] Running: ${unityExe} ${cliArgs.map(quoteIfNeeded).join(" ")}`,
  );

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(unityExe, cliArgs, {
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", rejectPromise);
    child.on("exit", (code) => resolvePromise(code ?? 1));
  });
}

function quoteIfNeeded(s: string): string {
  return /\s/.test(s) ? `"${s}"` : s;
}

function reportManifest(outDir: string): void {
  const manifestPath = join(outDir, "assets-manifest.json");
  if (!existsSync(manifestPath)) {
    console.warn(
      `[motion-editor] No assets-manifest.json was produced at ${manifestPath}.`,
    );
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    assets: { id: string; glbPath?: string; animatorPath?: string }[];
  };
  console.log(`[motion-editor] Exported ${manifest.assets.length} asset(s):`);
  for (const a of manifest.assets) {
    const parts = [a.id];
    if (a.glbPath) parts.push(`glb=${a.glbPath}`);
    if (a.animatorPath) parts.push(`animator=${a.animatorPath}`);
    console.log("  - " + parts.join("  "));
  }
}

main().catch((e) => {
  console.error(`[motion-editor] ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
