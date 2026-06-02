"use client";

import { useEffect, useRef } from "react";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";

export interface SceneCanvasProps {
  /** Engine と Scene が用意できた直後に呼ばれる。返した dispose は unmount 時に呼ばれる */
  onSceneReady: (scene: Scene) => void | (() => void) | Promise<void | (() => void)>;
  className?: string;
}

/**
 * Babylon.js Engine + Scene を React の lifecycle に合わせて作る薄いラッパー。
 * onSceneReady から dispose 関数を返せばそれが unmount 時に呼ばれる。
 */
export function SceneCanvas({ onSceneReady, className }: SceneCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
    const scene = new Scene(engine);

    let cancelled = false;
    let userDispose: void | (() => void);
    Promise.resolve(onSceneReady(scene)).then((d) => {
      if (cancelled) return;
      userDispose = d ?? undefined;
    });

    engine.runRenderLoop(() => {
      scene.render();
    });

    const handleResize = () => engine.resize();
    window.addEventListener("resize", handleResize);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", handleResize);
      if (typeof userDispose === "function") userDispose();
      scene.dispose();
      engine.dispose();
    };
    // onSceneReady を deps に入れると親で useCallback 必須になり面倒なので意図的に空。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className ?? "block h-full w-full outline-none"}
    />
  );
}
