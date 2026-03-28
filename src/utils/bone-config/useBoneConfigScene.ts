/**
 * ボーン設定ページで使用する全Refオブジェクトをまとめるフック
 * コンポーネント内のuseRef宣言を一箇所に集約し、
 * 他のフック（useBoneConfigMotion, useBoneConfigPreview）と共有する
 */
// ReactのuseRefフック
import { useRef, useEffect } from 'react';
// Babylon.jsの型（Refの型アノテーション用）
import { Vector3, Plane, PointerEventTypes } from '@babylonjs/core';
import type { Scene, ArcRotateCamera, Mesh, TransformNode } from '@babylonjs/core';
// カメラビュー方向の型
import type { ViewDirection } from '@/utils/bone-config/constants';
// ボクセルデータの型
import type { VoxelEntry } from '@/utils/voxelize/parser';
import { mirrorMarker, type MarkerData } from '@/utils/voxelize/skeleton';
import { MARKER_DEFS, VIEW_DEFS, viewerToVoxel } from '@/utils/bone-config/constants';
import { setupBabylonScene } from '@/utils/babylon-setup';

// ============================================================
// useBoneConfigRefs
// ============================================================

export function useBoneConfigRefs() {
  // ========== 3Dビューワー関連 ==========
  // Babylon.jsを描画するcanvas要素
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Babylon.jsのシーンオブジェクト
  const sceneRef = useRef<Scene | null>(null);
  // 回転カメラ（正面・右・背面・左の固定ビューを切り替え）
  const cameraRef = useRef<ArcRotateCamera | null>(null);

  // ========== 編集モードのメッシュ ==========
  // ボディ全体のボクセルメッシュ（半透明プレビュー）
  const bodyMeshRef = useRef<Mesh | null>(null);
  // ボーン関節の球体メッシュ（ボーン名→球体）
  const jointSpheresRef = useRef<Map<string, Mesh>>(new Map());
  // マーカーの球体メッシュ（マーカー名→球体。ドラッグ対象）
  const markerSpheresRef = useRef<Map<string, Mesh>>(new Map());
  // ボーン間を結ぶ線メッシュの配列
  const boneLineMeshesRef = useRef<Mesh[]>([]);
  // 左右対称の中心線メッシュ
  const centerLineMeshRef = useRef<Mesh | null>(null);

  // ========== モデル情報 ==========
  // ボクセルグリッドの中心座標と最大Z（VOXモデル読み込み時に設定）
  const centerRef = useRef({ cx: 0, cy: 0, maxZ: 103 });
  // 現在ドラッグ中のマーカー情報（null=ドラッグしていない）
  const draggingRef = useRef<{ markerName: string; plane: Plane; offset: Vector3 } | null>(null);
  // 現在のカメラビュー方向（front/right/back/left）
  const viewRef = useRef<ViewDirection>('front');
  // 左右対称ミラーが有効か（useEffectの同期用、stateとは別に保持）
  const autoMirrorRef = useRef(true);
  // 読み込んだボクセルデータ
  const voxelsRef = useRef<VoxelEntry[]>([]);

  // ========== プレビューモード関連 ==========
  // プレビュー用のボーンTransformNodeツリー（ボーン名→ノード）
  const previewNodesRef = useRef<Map<string, TransformNode>>(new Map());
  // プレビュー用のボーンごとメッシュ（ボーン名→メッシュ）
  const previewMeshesRef = useRef<Map<string, Mesh>>(new Map());
  // デバッグ用ボーン表示（球体と線）
  const debugBonesRef = useRef<{ spheres: Mesh[]; lines: Mesh | null }>({ spheres: [], lines: null });
  // 各ボーンのレストポーズ位置（ビューワー空間。アニメーション基準）
  const boneRestPosRef = useRef<Map<string, Vector3>>(new Map());
  // ボクセルボディの高さ（Hips→Head、ビューワー空間。FBXスケール合わせ用）
  const voxelBodyHeightRef = useRef(0);

  // ========== アニメーション関連 ==========
  // Babylon.jsに登録したアニメーションコールバック（停止時にunregisterする）
  const animCallbackRef = useRef<(() => void) | null>(null);
  // アニメーションの経過時間（秒）
  const animTimeRef = useRef(0);
  // 一時停止中フラグ（useEffectの同期用）
  const pausedRef = useRef(false);
  // フレーム適用関数（手動フレーム送り用）
  const applyFrameRef = useRef<((frame: number) => void) | null>(null);
  // モデル読み込みのキー（非同期読み込みの競合防止用インクリメントカウンター）
  const loadKeyRef = useRef(0);

  return {
    canvasRef, sceneRef, cameraRef,
    bodyMeshRef, jointSpheresRef, markerSpheresRef, boneLineMeshesRef, centerLineMeshRef,
    centerRef, draggingRef, viewRef, autoMirrorRef, voxelsRef,
    previewNodesRef, previewMeshesRef, debugBonesRef, boneRestPosRef, voxelBodyHeightRef,
    animCallbackRef, animTimeRef, pausedRef, applyFrameRef, loadKeyRef,
  };
}

export type BoneConfigRefs = ReturnType<typeof useBoneConfigRefs>;

// ============================================================
// useBoneConfigScene
// ============================================================

interface SceneHookParams {
  refs: BoneConfigRefs;
  setMarkers: React.Dispatch<React.SetStateAction<MarkerData>>;
  setDirty: (v: boolean) => void;
  setSelectedMarker: (name: string) => void;
  setTab: (tab: 'markers' | 'bones') => void;
}

export function useBoneConfigScene({
  refs, setMarkers, setDirty, setSelectedMarker, setTab,
}: SceneHookParams) {
  const {
    canvasRef, sceneRef, cameraRef,
    centerRef, draggingRef, viewRef, autoMirrorRef,
  } = refs;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { scene, camera, dispose } = setupBabylonScene({
      canvas,
      clearColor: [0.10, 0.10, 0.16, 1],
      cameraBeta: Math.PI / 2,
      cameraRadius: 2.5,
      cameraTarget: new Vector3(0, 0.5, 0),
      upperRadiusLimit: 8,
      wheelPrecision: 80,
      attachControl: false,
      stencil: true,
    });

    // bone-config固有: ホイールズームのみ有効 (ドラッグ回転はマーカー操作に使用)
    camera.inputs.clear();
    camera.inputs.addMouseWheel();
    cameraRef.current = camera;

    // --- Drag & drop ---
    scene.onPointerObservable.add((pointerInfo) => {
      const { cx, cy } = centerRef.current;
      const currentView = VIEW_DEFS.find(v => v.key === viewRef.current)!;

      switch (pointerInfo.type) {
        case PointerEventTypes.POINTERDOWN: {
          const pickResult = scene.pick(scene.pointerX, scene.pointerY);
          if (pickResult?.hit && pickResult.pickedMesh?.metadata?.markerName) {
            const markerName = pickResult.pickedMesh.metadata.markerName as string;
            const meshPos = pickResult.pickedMesh.position;
            const cameraDir = camera.position.subtract(camera.target).normalize();
            const dragPlane = Plane.FromPositionAndNormal(meshPos, cameraDir);
            const pickPoint = pickResult.pickedPoint!;
            const offset = meshPos.subtract(pickPoint);
            draggingRef.current = { markerName, plane: dragPlane, offset };
            setSelectedMarker(markerName);
            setTab('markers');
          }
          break;
        }
        case PointerEventTypes.POINTERMOVE: {
          if (!draggingRef.current) break;
          const { markerName, plane, offset } = draggingRef.current;

          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, null, camera);
          const denom = Vector3.Dot(ray.direction, plane.normal);
          if (Math.abs(denom) < 1e-6) break;
          const t = -(Vector3.Dot(ray.origin, plane.normal) + plane.d) / denom;
          if (t < 0) break;
          const hitPoint = ray.origin.add(ray.direction.scale(t)).add(offset);
          const newVox = viewerToVoxel(hitPoint, cx, cy);

          setMarkers(prev => {
            const old = prev[markerName];
            const updated = { ...old };
            if (currentView.dragAxes.includes('x')) updated.x = Math.max(0, Math.min(85, Math.round(newVox.x * 2) / 2));
            if (currentView.dragAxes.includes('y')) updated.y = Math.max(0, Math.min(34, Math.round(newVox.y * 2) / 2));
            if (currentView.dragAxes.includes('z')) updated.z = Math.max(0, Math.min(103, Math.round(newVox.z * 2) / 2));

            let next = { ...prev, [markerName]: updated };
            if (autoMirrorRef.current) {
              const mDef = MARKER_DEFS.find(m => m.name === markerName);
              if (mDef?.side === 'left') {
                const rightName = MARKER_DEFS.find(m => m.mirrorOf === markerName)?.name;
                if (rightName) {
                  const mcx = (next['Chin'].x + next['Groin'].x) / 2;
                  next[rightName] = mirrorMarker(updated, mcx);
                }
              }
              if (markerName === 'Chin' || markerName === 'Groin') {
                const mcx = (next['Chin'].x + next['Groin'].x) / 2;
                next['RightWrist'] = mirrorMarker(next['LeftWrist'], mcx);
                next['RightElbow'] = mirrorMarker(next['LeftElbow'], mcx);
                next['RightKnee']  = mirrorMarker(next['LeftKnee'], mcx);
              }
            }
            return next;
          });
          setDirty(true);
          break;
        }
        case PointerEventTypes.POINTERUP: {
          if (draggingRef.current) draggingRef.current = null;
          break;
        }
      }
    });

    sceneRef.current = scene;
    return dispose;
  }, []);
}
