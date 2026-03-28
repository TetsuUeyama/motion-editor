import { useEffect, useRef } from 'react';
import { Scene, Engine, HighlightLayer, Vector3, Mesh, AbstractMesh, TransformNode } from '@babylonjs/core';
import { setupBabylonScene } from '@/utils/babylon-setup';
import type { DeformParams } from '@/utils/auto-rigger';

// ============================================================
// useModelImportRefs
// ============================================================

/**
 * All mutable refs used across the model-import workflow.
 */
export function useModelImportRefs() {
  const meshMapRef = useRef<Map<string, AbstractMesh[]>>(new Map());
  const centerLineRef = useRef<Mesh | null>(null);
  const skelNodesRef = useRef<Map<string, TransformNode>>(new Map());
  const skelMeshesRef = useRef<Map<string, Mesh>>(new Map());
  const restPosRef = useRef<Map<string, Vector3>>(new Map());
  const deformParamsRef = useRef<DeformParams | null>(null);
  const worldMarkersRef = useRef<Record<string, Vector3>>({});
  const resultMeshesRef = useRef<Mesh[]>([]);
  const markerMeshesRef = useRef<Map<string, Mesh>>(new Map());
  const animCallbackRef = useRef<(() => void) | null>(null);
  const animTimeRef = useRef(0);

  return {
    meshMapRef, centerLineRef, skelNodesRef, skelMeshesRef, restPosRef,
    deformParamsRef, worldMarkersRef, resultMeshesRef, markerMeshesRef,
    animCallbackRef, animTimeRef,
  };
}

// ============================================================
// useModelImportScene
// ============================================================

/**
 * model-import用のBabylon.jsシーン初期化フック
 */
export function useModelImportScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const highlightRef = useRef<HighlightLayer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { engine, scene, dispose } = setupBabylonScene({
      canvas,
      clearColor: [0.08, 0.08, 0.12, 1],
      cameraRadius: 5,
      upperRadiusLimit: 20,
      wheelPrecision: 40,
      groundSize: 10,
      stencil: true,
    });

    highlightRef.current = new HighlightLayer('hl', scene);
    sceneRef.current = scene;
    engineRef.current = engine;

    return dispose;
  }, []);

  return { canvasRef, sceneRef, engineRef, highlightRef };
}
