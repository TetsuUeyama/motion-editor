"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import type { AssetManifestJson } from "@/runtime";
import { ProceduralMode } from "./ProceduralMode";
import { UnityMode } from "./UnityMode";

type Mode = "procedural" | "unity";

interface ManifestState {
  status: "loading" | "available" | "missing";
  manifest?: AssetManifestJson;
}

export default function CharacterDemo() {
  const [manifestState, setManifestState] = useState<ManifestState>({
    status: "loading",
  });
  const [mode, setMode] = useState<Mode>("procedural");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/assets/assets-manifest.json", {
          cache: "no-store",
        });
        if (cancelled) return;
        if (!res.ok) {
          setManifestState({ status: "missing" });
          return;
        }
        const m = (await res.json()) as AssetManifestJson;
        const hasGlb = m.assets.some((a) => a.glbPath);
        if (hasGlb) {
          setManifestState({ status: "available", manifest: m });
          setMode("unity");
        } else {
          setManifestState({ status: "missing" });
        }
      } catch {
        if (!cancelled) setManifestState({ status: "missing" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const unityAvailable = manifestState.status === "available";

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
        <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
          ← Home
        </Link>
        <div className="text-sm font-medium">Character Animator Demo</div>
        <ModeSwitch
          mode={mode}
          setMode={setMode}
          unityAvailable={unityAvailable}
        />
      </header>

      <div className="flex-1 overflow-hidden">
        {mode === "procedural" && <ProceduralMode />}
        {mode === "unity" && manifestState.manifest && (
          <UnityMode manifest={manifestState.manifest} />
        )}
      </div>
    </div>
  );
}

function ModeSwitch({
  mode,
  setMode,
  unityAvailable,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  unityAvailable: boolean;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-neutral-800 bg-neutral-900 p-0.5 text-xs">
      <button
        type="button"
        onClick={() => setMode("procedural")}
        className={
          "rounded px-3 py-1 " +
          (mode === "procedural"
            ? "bg-neutral-700 text-neutral-100"
            : "text-neutral-400 hover:text-neutral-200")
        }
      >
        Procedural
      </button>
      <button
        type="button"
        onClick={() => unityAvailable && setMode("unity")}
        disabled={!unityAvailable}
        title={
          unityAvailable
            ? "Unity 取り込み済みアセットを使う"
            : "public/assets/assets-manifest.json が見つかりません"
        }
        className={
          "rounded px-3 py-1 transition " +
          (mode === "unity"
            ? "bg-neutral-700 text-neutral-100"
            : unityAvailable
              ? "text-neutral-400 hover:text-neutral-200"
              : "cursor-not-allowed text-neutral-600")
        }
      >
        Unity Asset
      </button>
    </div>
  );
}
