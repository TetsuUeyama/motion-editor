'use client';

import { useEffect, useState } from 'react';
import { MODEL_REGISTRY, DEFAULT_MODEL_ID } from '@/utils/model-registry';
import type { ModelEntry } from '@/utils/model-registry';
import type { VoxelEntry } from '@/utils/vox-parser';
import { type Vec3, type MarkerData, getDefaultMarkers } from '@/utils/voxel-skeleton';
import {
  MARKER_DEFS, VIEW_DEFS, type ViewDirection,
  type EquipPart, type PageMode, type QuatConversion,
} from '@/utils/bone-config/constants';

import { useBoneConfigRefs, useBoneConfigScene } from '@/utils/bone-config/hooks/useBoneConfigScene';
import { useBoneConfigMotion } from '@/utils/bone-config/hooks/useBoneConfigMotion';
import { useBoneConfigVisuals, useBoneConfigPreview } from '@/utils/bone-config/hooks/useBoneConfigPreview';
import { useBoneConfigModel } from '@/utils/bone-config/hooks/useBoneConfigModel';
import { useBoneConfigMarkers, useBoneConfigActions } from '@/utils/bone-config/hooks/useBoneConfigInteractions';

import { SidebarHeader, ViewDirectionBar } from '@/components/bone-config/SidebarHeader';
import { MarkerEditor } from '@/components/bone-config/MarkerEditor';
import { BoneList } from '@/components/bone-config/BoneList';
import { MotionPanel, FrameControls, EquipmentPanel } from '@/components/bone-config/MotionPanel';
import { EditActions, PreviewActions } from '@/components/bone-config/ActionButtons';
import { CanvasOverlay } from '@/components/bone-config/CanvasOverlay';
import EditorLayout from '@/templates/EditorLayout';

export default function BoneConfigView() {
  const refs = useBoneConfigRefs();
  const { canvasRef, previewMeshesRef, pausedRef } = refs;

  // ========== State ==========
  const [currentModel, setCurrentModel] = useState<ModelEntry>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const modelId = params.get('model');
      if (modelId) { const m = MODEL_REGISTRY.find(e => e.id === modelId); if (m) return m; }
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

  // ========== Hooks ==========
  const { playingMotion, loadingMotion, loadedClips, stopMotion, startMotion, playMotionClip } =
    useBoneConfigMotion({ refs, calculatedBones, motionSpeed, quatConv, showBonesOnly, setCurrentFrame });

  const {
    getMirrorCenterX, getVisibleMarkers, setCameraView, switchView,
    updateMarker, toggleAutoMirror, resetToDefaults,
  } = useBoneConfigMarkers({
    refs, markers, setMarkers, autoMirror, setAutoMirror,
    selectedMarker, setSelectedMarker, setDirty, setCalculatedBones, setViewDir, loading,
  });

  const { loadEquipmentVoxels, enterPreview, exitPreview, handleConfirmSave, equipLoading } =
    useBoneConfigPreview({
      refs, calculatedBones, markers, autoMirror, showBody,
      currentModel: { dir: currentModel.dir }, equipParts, equipEnabled, equipVoxelCache,
      setEquipVoxelCache, setMode, setShowBonesOnly, setSaving, setDirty,
      setCameraView, stopMotion, buildSkeletalPreview: undefined as any,
    });

  const { handleRebuildEquipment, handleModelChange, handlePrevFrame, handleNextFrame } =
    useBoneConfigActions({
      refs, mode, calculatedBones, playingMotion, loadedClips, currentFrame,
      stopMotion, loadEquipmentVoxels, playMotionClip, exitPreview,
      setCurrentModel, setCurrentFrame,
    });

  useBoneConfigScene({ refs, setMarkers, setDirty, setSelectedMarker, setTab });
  useBoneConfigModel({
    refs, currentModel, setLoading, setError, setDirty, setMarkers, setAutoMirror,
    setEquipParts, setEquipEnabled, setEquipVoxelCache,
  });

  const { rebuildVisuals } = useBoneConfigVisuals({
    refs, markers, calculatedBones, selectedMarker, showBones, autoMirror,
    getMirrorCenterX, getVisibleMarkers,
  });

  // ========== Effects ==========
  useEffect(() => { pausedRef.current = paused; }, [paused, pausedRef]);
  useEffect(() => { if (!loading) rebuildVisuals(); }, [loading, rebuildVisuals]);
  useEffect(() => { if (refs.bodyMeshRef.current) refs.bodyMeshRef.current.setEnabled(showBody); }, [showBody, refs.bodyMeshRef]);

  // ========== 派生値 ==========
  const selMarker = MARKER_DEFS.find(m => m.name === selectedMarker);
  const selPos = selectedMarker ? markers[selectedMarker] : null;
  const currentViewDef = VIEW_DEFS.find(v => v.key === viewDir)!;
  const visibleMarkers = getVisibleMarkers();
  const mirrorCenterX = getMirrorCenterX();

  // ========== JSX ==========
  const sidebar = (
    <div style={{ background: '#0f0f23', color: '#ccc', borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', overflow: 'auto', height: '100%' }}>
      <SidebarHeader currentModel={currentModel} error={error} loading={loading} onModelChange={handleModelChange} />

      {mode === 'edit' && (
        <ViewDirectionBar viewDir={viewDir} currentViewDef={currentViewDef}
          showBody={showBody} showBones={showBones} autoMirror={autoMirror}
          onSwitchView={switchView} onToggleBody={() => setShowBody(!showBody)}
          onToggleBones={() => setShowBones(!showBones)} onToggleAutoMirror={toggleAutoMirror} />
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
        <MarkerEditor selectedMarker={selectedMarker} selMarker={selMarker} selPos={selPos}
          currentViewDef={currentViewDef} autoMirror={autoMirror}
          mirrorCenterX={mirrorCenterX} visibleMarkers={visibleMarkers} markers={markers}
          onUpdateMarker={updateMarker} onSelectMarker={setSelectedMarker} />
      )}
      {mode === 'edit' && tab === 'bones' && <BoneList mode="edit" calculatedBones={calculatedBones} />}
      {mode === 'edit' && (
        <EditActions hasCalculatedBones={Object.keys(calculatedBones).length > 0} onReset={resetToDefaults} onEnterPreview={enterPreview} />
      )}

      {mode === 'preview' && (
        <>
          <MotionPanel playingMotion={playingMotion} loadingMotion={loadingMotion} loadedClips={loadedClips}
            motionSpeed={motionSpeed} quatConv={quatConv} showBonesOnly={showBonesOnly}
            onStartMotion={startMotion} onStopMotion={stopMotion}
            onSetMotionSpeed={setMotionSpeed} onSetQuatConv={setQuatConv} onSetShowBonesOnly={setShowBonesOnly} />
          {playingMotion && (
            <FrameControls paused={paused} currentFrame={currentFrame} playingMotion={playingMotion}
              clip={loadedClips[playingMotion]} onTogglePause={() => setPaused(p => !p)}
              onPrevFrame={handlePrevFrame} onNextFrame={handleNextFrame} />
          )}
          <EquipmentPanel equipParts={equipParts} equipEnabled={equipEnabled} equipLoading={equipLoading}
            onToggleEquip={(key, enabled) => setEquipEnabled(prev => ({ ...prev, [key]: enabled }))}
            onRebuildEquipment={handleRebuildEquipment} />
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
      autoMirror={autoMirror} mirrorCenterX={mirrorCenterX} playingMotion={playingMotion} />
  );

  return <EditorLayout ref={canvasRef} sidebar={sidebar} overlay={overlay} />;
}
