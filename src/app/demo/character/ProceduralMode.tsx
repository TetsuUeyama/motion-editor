"use client";

import { useEffect, useRef, useState } from "react";
import type { Scene } from "@babylonjs/core/scene";

import { Animator } from "@/runtime";
import { SceneCanvas } from "@/components/SceneCanvas";
import { setupSampleScene, SAMPLE_ANIMATOR_JSON } from "./sampleScene";

/**
 * 手続きキャラ + 手書き Animator JSON のデモ。Unity アセット不要なので
 * パイプライン未実行でも動作確認できる。
 */
export function ProceduralMode() {
  const animatorRef = useRef<Animator | null>(null);
  const [speed, setSpeed] = useState(0);
  const [currentState, setCurrentState] = useState("Idle");

  useEffect(() => {
    animatorRef.current?.setFloat("speed", speed);
  }, [speed]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const s = animatorRef.current?.getCurrentState();
      if (s) setCurrentState(s);
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  const handleSceneReady = (scene: Scene): (() => void) => {
    const { groups } = setupSampleScene(scene);
    const animator = new Animator(scene, SAMPLE_ANIMATOR_JSON, groups, {
      autoTick: true,
    });
    animatorRef.current = animator;
    return () => {
      animator.dispose();
      animatorRef.current = null;
    };
  };

  return (
    <div className="relative h-full">
      <SceneCanvas onSceneReady={handleSceneReady} />

      <div className="absolute left-4 top-4 w-72 rounded-lg border border-neutral-800 bg-neutral-900/85 p-4 shadow-lg backdrop-blur">
        <h2 className="text-sm font-semibold">Procedural Sample</h2>
        <p className="mt-1 text-xs text-neutral-400">
          Box+Sphere の簡易キャラ + 手書き Animator JSON。
        </p>
        <div className="mt-2 text-xs text-neutral-500">
          Current State:{" "}
          <span className="font-mono text-neutral-200">{currentState}</span>
        </div>

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-xs">
            <label htmlFor="speed">speed (Float)</label>
            <span className="font-mono text-neutral-300">{speed.toFixed(2)}</span>
          </div>
          <input
            id="speed"
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="mt-1 flex justify-between text-[10px] text-neutral-500">
            <span>Idle</span>
            <span>0.1 ⇒ Walk</span>
            <span>1.0 ⇒ Run</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => animatorRef.current?.setTrigger("attack")}
          className="mt-5 w-full rounded-md border border-blue-500/40 bg-blue-500/15 py-2 text-sm font-medium text-blue-200 transition hover:bg-blue-500/25"
        >
          attack (Trigger)
        </button>
      </div>
    </div>
  );
}
