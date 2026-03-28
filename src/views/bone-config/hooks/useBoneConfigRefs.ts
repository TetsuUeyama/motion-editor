/**
 * ボーン設定ページで使用する全Refオブジェクトをまとめるフック
 * コンポーネント内のuseRef宣言を一箇所に集約し、
 * 他のフック（useBoneConfigMotion, useBoneConfigPreview）と共有する
 */
// ReactのuseRefフック
import { useRef } from 'react';
// Babylon.jsの型（Refの型アノテーション用）
import type { Scene, ArcRotateCamera, Mesh, TransformNode, Vector3, Plane } from '@babylonjs/core';
// カメラビュー方向の型
import type { ViewDirection } from '@/utils/bone-config/constants';
// ボクセルデータの型
import type { VoxelEntry } from '@/utils/vox-parser';

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
