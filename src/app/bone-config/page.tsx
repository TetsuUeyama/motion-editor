// クライアントコンポーネント宣言
'use client';
// Reactフック
import { useEffect, useState, useCallback } from 'react';
// Next.jsページ遷移
import Link from 'next/link';
// Babylon.jsコアモジュール
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight,
  Vector3, Color4,
  MeshBuilder, StandardMaterial, Color3, Plane, PointerEventTypes,
  Quaternion,
} from '@babylonjs/core';
// VOXファイル読み込み
import { loadVoxFile, SCALE } from '@/lib/vox-parser';
import type { VoxelEntry } from '@/lib/vox-parser';
// モデル一覧
import { MODEL_REGISTRY, DEFAULT_MODEL_ID } from '@/lib/model-registry';
import type { ModelEntry } from '@/lib/model-registry';
// ボクセルスケルトン共通ライブラリ
import {
  BONE_DEFS, type Vec3, type MarkerData,
  calculateAllBones, mirrorMarker, getDefaultMarkers,
  buildSkeletalCharacter, voxelToViewer,
  type MotionClip,
  getBoneDepth,
} from '@/lib/voxel-skeleton';
// このページ固有の定数・型・ヘルパー
import {
  MARKER_DEFS, type MarkerDef, VIEW_DEFS, type ViewDirection, MOTION_FILES,
  type EquipPart, type PageMode, type QuatConversion, QUAT_CONVERSIONS,
  buildBodyMesh, viewerToVoxel, r1,
} from './constants';
// カスタムフック: Ref管理、モーション再生、プレビューモード
import { useBoneConfigRefs } from './hooks/useBoneConfigRefs';
import { useBoneConfigMotion } from './hooks/useBoneConfigMotion';
import { useBoneConfigPreview } from './hooks/useBoneConfigPreview';

// ========================================================================
// メインコンポーネント
// ボクセルモデルのボーン設定・マーカー配置・モーションプレビューを行うページ
// 左側パネル: マーカー/ボーン一覧、モーション選択
// 右側: Babylon.jsの3Dビューワー（マーカードラッグ、モーション再生）
// ========================================================================
export default function BoneConfigPage() {
  // 全Refオブジェクトをフックから取得（3Dシーン、メッシュ、アニメーション等）
  const refs = useBoneConfigRefs();
  const {
    canvasRef, sceneRef, cameraRef, bodyMeshRef,
    jointSpheresRef, markerSpheresRef, boneLineMeshesRef, centerLineMeshRef,
    centerRef, draggingRef, viewRef, autoMirrorRef,
    previewNodesRef, previewMeshesRef, debugBonesRef,
    boneRestPosRef, voxelBodyHeightRef, voxelsRef,
    animCallbackRef, animTimeRef, pausedRef, applyFrameRef, loadKeyRef,
  } = refs;

  // ========== State定義 ==========
  // 現在選択中のモデル（URLパラメータまたはデフォルト）
  const [currentModel, setCurrentModel] = useState<ModelEntry>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const modelId = params.get('model');
      if (modelId) {
        const m = MODEL_REGISTRY.find(e => e.id === modelId);
        if (m) return m;
      }
    }
    return MODEL_REGISTRY.find(m => m.id === DEFAULT_MODEL_ID) ?? MODEL_REGISTRY[0];
  });
  const [loading, setLoading] = useState(true);       // モデル読み込み中フラグ
  const [error, setError] = useState<string | null>(null); // エラーメッセージ
  const [markers, setMarkers] = useState<MarkerData>(() => getDefaultMarkers(35)); // 8マーカーの座標
  const [calculatedBones, setCalculatedBones] = useState<Record<string, Vec3>>({}); // マーカーから計算された41ボーン位置
  const [selectedMarker, setSelectedMarker] = useState<string>('Chin'); // 選択中のマーカー名
  const [saving, setSaving] = useState(false);         // 保存中フラグ
  const [dirty, setDirty] = useState(false);           // 未保存の変更があるか
  const [showBody, setShowBody] = useState(true);      // ボディメッシュの表示/非表示
  const [showBones, setShowBones] = useState(true);    // ボーン表示の表示/非表示
  const [tab, setTab] = useState<'markers' | 'bones'>('markers'); // サイドバーのタブ切替
  const [viewDir, setViewDir] = useState<ViewDirection>('front');  // カメラビュー方向
  const [autoMirror, setAutoMirror] = useState(true);  // 左右対称ミラー有効/無効
  const [mode, setMode] = useState<PageMode>('edit');  // edit=マーカー編集, preview=モーションプレビュー
  const [motionSpeed, setMotionSpeed] = useState(1.0); // モーション再生速度
  const [quatConv, setQuatConv] = useState<QuatConversion>('correct'); // クォータニオン変換方式
  const [paused, setPaused] = useState(false);         // モーション一時停止
  const [currentFrame, setCurrentFrame] = useState(0); // 現在のフレーム番号
  const [showBonesOnly, setShowBonesOnly] = useState(false); // デバッグ:ボーンのみ表示

  // モーション再生ロジック（フック）
  const { playingMotion, loadingMotion, loadedClips, stopMotion, startMotion, playMotionClip } = useBoneConfigMotion({
    refs, calculatedBones, motionSpeed, quatConv, showBonesOnly, setCurrentFrame,
  });

  // 装備パーツ状態
  const [equipParts, setEquipParts] = useState<EquipPart[]>([]);         // 利用可能な装備パーツ一覧
  const [equipEnabled, setEquipEnabled] = useState<Record<string, boolean>>({}); // 各パーツの有効/無効
  const [equipVoxelCache, setEquipVoxelCache] = useState<Record<string, VoxelEntry[]>>({}); // 読み込み済みパーツのキャッシュ

  // プレビューモード管理（フック）
  const {
    loadEquipmentVoxels, enterPreview, exitPreview, handleConfirmSave, equipLoading,
  } = useBoneConfigPreview({
    refs, calculatedBones, markers, autoMirror, showBody,
    currentModel: { dir: currentModel.dir }, equipParts, equipEnabled, equipVoxelCache,
    setEquipVoxelCache, setMode, setShowBonesOnly, setSaving, setDirty,
    setCameraView: (dir: ViewDirection) => {
      const camera = cameraRef.current;
      if (!camera) return;
      const vDef = VIEW_DEFS.find(v => v.key === dir)!;
      camera.alpha = vDef.alpha;
      camera.beta = Math.PI / 2;
      viewRef.current = dir;
    },
    stopMotion,
    buildSkeletalPreview: buildSkeletalCharacter as any,
  });

  // Keep refs in sync
  useEffect(() => { autoMirrorRef.current = autoMirror; }, [autoMirror]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // Compute mirror center from Chin/Groin X
  const getMirrorCenterX = useCallback(() => {
    const chin = markers['Chin'];
    const groin = markers['Groin'];
    return (chin.x + groin.x) / 2;
  }, [markers]);

  // Apply auto-mirror: sync right markers from left when enabled
  const applyAutoMirror = useCallback((m: MarkerData): MarkerData => {
    const mcx = (m['Chin'].x + m['Groin'].x) / 2;
    return {
      ...m,
      RightWrist: mirrorMarker(m['LeftWrist'], mcx),
      RightElbow: mirrorMarker(m['LeftElbow'], mcx),
      RightKnee:  mirrorMarker(m['LeftKnee'], mcx),
    };
  }, []);

  const setCameraView = useCallback((dir: ViewDirection) => {
    const camera = cameraRef.current;
    if (!camera) return;
    const vDef = VIEW_DEFS.find(v => v.key === dir)!;
    camera.alpha = vDef.alpha;
    camera.beta = Math.PI / 2;
    viewRef.current = dir;
  }, []);

  const switchView = useCallback((dir: ViewDirection) => {
    setViewDir(dir);
    setCameraView(dir);
  }, [setCameraView]);

  // Recalculate bones whenever markers change
  useEffect(() => {
    const { maxZ } = centerRef.current;
    const bones = calculateAllBones(markers, maxZ);
    setCalculatedBones(bones);
  }, [markers]);

  // Get visible markers based on autoMirror state
  const getVisibleMarkers = useCallback((): MarkerDef[] => {
    if (autoMirror) {
      // Show only center + left markers
      return MARKER_DEFS.filter(m => m.side !== 'right');
    }
    return MARKER_DEFS;
  }, [autoMirror]);

  // 全ビジュアル要素を再構築する
  // マーカー球体、ボーン球体/線、中心線を再描画する
  // markers, calculatedBones, selectedMarker等が変化するたびに呼ばれる
  const rebuildVisuals = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const { cx, cy } = centerRef.current;

    // Clear old
    for (const m of jointSpheresRef.current.values()) m.dispose();
    jointSpheresRef.current.clear();
    for (const m of markerSpheresRef.current.values()) m.dispose();
    markerSpheresRef.current.clear();
    for (const m of boneLineMeshesRef.current) m.dispose();
    boneLineMeshesRef.current = [];
    if (centerLineMeshRef.current) { centerLineMeshRef.current.dispose(); centerLineMeshRef.current = null; }

    // Center line based on Chin/Groin
    const mcx = getMirrorCenterX();
    const clP1 = voxelToViewer(mcx, cy, 0, cx, cy);
    const clP2 = voxelToViewer(mcx, cy, centerRef.current.maxZ, cx, cy);
    const cl = MeshBuilder.CreateTube('centerLine', {
      path: [clP1, clP2], radius: 0.003, tessellation: 4, updatable: false,
    }, scene);
    const clMat = new StandardMaterial('clMat', scene);
    clMat.diffuseColor = new Color3(1, 1, 0);
    clMat.emissiveColor = new Color3(0.5, 0.5, 0);
    clMat.alpha = 0.3;
    clMat.disableLighting = true;
    cl.material = clMat;
    cl.isPickable = false;
    centerLineMeshRef.current = cl;

    // Marker spheres
    const visibleMarkers = getVisibleMarkers();
    for (const mDef of visibleMarkers) {
      const pos = markers[mDef.name];
      if (!pos) continue;

      const sphere = MeshBuilder.CreateSphere(`marker_${mDef.name}`, { diameter: 0.06 }, scene);
      sphere.position = voxelToViewer(pos.x, pos.y, pos.z, cx, cy);
      const mat = new StandardMaterial(`mmat_${mDef.name}`, scene);
      const c = Color3.FromHexString(mDef.color);
      mat.diffuseColor = c;
      mat.emissiveColor = mDef.name === selectedMarker ? c : c.scale(0.6);
      mat.disableLighting = true;
      sphere.material = mat;
      sphere.isPickable = true;
      sphere.metadata = { markerName: mDef.name };
      if (mDef.name === selectedMarker) {
        sphere.scaling = new Vector3(1.8, 1.8, 1.8);
      }
      markerSpheresRef.current.set(mDef.name, sphere);
    }

    // Ghost markers for auto-mirrored right side
    if (autoMirror) {
      for (const mDef of MARKER_DEFS.filter(m => m.side === 'right' && m.mirrorOf)) {
        const pos = markers[mDef.name];
        if (!pos) continue;
        const sphere = MeshBuilder.CreateSphere(`marker_${mDef.name}_ghost`, { diameter: 0.06 }, scene);
        sphere.position = voxelToViewer(pos.x, pos.y, pos.z, cx, cy);
        const mat = new StandardMaterial(`mmat_${mDef.name}_ghost`, scene);
        const c = Color3.FromHexString(mDef.color);
        mat.diffuseColor = c;
        mat.emissiveColor = c.scale(0.3);
        mat.alpha = 0.4;
        mat.disableLighting = true;
        sphere.material = mat;
        sphere.isPickable = false;
        markerSpheresRef.current.set(mDef.name + '_ghost', sphere);
      }
    }

    // Bone joints and lines
    if (showBones && Object.keys(calculatedBones).length > 0) {
      for (const bone of BONE_DEFS) {
        const pos = calculatedBones[bone.name];
        if (!pos) continue;
        const sphere = MeshBuilder.CreateSphere(`joint_${bone.name}`, { diameter: 0.03 }, scene);
        sphere.position = voxelToViewer(pos.x, pos.y, pos.z, cx, cy);
        const mat = new StandardMaterial(`jmat_${bone.name}`, scene);
        const c = Color3.FromHexString(bone.color);
        mat.diffuseColor = c;
        mat.emissiveColor = c.scale(0.4);
        mat.alpha = 0.7;
        mat.disableLighting = true;
        sphere.material = mat;
        sphere.isPickable = false;
        jointSpheresRef.current.set(bone.name, sphere);
      }

      for (const bone of BONE_DEFS) {
        if (!bone.parent) continue;
        const childPos = calculatedBones[bone.name];
        const parentPos = calculatedBones[bone.parent];
        if (!childPos || !parentPos) continue;
        const p1 = voxelToViewer(parentPos.x, parentPos.y, parentPos.z, cx, cy);
        const p2 = voxelToViewer(childPos.x, childPos.y, childPos.z, cx, cy);
        if (Vector3.Distance(p1, p2) < 0.001) continue;

        const line = MeshBuilder.CreateTube(`bone_${bone.name}`, {
          path: [p1, p2], radius: 0.005, tessellation: 6, updatable: false,
        }, scene);
        const mat = new StandardMaterial(`bmat_${bone.name}`, scene);
        const c = Color3.FromHexString(bone.color);
        mat.diffuseColor = c;
        mat.emissiveColor = c.scale(0.3);
        mat.alpha = 0.6;
        mat.disableLighting = true;
        line.material = mat;
        line.isPickable = false;
        boneLineMeshesRef.current.push(line);
      }
    }
  }, [markers, calculatedBones, selectedMarker, showBones, autoMirror, getMirrorCenterX, getVisibleMarkers]);

  // Babylon.jsエンジン初期化（マウント時に1回だけ実行）
  // シーン、カメラ、ライト、グラウンド、マウスイベント（マーカードラッグ）を設定
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.10, 0.10, 0.16, 1);

    const ground = MeshBuilder.CreateGround('ground', { width: 4, height: 4 }, scene);
    const gMat = new StandardMaterial('gMat', scene);
    gMat.diffuseColor = new Color3(0.2, 0.2, 0.25);
    gMat.alpha = 0.3; gMat.wireframe = true;
    ground.material = gMat;
    ground.isPickable = false;

    const camera = new ArcRotateCamera('cam', Math.PI / 2, Math.PI / 2, 2.5, new Vector3(0, 0.5, 0), scene);
    camera.lowerRadiusLimit = 0.5; camera.upperRadiusLimit = 8; camera.wheelPrecision = 80;
    camera.inputs.clear();
    camera.inputs.addMouseWheel();
    cameraRef.current = camera;

    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.5;

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

            if (currentView.dragAxes.includes('x')) {
              updated.x = Math.max(0, Math.min(85, Math.round(newVox.x * 2) / 2));
            }
            if (currentView.dragAxes.includes('y')) {
              updated.y = Math.max(0, Math.min(34, Math.round(newVox.y * 2) / 2));
            }
            if (currentView.dragAxes.includes('z')) {
              updated.z = Math.max(0, Math.min(103, Math.round(newVox.z * 2) / 2));
            }

            let next = { ...prev, [markerName]: updated };

            // Auto-mirror: if editing a left marker, sync right
            if (autoMirrorRef.current) {
              const mDef = MARKER_DEFS.find(m => m.name === markerName);
              if (mDef?.side === 'left') {
                const rightName = MARKER_DEFS.find(m => m.mirrorOf === markerName)?.name;
                if (rightName) {
                  const mcx = (next['Chin'].x + next['Groin'].x) / 2;
                  next[rightName] = mirrorMarker(updated, mcx);
                }
              }
              // If editing Chin or Groin (center changes), re-mirror all
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
          if (draggingRef.current) {
            draggingRef.current = null;
          }
          break;
        }
      }
    });

    sceneRef.current = scene;
    engine.runRenderLoop(() => scene.render());
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);

    return () => { window.removeEventListener('resize', onResize); engine.dispose(); };
  }, []);

  // モデル読み込み（モデル切替時に再実行）
  // VOXファイル読み込み→ボディメッシュ構築→装備パーツ読み込み→保存済みボーン設定復元
  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;
    const thisLoadKey = ++loadKeyRef.current;

    // Clear existing body mesh
    if (bodyMeshRef.current) { bodyMeshRef.current.dispose(); bodyMeshRef.current = null; }

    setLoading(true);
    setError(null);
    setDirty(false);

    (async () => {
      try {
        const { model, voxels } = await loadVoxFile(currentModel.bodyFile);
        if (loadKeyRef.current !== thisLoadKey) return; // stale

        const cx = model.sizeX / 2;
        const cy = model.sizeY / 2;
        const maxZ = model.sizeZ;
        centerRef.current = { cx, cy, maxZ };
        voxelsRef.current = voxels;

        bodyMeshRef.current = buildBodyMesh(voxels, scene, cx, cy, 0.25);

        // Load equipment manifest
        try {
          const partsResp = await fetch(currentModel.partsManifest + `?v=${Date.now()}`);
          if (partsResp.ok) {
            const parts: EquipPart[] = await partsResp.json();
            // Filter out the body itself
            const equipOnly = parts.filter(p => p.key !== currentModel.bodyKey);
            setEquipParts(equipOnly);
            // Set default enabled state
            const enabled: Record<string, boolean> = {};
            for (const p of equipOnly) enabled[p.key] = p.default_on;
            setEquipEnabled(enabled);
            setEquipVoxelCache({});
          }
        } catch { /* no equipment available */ }

        // Load saved bone config for this model
        let loaded = false;
        try {
          const resp = await fetch(`/api/bone-config?dir=${currentModel.dir}`);
          if (resp.ok) {
            const data = await resp.json();
            if (data?.markers && typeof data.markers === 'object') {
              setMarkers(prev => ({ ...prev, ...data.markers }));
              if (data.autoMirror === false) setAutoMirror(false);
              else setAutoMirror(true);
              loaded = true;
            }
          }
        } catch { /* use defaults */ }

        if (!loaded) {
          setMarkers(getDefaultMarkers(cx));
          setAutoMirror(true);
        }

        setLoading(false);
      } catch (e) {
        if (loadKeyRef.current !== thisLoadKey) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();
  }, [currentModel]);

  // Rebuild visuals
  useEffect(() => {
    if (!loading) rebuildVisuals();
  }, [loading, rebuildVisuals]);

  // Toggle body visibility
  useEffect(() => {
    if (bodyMeshRef.current) bodyMeshRef.current.setEnabled(showBody);
  }, [showBody]);

  // マーカー座標の更新（サイドバーの数値入力から呼ばれる）
  // 左右対称ミラーが有効な場合、右側マーカーも自動更新する
  const updateMarker = useCallback((markerName: string, axis: 'x' | 'y' | 'z', value: number) => {
    setMarkers(prev => {
      let next = { ...prev, [markerName]: { ...prev[markerName], [axis]: value } };

      if (autoMirrorRef.current) {
        const mDef = MARKER_DEFS.find(m => m.name === markerName);
        if (mDef?.side === 'left') {
          const rightName = MARKER_DEFS.find(m => m.mirrorOf === markerName)?.name;
          if (rightName) {
            const mcx = (next['Chin'].x + next['Groin'].x) / 2;
            next[rightName] = mirrorMarker(next[markerName], mcx);
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
  }, []);

  // Toggle auto-mirror
  const toggleAutoMirror = useCallback(() => {
    setAutoMirror(prev => {
      const next = !prev;
      if (next) {
        // Turning ON: sync right from left immediately
        setMarkers(m => applyAutoMirror(m));
      }
      // If selected marker is a right-side marker and we're turning mirror ON, switch to left
      const selDef = MARKER_DEFS.find(m => m.name === selectedMarker);
      if (next && selDef?.side === 'right' && selDef.mirrorOf) {
        setSelectedMarker(selDef.mirrorOf);
      }
      setDirty(true);
      return next;
    });
  }, [selectedMarker, applyAutoMirror]);

  // マーカー位置をデフォルトにリセット
  const resetToDefaults = useCallback(() => {
    const { cx } = centerRef.current;
    setMarkers(getDefaultMarkers(cx));
    setAutoMirror(true);
    setDirty(true);
  }, []);

  // ========== JSX用の派生値 ==========
  const selMarker = MARKER_DEFS.find(m => m.name === selectedMarker); // 選択中マーカーの定義
  const selPos = selectedMarker ? markers[selectedMarker] : null;      // 選択中マーカーの座標
  const currentViewDef = VIEW_DEFS.find(v => v.key === viewDir)!;     // 現在のビュー定義
  const visibleMarkers = getVisibleMarkers();                          // 表示すべきマーカー一覧
  const mirrorCenterX = getMirrorCenterX();                            // 左右対称の中心X

  // ========== JSXレンダリング ==========
  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', background: '#1a1a2e' }}>
      {/* サイドバー（左パネル） */}
      <div style={{
        width: 320, minWidth: 320, background: '#0f0f23', color: '#ccc',
        borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', overflow: 'auto',
      }}>
        {/* Header */}
        <div style={{ padding: '12px', borderBottom: '1px solid #333' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontWeight: 'bold', fontSize: 16 }}>Bone Config</span>
            <Link href="/" style={{ color: '#888', fontSize: 11, textDecoration: 'none' }}>Top</Link>
          </div>
          <div style={{ fontSize: 11, color: '#888', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Model:</span>
            <select
              value={currentModel.id}
              onChange={e => {
                const m = MODEL_REGISTRY.find(r => r.id === e.target.value);
                if (m && m.id !== currentModel.id) {
                  if (mode === 'preview') exitPreview();
                  setCurrentModel(m);
                }
              }}
              style={{
                fontSize: 11, background: '#1a1a2e', color: '#aaf',
                border: '1px solid #444', borderRadius: 3, padding: '2px 6px',
                cursor: 'pointer',
              }}
            >
              {MODEL_REGISTRY.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>

        {error && <div style={{ padding: 12, color: '#f88', fontSize: 12 }}>Error: {error}</div>}
        {loading && <div style={{ padding: 12, color: '#88f', fontSize: 12 }}>Loading...</div>}

        {/* View direction (edit mode only) */}
        {mode === 'edit' && (
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #333' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>View Direction</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {VIEW_DEFS.map(vDef => {
                const active = viewDir === vDef.key;
                return (
                  <button
                    key={vDef.key}
                    onClick={() => switchView(vDef.key)}
                    style={{
                      flex: 1, padding: '6px 0', border: 'none', borderRadius: 4, cursor: 'pointer',
                      fontSize: 12, fontWeight: 'bold',
                      background: active ? '#3a3a8e' : '#1a1a3e',
                      color: active ? '#fff' : '#888',
                      outline: active ? '2px solid #66f' : '1px solid #333',
                    }}
                  >{vDef.label}</button>
                );
              })}
            </div>
            <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>
              ドラッグ軸: {currentViewDef.axisLabels}
            </div>
          </div>
        )}

        {/* Toggles (edit mode only) */}
        {mode === 'edit' && (
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #333', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={showBody} onChange={() => setShowBody(!showBody)} />
              Body
            </label>
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={showBones} onChange={() => setShowBones(!showBones)} />
              Bones
            </label>
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={autoMirror} onChange={toggleAutoMirror} />
              <span style={{ color: autoMirror ? '#88f' : '#888' }}>左右対称</span>
            </label>
          </div>
        )}

        {/* Tabs (edit mode only) */}
        {mode === 'edit' && (
          <div style={{ display: 'flex', borderBottom: '1px solid #333' }}>
            <button
              onClick={() => setTab('markers')}
              style={{
                flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 'bold',
                background: tab === 'markers' ? '#2a2a5e' : 'transparent',
                color: tab === 'markers' ? '#fff' : '#888',
                borderBottom: tab === 'markers' ? '2px solid #88f' : '2px solid transparent',
              }}
            >Markers ({autoMirror ? 5 : 8})</button>
            <button
              onClick={() => setTab('bones')}
              style={{
                flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 'bold',
                background: tab === 'bones' ? '#2a2a5e' : 'transparent',
                color: tab === 'bones' ? '#fff' : '#888',
                borderBottom: tab === 'bones' ? '2px solid #88f' : '2px solid transparent',
              }}
            >Auto Bones (41)</button>
          </div>
        )}

        {/* Markers tab */}
        {mode === 'edit' && tab === 'markers' && (
          <>
            {selMarker && selPos && (
              <div style={{ padding: '10px 12px', borderBottom: '1px solid #333', background: '#11112a' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ width: 14, height: 14, borderRadius: '50%', background: selMarker.color, display: 'inline-block', border: '2px solid #fff' }} />
                  <span style={{ fontWeight: 'bold', fontSize: 14 }}>{selMarker.label}</span>
                  {selMarker.side === 'left' && autoMirror && (
                    <span style={{ fontSize: 10, color: '#88f', background: '#1a1a4e', padding: '1px 6px', borderRadius: 8 }}>L/R auto</span>
                  )}
                </div>

                {(['x', 'y', 'z'] as const).map(axis => {
                  const max = axis === 'x' ? 85 : axis === 'y' ? 34 : 103;
                  const labels = { x: 'X (左右)', y: 'Y (前後)', z: 'Z (高さ)' };
                  const isDragAxis = currentViewDef.dragAxes.includes(axis);
                  return (
                    <div key={axis} style={{ marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 70, fontSize: 11, color: isDragAxis ? '#ddd' : '#666' }}>
                          {labels[axis]}
                        </span>
                        <input type="range" min={0} max={max} step={0.5}
                          value={selPos[axis]}
                          onChange={e => updateMarker(selectedMarker, axis, Number(e.target.value))}
                          style={{ flex: 1 }} />
                        <input type="number" min={0} max={max} step={0.5}
                          value={selPos[axis]}
                          onChange={e => updateMarker(selectedMarker, axis, Number(e.target.value))}
                          style={{
                            width: 50, fontSize: 11, background: '#1a1a3e', color: '#ccc',
                            border: '1px solid #444', borderRadius: 3, padding: '2px 4px', textAlign: 'right',
                          }} />
                      </div>
                    </div>
                  );
                })}

                {autoMirror && selMarker.side === 'left' && (
                  <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
                    Right auto: X={r1(mirrorCenterX + (mirrorCenterX - selPos.x))}
                    {' '}(center: {r1(mirrorCenterX)})
                  </div>
                )}
                {(selMarker.name === 'Chin' || selMarker.name === 'Groin') && autoMirror && (
                  <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
                    Mirror center X: {r1(mirrorCenterX)} (Chin+Groin)/2
                  </div>
                )}
              </div>
            )}

            {/* Marker list */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              <div style={{ padding: '6px 12px', fontSize: 11, color: '#888', borderBottom: '1px solid #222' }}>
                マーカー一覧 (ドラッグ / クリックで選択)
              </div>
              {visibleMarkers.map(mDef => {
                const isSelected = mDef.name === selectedMarker;
                const pos = markers[mDef.name];
                return (
                  <div
                    key={mDef.name}
                    onClick={() => setSelectedMarker(mDef.name)}
                    style={{
                      padding: '8px 12px', cursor: 'pointer', fontSize: 12,
                      background: isSelected ? '#2a2a5e' : 'transparent',
                      borderLeft: isSelected ? `3px solid ${mDef.color}` : '3px solid transparent',
                      color: isSelected ? '#fff' : '#aaa',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}
                  >
                    <span style={{
                      width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
                      background: mDef.color, display: 'inline-block',
                      border: isSelected ? '2px solid #fff' : '1px solid #666',
                    }} />
                    <span style={{ flex: 1 }}>{mDef.label}</span>
                    {pos && (
                      <span style={{ fontSize: 10, color: '#666' }}>
                        ({r1(pos.x)}, {r1(pos.y)}, {r1(pos.z)})
                      </span>
                    )}
                    {autoMirror && mDef.side === 'left' && <span style={{ fontSize: 9, color: '#558' }}>L/R</span>}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Bones tab */}
        {mode === 'edit' && tab === 'bones' && (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <div style={{ padding: '6px 12px', fontSize: 11, color: '#888', borderBottom: '1px solid #222' }}>
              自動計算されたボーン (読み取り専用)
            </div>
            {BONE_DEFS.map(bone => {
              const pos = calculatedBones[bone.name];
              const depth = getBoneDepth(bone.name);
              return (
                <div
                  key={bone.name}
                  style={{
                    padding: '4px 12px', paddingLeft: 12 + depth * 14,
                    fontSize: 11, color: '#999',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: bone.color, display: 'inline-block',
                  }} />
                  <span style={{ flex: 1 }}>{bone.label}</span>
                  {pos && (
                    <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace' }}>
                      {r1(pos.x)}, {r1(pos.y)}, {r1(pos.z)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Actions */}
        {mode === 'edit' && (
          <div style={{ padding: '10px 12px', borderTop: '1px solid #333', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button onClick={resetToDefaults} style={{
              padding: '6px 0', borderRadius: 4, cursor: 'pointer',
              background: '#3a2a2a', color: '#ccc', border: '1px solid #555', fontSize: 11,
            }}>Reset to Defaults</button>
            <button
              onClick={enterPreview}
              disabled={Object.keys(calculatedBones).length === 0}
              style={{
                padding: '10px 0', borderRadius: 4, cursor: 'pointer',
                background: '#3a5a8a', color: '#fff',
                border: '2px solid #5588cc', fontSize: 13, fontWeight: 'bold',
              }}
            >
              決定 → プレビュー
            </button>
          </div>
        )}
        {mode === 'preview' && (
          <>
            {/* Motion clips */}
            <div style={{ padding: '10px 12px', borderBottom: '1px solid #333' }}>
              <div style={{ fontSize: 12, fontWeight: 'bold', color: '#fff', marginBottom: 8 }}>
                Motion
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                {MOTION_FILES.map(motion => {
                  const isActive = playingMotion === motion.name;
                  const isLoaded = !!loadedClips[motion.name];
                  return (
                    <button
                      key={motion.name}
                      onClick={() => isActive ? stopMotion() : startMotion(motion.name)}
                      disabled={loadingMotion}
                      style={{
                        padding: '6px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11,
                        textAlign: 'left',
                        background: isActive ? '#4a7a4a' : '#2a2a4e',
                        color: isActive ? '#fff' : '#aaa',
                        border: isActive ? '2px solid #6a6' : '1px solid #444',
                        fontWeight: isActive ? 'bold' : 'normal',
                      }}
                    >
                      {loadingMotion && !isLoaded ? '⏳ ' : isActive ? '■ ' : '▶ '}{motion.label}
                    </button>
                  );
                })}
              </div>
              {/* Speed control */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: '#888', width: 40 }}>Speed</span>
                <input type="range" min={0.2} max={3.0} step={0.1}
                  value={motionSpeed}
                  onChange={e => setMotionSpeed(Number(e.target.value))}
                  style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: '#888', width: 30, textAlign: 'right' }}>{motionSpeed.toFixed(1)}x</span>
              </div>
              {/* Quaternion conversion formula selector */}
              <div style={{ marginTop: 6 }}>
                <span style={{ fontSize: 11, color: '#888' }}>Quat Conv:</span>
                <select
                  value={quatConv}
                  onChange={e => setQuatConv(e.target.value as QuatConversion)}
                  style={{
                    marginLeft: 6, fontSize: 11, background: '#1a1a2e',
                    color: '#ccc', border: '1px solid #444', borderRadius: 3, padding: '2px 4px',
                  }}
                >
                  {QUAT_CONVERSIONS.map(c => (
                    <option key={c.key} value={c.key}>
                      {c.label} - {c.desc}
                    </option>
                  ))}
                </select>
              </div>
              {/* Bones-only toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showBonesOnly}
                  onChange={e => setShowBonesOnly(e.target.checked)}
                />
                <span style={{ fontSize: 11, color: '#ff8' }}>Bones Only (dp positions)</span>
              </label>
            </div>

            {/* Frame controls */}
            {playingMotion && (
              <div style={{ padding: '6px 12px', borderBottom: '1px solid #333' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    onClick={() => setPaused(p => !p)}
                    style={{
                      padding: '2px 8px', fontSize: 11, cursor: 'pointer',
                      background: paused ? '#664400' : '#333', color: '#ccc',
                      border: '1px solid #555', borderRadius: 3,
                    }}
                  >
                    {paused ? '▶ Play' : '⏸ Pause'}
                  </button>
                  {paused && (
                    <>
                      <button
                        onClick={() => {
                          const clip = loadedClips[playingMotion!];
                          if (!clip || !applyFrameRef.current) return;
                          const prev = Math.max(0, currentFrame - 1);
                          setCurrentFrame(prev);
                          applyFrameRef.current(prev);
                        }}
                        style={{ padding: '2px 6px', fontSize: 11, cursor: 'pointer', background: '#333', color: '#ccc', border: '1px solid #555', borderRadius: 3 }}
                      >◀</button>
                      <button
                        onClick={() => {
                          const clip = loadedClips[playingMotion!];
                          if (!clip || !applyFrameRef.current) return;
                          const next = Math.min(clip.frameCount - 1, currentFrame + 1);
                          setCurrentFrame(next);
                          applyFrameRef.current(next);
                        }}
                        style={{ padding: '2px 6px', fontSize: 11, cursor: 'pointer', background: '#333', color: '#ccc', border: '1px solid #555', borderRadius: 3 }}
                      >▶</button>
                    </>
                  )}
                  <span style={{ fontSize: 11, color: '#aaa' }}>
                    Frame: {currentFrame} / {loadedClips[playingMotion!]?.frameCount ?? '?'}
                  </span>
                </div>
              </div>
            )}
            {/* Equipment toggles */}
            {equipParts.length > 0 && (
              <div style={{ padding: '10px 12px', borderBottom: '1px solid #333' }}>
                <div style={{ fontSize: 12, fontWeight: 'bold', color: '#fff', marginBottom: 8 }}>
                  Equipment {equipLoading && <span style={{ fontSize: 10, color: '#888' }}>(loading...)</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {equipParts.map(part => (
                    <label key={part.key} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11 }}>
                      <input
                        type="checkbox"
                        checked={equipEnabled[part.key] ?? false}
                        onChange={e => {
                          setEquipEnabled(prev => ({ ...prev, [part.key]: e.target.checked }));
                        }}
                      />
                      <span style={{ color: equipEnabled[part.key] ? '#ccc' : '#666' }}>{part.key}</span>
                      <span style={{ fontSize: 9, color: '#555' }}>({part.voxels})</span>
                    </label>
                  ))}
                </div>
                <button
                  onClick={async () => {
                    // Rebuild preview with new equipment
                    const scene = sceneRef.current;
                    if (!scene) return;
                    const { cx, cy } = centerRef.current;
                    // Stop current motion
                    stopMotion();

                    // Dispose old preview
                    for (const m of previewMeshesRef.current.values()) m.dispose();
                    for (const n of previewNodesRef.current.values()) n.dispose();
                    previewMeshesRef.current.clear();
                    previewNodesRef.current.clear();
                    for (const s of debugBonesRef.current.spheres) s.dispose();
                    if (debugBonesRef.current.lines) debugBonesRef.current.lines.dispose();
                    debugBonesRef.current = { spheres: [], lines: null };

                    // Load equipment and rebuild
                    const equipVoxels = await loadEquipmentVoxels();
                    const mergedVoxels = [...voxelsRef.current];
                    if (equipVoxels.length > 0) {
                      const bodySet = new Set<string>();
                      for (const v of mergedVoxels) bodySet.add(`${v.x},${v.y},${v.z}`);
                      for (const v of equipVoxels) {
                        const k = `${v.x},${v.y},${v.z}`;
                        if (bodySet.has(k)) {
                          const idx = mergedVoxels.findIndex(bv => bv.x === v.x && bv.y === v.y && bv.z === v.z);
                          if (idx >= 0) mergedVoxels[idx] = v;
                        } else {
                          mergedVoxels.push(v);
                        }
                      }
                    }

                    const { nodes, meshes } = buildSkeletalCharacter(mergedVoxels, calculatedBones, scene, cx, cy);
                    previewNodesRef.current = nodes;
                    previewMeshesRef.current = meshes;

                    // Restart motion if was playing
                    if (playingMotion && loadedClips[playingMotion]) {
                      playMotionClip(loadedClips[playingMotion]);
                    }
                  }}
                  style={{
                    marginTop: 6, padding: '4px 0', width: '100%', borderRadius: 3, cursor: 'pointer',
                    background: '#2a3a5e', color: '#aaf', border: '1px solid #446', fontSize: 11,
                  }}
                >
                  装備を反映
                </button>
              </div>
            )}

            {/* Bone info */}
            <div style={{ padding: '6px 12px', borderBottom: '1px solid #333' }}>
              <span style={{ fontSize: 11, color: '#888' }}>
                {playingMotion ? 'モーション再生中 (41ボーン階層アニメーション)' : 'モーションを選択してください'}
              </span>
            </div>

            {/* Bone list (read-only status) */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              <div style={{ padding: '6px 12px', fontSize: 11, color: '#666', borderBottom: '1px solid #222' }}>
                ボーン分割一覧 (41ボーン)
              </div>
              {BONE_DEFS.map(bone => {
                const hasMesh = previewMeshesRef.current.has(bone.name);
                const depth = getBoneDepth(bone.name);
                return (
                  <div
                    key={bone.name}
                    style={{
                      padding: '3px 12px', paddingLeft: 12 + depth * 12,
                      fontSize: 10, color: hasMesh ? '#aaa' : '#555',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: bone.color, display: 'inline-block',
                      opacity: hasMesh ? 1 : 0.3,
                    }} />
                    <span>{bone.label}</span>
                  </div>
                );
              })}
            </div>

            {/* Save / Back buttons */}
            <div style={{ padding: '10px 12px', borderTop: '1px solid #333', display: 'flex', gap: 6 }}>
              <button
                onClick={exitPreview}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 4, cursor: 'pointer',
                  background: '#3a2a2a', color: '#ccc', border: '1px solid #555', fontSize: 12,
                }}
              >
                ← 戻る
              </button>
              <button
                onClick={handleConfirmSave}
                disabled={saving}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 4, cursor: 'pointer',
                  background: '#4a6', color: '#fff', border: '2px solid #5b7',
                  fontSize: 12, fontWeight: 'bold',
                }}
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, position: 'relative' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', outline: 'none' }} />

        {mode === 'edit' && (
          <>
            <div style={{
              position: 'absolute', top: 12, left: 12, padding: '6px 14px',
              background: 'rgba(50, 50, 140, 0.8)', borderRadius: 6, fontSize: 14, color: '#fff', fontWeight: 'bold',
            }}>
              {currentViewDef.label}
            </div>

            {dirty && (
              <div style={{
                position: 'absolute', top: 12, right: 12, padding: '4px 10px',
                background: 'rgba(255, 130, 50, 0.8)', borderRadius: 4, fontSize: 12, color: '#fff',
              }}>Unsaved changes</div>
            )}

            <div style={{
              position: 'absolute', bottom: 12, left: 12, padding: '8px 12px',
              background: 'rgba(0, 0, 0, 0.6)', borderRadius: 6, fontSize: 11, color: '#aaa',
            }}>
              <div>● マーカーをドラッグして配置</div>
              <div>マウスホイールでズーム</div>
              <div style={{ marginTop: 4, color: '#666' }}>
                {autoMirror
                  ? `左右対称 ON (center: X=${r1(mirrorCenterX)})`
                  : '左右対称 OFF (左右独立)'}
              </div>
            </div>
          </>
        )}

        {mode === 'preview' && (
          <>
            <div style={{
              position: 'absolute', top: 12, left: 12, padding: '6px 14px',
              background: 'rgba(80, 140, 50, 0.8)', borderRadius: 6, fontSize: 14, color: '#fff', fontWeight: 'bold',
            }}>
              Split Preview
              {playingMotion && (
                <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.8 }}>
                  {MOTION_FILES.find(p => p.name === playingMotion)?.label}
                </span>
              )}
            </div>
            <div style={{
              position: 'absolute', bottom: 12, left: 12, padding: '8px 12px',
              background: 'rgba(0, 0, 0, 0.6)', borderRadius: 6, fontSize: 11, color: '#aaa',
            }}>
              <div>マウスドラッグで回転、ホイールでズーム</div>
              <div style={{ marginTop: 4, color: '#888' }}>問題なければ「保存」、修正は「戻る」</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
