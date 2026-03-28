import { useEffect, useCallback } from 'react';
import type { MarkerData, Vec3 } from '@/utils/voxelize/skeleton';
import { calculateAllBones, mirrorMarker, getDefaultMarkers } from '@/utils/voxelize/skeleton';
import { MARKER_DEFS, type MarkerDef, VIEW_DEFS, type ViewDirection } from '@/utils/bone-config/constants';
import type { BoneConfigRefs } from './useBoneConfigScene';
import type { ModelEntry } from '@/utils/model-registry';
import type { VoxelEntry } from '@/utils/voxelize/core';
import { buildSkeletalCharacter } from '@/utils/voxelize/skeleton';
import type { PageMode } from '@/utils/bone-config/constants';
import type { MotionClip } from '@/utils/voxelize/core';

// ============================================================
// useBoneConfigMarkers
// ============================================================

interface UseBoneConfigMarkersParams {
  refs: BoneConfigRefs;
  markers: MarkerData;
  setMarkers: React.Dispatch<React.SetStateAction<MarkerData>>;
  autoMirror: boolean;
  setAutoMirror: React.Dispatch<React.SetStateAction<boolean>>;
  selectedMarker: string;
  setSelectedMarker: (s: string) => void;
  setDirty: (d: boolean) => void;
  setCalculatedBones: (b: Record<string, Vec3>) => void;
  setViewDir: (d: ViewDirection) => void;
  loading: boolean;
}

export function useBoneConfigMarkers({
  refs, markers, setMarkers, autoMirror, setAutoMirror,
  selectedMarker, setSelectedMarker, setDirty, setCalculatedBones,
  setViewDir, loading,
}: UseBoneConfigMarkersParams) {
  const { centerRef, cameraRef, viewRef, autoMirrorRef } = refs;

  // Keep ref in sync
  useEffect(() => { autoMirrorRef.current = autoMirror; }, [autoMirror, autoMirrorRef]);

  // Compute mirror center from Chin/Groin X
  const getMirrorCenterX = useCallback(() => {
    return (markers['Chin'].x + markers['Groin'].x) / 2;
  }, [markers]);

  // Apply auto-mirror: sync right markers from left
  const applyAutoMirror = useCallback((m: MarkerData): MarkerData => {
    const mcx = (m['Chin'].x + m['Groin'].x) / 2;
    return {
      ...m,
      RightWrist: mirrorMarker(m['LeftWrist'], mcx),
      RightElbow: mirrorMarker(m['LeftElbow'], mcx),
      RightKnee:  mirrorMarker(m['LeftKnee'], mcx),
    };
  }, []);

  // Get visible markers based on autoMirror state
  const getVisibleMarkers = useCallback((): MarkerDef[] => {
    return autoMirror ? MARKER_DEFS.filter(m => m.side !== 'right') : MARKER_DEFS;
  }, [autoMirror]);

  // Camera view switch
  const setCameraView = useCallback((dir: ViewDirection) => {
    const camera = cameraRef.current;
    if (!camera) return;
    const vDef = VIEW_DEFS.find(v => v.key === dir)!;
    camera.alpha = vDef.alpha;
    camera.beta = Math.PI / 2;
    viewRef.current = dir;
  }, [cameraRef, viewRef]);

  const switchView = useCallback((dir: ViewDirection) => {
    setViewDir(dir);
    setCameraView(dir);
  }, [setCameraView, setViewDir]);

  // Recalculate bones whenever markers change
  useEffect(() => {
    const { maxZ } = centerRef.current;
    setCalculatedBones(calculateAllBones(markers, maxZ));
  }, [markers, centerRef, setCalculatedBones]);

  // マーカー座標の更新
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
  }, [autoMirrorRef, setMarkers, setDirty]);

  // Toggle auto-mirror
  const toggleAutoMirror = useCallback(() => {
    setAutoMirror(prev => {
      const next = !prev;
      if (next) setMarkers(m => applyAutoMirror(m));
      const selDef = MARKER_DEFS.find(m => m.name === selectedMarker);
      if (next && selDef?.side === 'right' && selDef.mirrorOf) {
        setSelectedMarker(selDef.mirrorOf);
      }
      setDirty(true);
      return next;
    });
  }, [selectedMarker, applyAutoMirror, setAutoMirror, setMarkers, setSelectedMarker, setDirty]);

  // マーカー位置をデフォルトにリセット
  const resetToDefaults = useCallback(() => {
    const { cx } = centerRef.current;
    setMarkers(getDefaultMarkers(cx));
    setAutoMirror(true);
    setDirty(true);
  }, [centerRef, setMarkers, setAutoMirror, setDirty]);

  return {
    getMirrorCenterX, getVisibleMarkers, setCameraView, switchView,
    updateMarker, toggleAutoMirror, resetToDefaults,
  };
}

// ============================================================
// useBoneConfigActions
// ============================================================

interface UseBoneConfigActionsParams {
  refs: BoneConfigRefs;
  mode: PageMode;
  calculatedBones: Record<string, Vec3>;
  playingMotion: string | null;
  loadedClips: Record<string, MotionClip>;
  currentFrame: number;
  stopMotion: () => void;
  loadEquipmentVoxels: () => Promise<VoxelEntry[]>;
  playMotionClip: (clip: MotionClip) => void;
  exitPreview: () => void;
  setCurrentModel: (m: ModelEntry) => void;
  setCurrentFrame: (f: number) => void;
}

export function useBoneConfigActions({
  refs, mode, calculatedBones, playingMotion, loadedClips, currentFrame,
  stopMotion, loadEquipmentVoxels, playMotionClip, exitPreview,
  setCurrentModel, setCurrentFrame,
}: UseBoneConfigActionsParams) {
  const { sceneRef, centerRef, previewMeshesRef, previewNodesRef, debugBonesRef, voxelsRef, applyFrameRef } = refs;

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
  }, [sceneRef, centerRef, previewMeshesRef, previewNodesRef, debugBonesRef, voxelsRef,
      stopMotion, loadEquipmentVoxels, calculatedBones, playingMotion, loadedClips, playMotionClip]);

  // モデル切替ハンドラ
  const handleModelChange = useCallback((m: ModelEntry) => {
    if (mode === 'preview') exitPreview();
    setCurrentModel(m);
  }, [mode, exitPreview, setCurrentModel]);

  // フレーム前送り/後送りハンドラ
  const handlePrevFrame = useCallback(() => {
    const clip = playingMotion ? loadedClips[playingMotion] : null;
    if (!clip || !applyFrameRef.current) return;
    const prev = Math.max(0, currentFrame - 1);
    setCurrentFrame(prev);
    applyFrameRef.current(prev);
  }, [playingMotion, loadedClips, currentFrame, applyFrameRef, setCurrentFrame]);

  const handleNextFrame = useCallback(() => {
    const clip = playingMotion ? loadedClips[playingMotion] : null;
    if (!clip || !applyFrameRef.current) return;
    const next = Math.min(clip.frameCount - 1, currentFrame + 1);
    setCurrentFrame(next);
    applyFrameRef.current(next);
  }, [playingMotion, loadedClips, currentFrame, applyFrameRef, setCurrentFrame]);

  return { handleRebuildEquipment, handleModelChange, handlePrevFrame, handleNextFrame };
}
