import { useEffect, useRef } from 'react';
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial, HighlightLayer,
} from '@babylonjs/core';

/**
 * Babylon.js engine/scene initialization hook.
 * Sets up the engine, scene, camera, lights, ground, and highlight layer.
 * Returns refs for scene, engine, canvas, and highlight layer.
 */
export function useModelImportScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const highlightRef = useRef<HighlightLayer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.08, 0.08, 0.12, 1);

    const ground = MeshBuilder.CreateGround('ground', { width: 10, height: 10 }, scene);
    const gMat = new StandardMaterial('gMat', scene);
    gMat.diffuseColor = new Color3(0.15, 0.15, 0.2); gMat.alpha = 0.3; gMat.wireframe = true;
    ground.material = gMat; ground.isPickable = false;

    const cam = new ArcRotateCamera('cam', Math.PI / 2, Math.PI / 3, 5, new Vector3(0, 1, 0), scene);
    cam.attachControl(canvas, true); cam.lowerRadiusLimit = 0.5; cam.upperRadiusLimit = 20; cam.wheelPrecision = 40;

    new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.6;
    new DirectionalLight('dir', new Vector3(-1, -2, 1), scene).intensity = 0.5;

    highlightRef.current = new HighlightLayer('hl', scene);
    sceneRef.current = scene; engineRef.current = engine;

    engine.runRenderLoop(() => scene.render());
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); engine.dispose(); };
  }, []);

  return { canvasRef, sceneRef, engineRef, highlightRef };
}
