/**
 * Babylon.js シーン初期化の共通ユーティリティ
 * 全ページで共通するEngine/Scene/Camera/Light/Groundの初期設定を一元化する
 */
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial,
} from '@babylonjs/core';

export interface SceneSetupOptions {
  /** キャンバス要素 */
  canvas: HTMLCanvasElement;
  /** 背景色 [r,g,b,a] (0-1) デフォルト [0.1, 0.1, 0.15, 1] */
  clearColor?: [number, number, number, number];
  /** カメラ水平角 デフォルト Math.PI/2 */
  cameraAlpha?: number;
  /** カメラ垂直角 デフォルト Math.PI/3 */
  cameraBeta?: number;
  /** カメラ距離 デフォルト 3 */
  cameraRadius?: number;
  /** カメラ注視点 デフォルト (0,1,0) */
  cameraTarget?: Vector3;
  /** カメラ最小距離 デフォルト 0.5 */
  lowerRadiusLimit?: number;
  /** カメラ最大距離 デフォルト 10 */
  upperRadiusLimit?: number;
  /** ホイール感度 デフォルト 50 */
  wheelPrecision?: number;
  /** カメラにデフォルトのマウス操作を付与するか デフォルト true */
  attachControl?: boolean;
  /** グラウンドサイズ デフォルト 4 */
  groundSize?: number;
  /** グラウンド分割数 デフォルト undefined (Babylon.jsデフォルト) */
  groundSubdivisions?: number;
  /** ステンシルバッファ有効化 デフォルト false */
  stencil?: boolean;
}

export interface SceneSetupResult {
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  /** resize/renderループのクリーンアップ関数 */
  dispose: () => void;
}

/**
 * Babylon.jsのEngine/Scene/Camera/Light/Groundを共通設定で初期化する
 */
export function setupBabylonScene(opts: SceneSetupOptions): SceneSetupResult {
  const {
    canvas,
    clearColor = [0.1, 0.1, 0.15, 1],
    cameraAlpha = Math.PI / 2,
    cameraBeta = Math.PI / 3,
    cameraRadius = 3,
    cameraTarget = new Vector3(0, 1, 0),
    lowerRadiusLimit = 0.5,
    upperRadiusLimit = 10,
    wheelPrecision = 50,
    attachControl = true,
    groundSize = 4,
    groundSubdivisions,
    stencil = false,
  } = opts;

  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);

  const camera = new ArcRotateCamera('cam', cameraAlpha, cameraBeta, cameraRadius, cameraTarget, scene);
  if (attachControl) camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = lowerRadiusLimit;
  camera.upperRadiusLimit = upperRadiusLimit;
  camera.wheelPrecision = wheelPrecision;

  new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.6;
  new DirectionalLight('dir', new Vector3(-1, -2, 1), scene).intensity = 0.5;

  const groundOpts: { width: number; height: number; subdivisions?: number } = { width: groundSize, height: groundSize };
  if (groundSubdivisions !== undefined) groundOpts.subdivisions = groundSubdivisions;
  const ground = MeshBuilder.CreateGround('ground', groundOpts, scene);
  const gMat = new StandardMaterial('gMat', scene);
  gMat.diffuseColor = new Color3(0.2, 0.2, 0.25);
  gMat.alpha = 0.4;
  gMat.wireframe = true;
  ground.material = gMat;
  ground.isPickable = false;

  engine.runRenderLoop(() => scene.render());
  const onResize = () => engine.resize();
  window.addEventListener('resize', onResize);

  const dispose = () => {
    window.removeEventListener('resize', onResize);
    engine.dispose();
  };

  return { engine, scene, camera, dispose };
}
