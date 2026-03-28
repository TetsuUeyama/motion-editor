'use client';

import { useEffect, useState, useCallback } from 'react';
import { MODEL_REGISTRY, DEFAULT_MODEL_ID } from '@/utils/model-registry';
import type { ModelEntry } from '@/utils/model-registry';
import type { VoxelEntry } from '@/utils/vox-parser';
import {
  type Vec3, type MarkerData,
  calculateAllBones, mirrorMarker, getDefaultMarkers,
  buildSkeletalCharacter,
} from '@/utils/voxel-skeleton';
import {
  MARKER_DEFS, type MarkerDef, VIEW_DEFS, type ViewDirection,
  type EquipPart, type PageMode, type QuatConversion,
} from '@/utils/bone-config/constants';

// Hooks
import { useBoneConfigRefs } from './hooks/useBoneConfigRefs';
import { useBoneConfigMotion } from './hooks/useBoneConfigMotion';
import { useBoneConfigPreview } from './hooks/useBoneConfigPreview';
import { useBoneConfigScene } from './hooks/useBoneConfigScene';
import { useBoneConfigModel } from './hooks/useBoneConfigModel';
import { useBoneConfigVisuals } from './hooks/useBoneConfigVisuals';

// Components
import { SidebarHeader } from '@/components/bone-config/SidebarHeader';
import { ViewDirectionBar } from '@/components/bone-config/ViewDirectionBar';
import { MarkerEditor } from '@/components/bone-config/MarkerEditor';
import { BoneList } from '@/components/bone-config/BoneList';
import { MotionPanel } from '@/components/bone-config/MotionPanel';
import { FrameControls } from '@/components/bone-config/FrameControls';
import { EquipmentPanel } from '@/components/bone-config/EquipmentPanel';
import { EditActions } from '@/components/bone-config/EditActions';
import { PreviewActions } from '@/components/bone-config/PreviewActions';
import { CanvasOverlay } from '@/components/bone-config/CanvasOverlay';
import EditorLayout from '@/templates/EditorLayout';

// ========================================================================
// メインビューコンポーネント
// ボクセルモデルのボーン設定・マーカー配置・モーションプレビューを行うページ
// 左側パネル: マーカー/ボーン一覧、モーション選択
// 右側: Babylon.jsの3Dビューワー（マーカードラッグ、モーション再生）
// ========================================================================
export default function BoneConfigView() {
  // 全Refオブジェクトをフックから取得（3Dシーン、メッシュ、アニメーション等）
  const refs = useBoneConfigRefs();
  const {
    canvasRef, cameraRef, previewMeshesRef, previewNodesRef,
    debugBonesRef, voxelsRef, centerRef, viewRef, autoMirrorRef, pausedRef,
    applyFrameRef, sceneRef,
  } = refs;

  // ========== State定義 ==========
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markers, setMarkers] = useState<MarkerData>(() => getDefaultMarkers(35));
  const [calculatedBones, setCalculatedBones] = useState<Record<string, Vec3>>({});
  const [selectedMarker, setSelectedMarker] = useState<string>('Chin');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showBody, setShowBody] = useState(true);
  const [showBones, setShowBones] = useState(true);
  const [tab, setTab] = useState<'markers' | 'bones'>('markers');
  const [viewDir, setViewDir] = useState<ViewDirection>('front');
  const [autoMirror, setAutoMirror] = useState(true);
  const [mode, setMode] = useState<PageMode>('edit');
  const [motionSpeed, setMotionSpeed] = useState(1.0);
  const [quatConv, setQuatConv] = useState<QuatConversion>('correct');
  const [paused, setPaused] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [showBonesOnly, setShowBonesOnly] = useState(false);
  const [equipParts, setEquipParts] = useState<EquipPart[]>([]);
  const [equipEnabled, setEquipEnabled] = useState<Record<string, boolean>>({});
  const [equipVoxelCache, setEquipVoxelCache] = useState<Record<string, VoxelEntry[]>>({});

  // モーション再生ロジック（フック）
  const { playingMotion, loadingMotion, loadedClips, stopMotion, startMotion, playMotionClip } = useBoneConfigMotion({
    refs, calculatedBones, motionSpeed, quatConv, showBonesOnly, setCurrentFrame,
  });

  // プレビューモード管理（フック）
  const setCameraView = useCallback((dir: ViewDirection) => {
    const camera = cameraRef.current;
    if (!camera) return;
    const vDef = VIEW_DEFS.find(v => v.key === dir)!;
    camera.alpha = vDef.alpha;
    camera.beta = Math.PI / 2;
    viewRef.current = dir;
  }, []);

  const {
    loadEquipmentVoxels, enterPreview, exitPreview, handleConfirmSave, equipLoading,
  } = useBoneConfigPreview({
    refs, calculatedBones, markers, autoMirror, showBody,
    currentModel: { dir: currentModel.dir }, equipParts, equipEnabled, equipVoxelCache,
    setEquipVoxelCache, setMode, setShowBonesOnly, setSaving, setDirty,
    setCameraView,
    stopMotion,
    buildSkeletalPreview: buildSkeletalCharacter as any,
  });

  // Babylon.js scene initialization
  useBoneConfigScene({
    refs, setMarkers, setDirty, setSelectedMarker, setTab,
  });

  // Model loading
  useBoneConfigModel({
    refs, currentModel,
    setLoading, setError, setDirty, setMarkers, setAutoMirror,
    setEquipParts, setEquipEnabled, setEquipVoxelCache,
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
      return MARKER_DEFS.filter(m => m.side !== 'right');
    }
    return MARKER_DEFS;
  }, [autoMirror]);

  // Visuals rebuild hook
  const { rebuildVisuals } = useBoneConfigVisuals({
    refs, markers, calculatedBones, selectedMarker, showBones, autoMirror,
    getMirrorCenterX, getVisibleMarkers,
  });

  // Rebuild visuals
  useEffect(() => {
    if (!loading) rebuildVisuals();
  }, [loading, rebuildVisuals]);

  // Toggle body visibility
  useEffect(() => {
    if (refs.bodyMeshRef.current) refs.bodyMeshRef.current.setEnabled(showBody);
  }, [showBody]);

  // マーカー座標の更新（サイドバーの数値入力から呼ばれる）
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
        setMarkers(m => applyAutoMirror(m));
      }
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

  // 装備リビルドハンドラ
  const handleRebuildEquipment = useCallback(async () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const { cx, cy } = centerRef.current;
    stopMotion();

    for (const m of previewMeshesRef.current.values()) m.dispose();
    for (const n of previewNodesRef.current.values()) n.dispose();
    previewMeshesRef.current.clear();
    previewNodesRef.current.clear();
    for (const s of debugBonesRef.current.spheres) s.dispose();
    if (debugBonesRef.current.lines) debugBonesRef.current.lines.dispose();
    debugBonesRef.current = { spheres: [], lines: null };

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

    if (playingMotion && loadedClips[playingMotion]) {
      playMotionClip(loadedClips[playingMotion]);
    }
  }, [stopMotion, loadEquipmentVoxels, calculatedBones, playingMotion, loadedClips, playMotionClip]);

  // モデル切替ハンドラ
  const handleModelChange = useCallback((m: ModelEntry) => {
    if (mode === 'preview') exitPreview();
    setCurrentModel(m);
  }, [mode, exitPreview]);

  // フレーム前送り/後送りハンドラ
  const handlePrevFrame = useCallback(() => {
    const clip = playingMotion ? loadedClips[playingMotion] : null;
    if (!clip || !applyFrameRef.current) return;
    const prev = Math.max(0, currentFrame - 1);
    setCurrentFrame(prev);
    applyFrameRef.current(prev);
  }, [playingMotion, loadedClips, currentFrame]);

  const handleNextFrame = useCallback(() => {
    const clip = playingMotion ? loadedClips[playingMotion] : null;
    if (!clip || !applyFrameRef.current) return;
    const next = Math.min(clip.frameCount - 1, currentFrame + 1);
    setCurrentFrame(next);
    applyFrameRef.current(next);
  }, [playingMotion, loadedClips, currentFrame]);

  // ========== JSX用の派生値 ==========
  const selMarker = MARKER_DEFS.find(m => m.name === selectedMarker);
  const selPos = selectedMarker ? markers[selectedMarker] : null;
  const currentViewDef = VIEW_DEFS.find(v => v.key === viewDir)!;
  const visibleMarkers = getVisibleMarkers();
  const mirrorCenterX = getMirrorCenterX();

  // ========== JSXレンダリング ==========
  const sidebar = (
    <div style={{ background: '#0f0f23', color: '#ccc', borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', overflow: 'auto', height: '100%' }}>
      <SidebarHeader currentModel={currentModel} error={error} loading={loading} onModelChange={handleModelChange} />

      {mode === 'edit' && (
        <ViewDirectionBar
          viewDir={viewDir} currentViewDef={currentViewDef}
          showBody={showBody} showBones={showBones} autoMirror={autoMirror}
          onSwitchView={switchView} onToggleBody={() => setShowBody(!showBody)}
          onToggleBones={() => setShowBones(!showBones)} onToggleAutoMirror={toggleAutoMirror}
        />
      )}

      {mode === 'edit' && (
        <div style={{ display: 'flex', borderBottom: '1px solid #333' }}>
          <button onClick={() => setTab('markers')} style={{
            flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 'bold',
            background: tab === 'markers' ? '#2a2a5e' : 'transparent', color: tab === 'markers' ? '#fff' : '#888',
            borderBottom: tab === 'markers' ? '2px solid #88f' : '2px solid transparent',
          }}>Markers ({autoMirror ? 5 : 8})</button>
          <button onClick={() => setTab('bones')} style={{
            flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 'bold',
            background: tab === 'bones' ? '#2a2a5e' : 'transparent', color: tab === 'bones' ? '#fff' : '#888',
            borderBottom: tab === 'bones' ? '2px solid #88f' : '2px solid transparent',
          }}>Auto Bones (41)</button>
        </div>
      )}

      {mode === 'edit' && tab === 'markers' && (
        <MarkerEditor
          selectedMarker={selectedMarker} selMarker={selMarker} selPos={selPos}
          currentViewDef={currentViewDef} autoMirror={autoMirror}
          mirrorCenterX={mirrorCenterX} visibleMarkers={visibleMarkers} markers={markers}
          onUpdateMarker={updateMarker} onSelectMarker={setSelectedMarker}
        />
      )}
      {mode === 'edit' && tab === 'bones' && <BoneList mode="edit" calculatedBones={calculatedBones} />}
      {mode === 'edit' && (
        <EditActions hasCalculatedBones={Object.keys(calculatedBones).length > 0} onReset={resetToDefaults} onEnterPreview={enterPreview} />
      )}

      {mode === 'preview' && (
        <>
          <MotionPanel
            playingMotion={playingMotion} loadingMotion={loadingMotion} loadedClips={loadedClips}
            motionSpeed={motionSpeed} quatConv={quatConv} showBonesOnly={showBonesOnly}
            onStartMotion={startMotion} onStopMotion={stopMotion}
            onSetMotionSpeed={setMotionSpeed} onSetQuatConv={setQuatConv} onSetShowBonesOnly={setShowBonesOnly}
          />
          {playingMotion && (
            <FrameControls paused={paused} currentFrame={currentFrame} playingMotion={playingMotion}
              clip={loadedClips[playingMotion]} onTogglePause={() => setPaused(p => !p)}
              onPrevFrame={handlePrevFrame} onNextFrame={handleNextFrame}
            />
          )}
          <EquipmentPanel equipParts={equipParts} equipEnabled={equipEnabled} equipLoading={equipLoading}
            onToggleEquip={(key, enabled) => setEquipEnabled(prev => ({ ...prev, [key]: enabled }))}
            onRebuildEquipment={handleRebuildEquipment}
          />
          <div style={{ padding: '6px 12px', borderBottom: '1px solid #333' }}>
            <span style={{ fontSize: 11, color: '#888' }}>
              {playingMotion ? 'モーション再生中 (41ボーン階層アニメーション)' : 'モーションを選択してください'}
            </span>
          </div>
          <BoneList mode="preview" previewMeshes={previewMeshesRef.current} />
          <PreviewActions saving={saving} onBack={exitPreview} onSave={handleConfirmSave} />
        </>
      )}
    </div>
  );

  const overlay = (
    <CanvasOverlay mode={mode} currentViewDef={currentViewDef} dirty={dirty}
      autoMirror={autoMirror} mirrorCenterX={mirrorCenterX} playingMotion={playingMotion}
    />
  );

  return <EditorLayout ref={canvasRef} sidebar={sidebar} overlay={overlay} />;
}
