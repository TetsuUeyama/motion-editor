"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import type { AssetManifestJson } from "@/runtime";
import { CombatViewer } from "./CombatViewer";

type State =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; manifest: AssetManifestJson };

export default function CombatPage() {
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
      {state.status === "loading" && <Centered>manifest を読み込み中…</Centered>}
      {state.status === "missing" && (
        <Centered>
          <div>
            <p>`/assets/assets-manifest.json` が見つかりません。</p>
            <p className="mt-2 text-neutral-500">
              先に <code>npm run import:unity</code> で Fighting Animset Pro を
              書き出してください。
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
      {state.status === "ready" && <CombatViewer manifest={state.manifest} />}
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
