"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import type { AssetManifestJson } from "@/runtime";
import { PoseViewer } from "./PoseViewer";

type State =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; manifest: AssetManifestJson };

/**
 * feature2 デモ: ベースモーション (KB_Idle_1 / KB_WalkFwd1) の上に
 * キャラ個性 (腰の曲げ・腕の角度・注視) をライブで乗せる様子を見せる。
 */
export default function PosePage() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/assets/assets-manifest.json", {
          cache: "no-store",
        });
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: "missing" });
          return;
        }
        const manifest = (await res.json()) as AssetManifestJson;
        setState({ status: "ready", manifest });
      } catch {
        if (!cancelled) setState({ status: "missing" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="h-screen w-screen">
      {state.status === "loading" && (
        <Centered>manifest を読み込み中…</Centered>
      )}
      {state.status === "missing" && (
        <Centered>
          <div>
            <p>`/assets/assets-manifest.json` が見つかりません。</p>
            <p className="mt-2 text-neutral-500">
              先に <code>npm run import:unity</code> でアセットを書き出して
              ください。
            </p>
            <Link
              href="/"
              className="mt-4 inline-block text-blue-400 hover:text-blue-300"
            >
              ← Home
            </Link>
          </div>
        </Centered>
      )}
      {state.status === "ready" && <PoseViewer manifest={state.manifest} />}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-neutral-300">
      {children}
    </div>
  );
}
