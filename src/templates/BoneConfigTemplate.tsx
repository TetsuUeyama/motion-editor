'use client';

import { useEffect, useState } from 'react';
import type { ModelEntry } from '@/utils/model-registry';
import type { VoxelEntry } from '@/utils/voxelize/parser';
import { type Vec3, type MarkerData, getDefaultMarkers } from '@/utils/voxelize/skeleton';
import { MARKER_DEFS, VIEW_DEFS, type ViewDirection, type EquipPart, type PageMode, type QuatConversion } from '@/utils/bone-config/constants';

import { useBoneConfigRefs, useBoneConfigScene } from '@/utils/bone-config/useBoneConfigScene';
import { useBoneConfigMotion } from '@/utils/bone-config/useBoneConfigMotion';
import { useBoneConfigVisuals, useBoneConfigPreview } from '@/utils/bone-config/useBoneConfigPreview';
import { useBoneConfigModel } from '@/utils/bone-config/useBoneConfigModel';
import { useBoneConfigMarkers, useBoneConfigActions } from '@/utils/bone-config/useBoneConfigInteractions';

import { BoneConfigSidebar } from '@/components/bone-config/Sidebar';
import { CanvasOverlay } from '@/components/bone-config/CanvasOverlay';
import EditorLayout from '@/templates/EditorLayout';

interface BoneConfigTemplateProps {
  /** viewから渡されるURLパラメータ解決済みの初期モデル */
  initialModel: ModelEntry;
}

export default function BoneConfigTemplate({ initialModel }: BoneConfigTemplateProps) {
  const refs = useBoneConfigRefs();
  const { canvasRef, previewMeshesRef, pausedRef } = refs;

  // State
  const [currentModel, setCurrentModel] = useState<ModelEntry>(initialModel);
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

  // Hooks
  const { playingMotion, loadingMotion, loadedClips, stopMotion, startMotion, playMotionClip } =
    useBoneConfigMotion({ refs, calculatedBones, motionSpeed, quatConv, showBonesOnly, setCurrentFrame });

  const { getMirrorCenterX, getVisibleMarkers, setCameraView, switchView, updateMarker, toggleAutoMirror, resetToDefaults } =
    useBoneConfigMarkers({ refs, markers, setMarkers, autoMirror, setAutoMirror, selectedMarker, setSelectedMarker, setDirty, setCalculatedBones, setViewDir, loading });

  const { loadEquipmentVoxels, enterPreview, exitPreview, handleConfirmSave, equipLoading } =
    useBoneConfigPreview({ refs, calculatedBones, markers, autoMirror, showBody, currentModel: { dir: currentModel.dir }, equipParts, equipEnabled, equipVoxelCache, setEquipVoxelCache, setMode, setShowBonesOnly, setSaving, setDirty, setCameraView, stopMotion, buildSkeletalPreview: undefined as any });

  const { handleRebuildEquipment, handleModelChange, handlePrevFrame, handleNextFrame } =
    useBoneConfigActions({ refs, mode, calculatedBones, playingMotion, loadedClips, currentFrame, stopMotion, loadEquipmentVoxels, playMotionClip, exitPreview, setCurrentModel, setCurrentFrame });

  useBoneConfigScene({ refs, setMarkers, setDirty, setSelectedMarker, setTab });
  useBoneConfigModel({ refs, currentModel, setLoading, setError, setDirty, setMarkers, setAutoMirror, setEquipParts, setEquipEnabled, setEquipVoxelCache });

  const { rebuildVisuals } = useBoneConfigVisuals({ refs, markers, calculatedBones, selectedMarker, showBones, autoMirror, getMirrorCenterX, getVisibleMarkers });

  // Effects
  useEffect(() => { pausedRef.current = paused; }, [paused, pausedRef]);
  useEffect(() => { if (!loading) rebuildVisuals(); }, [loading, rebuildVisuals]);
  useEffect(() => { if (refs.bodyMeshRef.current) refs.bodyMeshRef.current.setEnabled(showBody); }, [showBody, refs.bodyMeshRef]);

  // Derived
  const currentViewDef = VIEW_DEFS.find(v => v.key === viewDir)!;

  return (
    <EditorLayout
      ref={canvasRef}
      sidebar={
        <BoneConfigSidebar
          currentModel={currentModel} error={error} loading={loading} onModelChange={handleModelChange}
          mode={mode} viewDir={viewDir} currentViewDef={currentViewDef}
          showBody={showBody} showBones={showBones} autoMirror={autoMirror}
          onSwitchView={switchView} onToggleBody={() => setShowBody(!showBody)}
          onToggleBones={() => setShowBones(!showBones)} onToggleAutoMirror={toggleAutoMirror}
          tab={tab} onSetTab={setTab}
          selectedMarker={selectedMarker} selMarker={MARKER_DEFS.find(m => m.name === selectedMarker)}
          selPos={markers[selectedMarker] ?? null} mirrorCenterX={getMirrorCenterX()}
          visibleMarkers={getVisibleMarkers()} markers={markers}
          onUpdateMarker={updateMarker} onSelectMarker={setSelectedMarker}
          calculatedBones={calculatedBones} onReset={resetToDefaults} onEnterPreview={enterPreview}
          playingMotion={playingMotion} loadingMotion={loadingMotion} loadedClips={loadedClips}
          motionSpeed={motionSpeed} quatConv={quatConv} showBonesOnly={showBonesOnly}
          onStartMotion={startMotion} onStopMotion={stopMotion}
          onSetMotionSpeed={setMotionSpeed} onSetQuatConv={setQuatConv} onSetShowBonesOnly={setShowBonesOnly}
          paused={paused} currentFrame={currentFrame}
          onTogglePause={() => setPaused(p => !p)} onPrevFrame={handlePrevFrame} onNextFrame={handleNextFrame}
          equipParts={equipParts} equipEnabled={equipEnabled} equipLoading={equipLoading}
          onToggleEquip={(key, enabled) => setEquipEnabled(prev => ({ ...prev, [key]: enabled }))}
          onRebuildEquipment={handleRebuildEquipment}
          previewMeshes={previewMeshesRef.current}
          saving={saving} onExitPreview={exitPreview} onSave={handleConfirmSave}
        />
      }
      overlay={
        <CanvasOverlay mode={mode} currentViewDef={currentViewDef} dirty={dirty}
          autoMirror={autoMirror} mirrorCenterX={getMirrorCenterX()} playingMotion={playingMotion} />
      }
    />
  );
}
