/**
 * モデルインポート - 4ステップワークフロー
 */

import { useState } from 'react';

import {
  MARKER_GROUPS, getMarkerColor,
  CATEGORY_INFO, PART_CATEGORIES,
  type VoxelEntry,
} from '@/utils/auto-rigger';

import type { Step } from '@/utils/model-import/constants';
import { MOTIONS } from '@/utils/model-import/constants';

import { ModelImportSidebar } from '@/components/model-import/Sidebar';
import { CanvasOverlay } from '@/components/model-import/CanvasOverlay';
import EditorLayout from '@/templates/EditorLayout';

import { useModelImportScene, useModelImportRefs } from '@/utils/model-import/useModelImportScene';
import { useModelImportMarkers, useModelImportSteps } from '@/utils/model-import/useModelImportWorkflow';
import { useModelImportGenerate, useModelImportMotion, useModelImportExport } from '@/utils/model-import/useModelImportOutput';

interface ModelImportTemplateProps {
  /** ページタイトル */
  title?: string;
  /** 背景色 */
  background?: string;
}

export default function ModelImportTemplate({ title = 'AUTO-RIGGER', background = '#111118' }: ModelImportTemplateProps) {
  const { canvasRef, sceneRef, highlightRef } = useModelImportScene();
  const refs = useModelImportRefs();

  const [step, setStep] = useState<Step>('upload');
  const [bodyVoxels, setBodyVoxels] = useState<VoxelEntry[]>([]);
  const [otherPartVoxels, setOtherPartVoxels] = useState<Record<string, VoxelEntry[]>>({});

  const markerState = useModelImportMarkers({ sceneRef, markerMeshesRef: refs.markerMeshesRef, step });

  const motion = useModelImportMotion({
    sceneRef, skelNodesRef: refs.skelNodesRef, skelMeshesRef: refs.skelMeshesRef,
    restPosRef: refs.restPosRef, deformParamsRef: refs.deformParamsRef,
    worldMarkersRef: refs.worldMarkersRef, resultMeshesRef: refs.resultMeshesRef,
    animCallbackRef: refs.animCallbackRef, animTimeRef: refs.animTimeRef,
  });

  const stepsState = useModelImportSteps({
    sceneRef, highlightRef, meshMapRef: refs.meshMapRef, centerLineRef: refs.centerLineRef,
    markerMeshesRef: refs.markerMeshesRef, skelNodesRef: refs.skelNodesRef,
    skelMeshesRef: refs.skelMeshesRef, restPosRef: refs.restPosRef,
    animCallbackRef: refs.animCallbackRef, resultMeshesRef: refs.resultMeshesRef,
    modelCenter: markerState.modelCenter, setModelCenter: markerState.setModelCenter,
    setMarkers: markerState.setMarkers, setActiveMarker: markerState.setActiveMarker,
    setPlayingMotion: motion.setPlayingMotion,
    setBodyVoxels, setOtherPartVoxels, step, setStep,
  });

  const { doGenerate, generating, genStatus } = useModelImportGenerate({
    sceneRef, highlightRef, meshMapRef: refs.meshMapRef, centerLineRef: refs.centerLineRef,
    markerMeshesRef: refs.markerMeshesRef, deformParamsRef: refs.deformParamsRef,
    worldMarkersRef: refs.worldMarkersRef, resultMeshesRef: refs.resultMeshesRef,
    skelNodesRef: refs.skelNodesRef, skelMeshesRef: refs.skelMeshesRef, restPosRef: refs.restPosRef,
    completeMarkers: markerState.completeMarkers, clearResult: stepsState.clearResult,
    parts: stepsState.parts, setBodyVoxels, setOtherPartVoxels, setError: stepsState.setError, setStep,
  });

  const { doExportBody, doExportSkeletal, doExportGLB, doExportSegments, doExportPart } = useModelImportExport({
    bodyVoxels, fileName: stepsState.fileName,
    deformParamsRef: refs.deformParamsRef, worldMarkersRef: refs.worldMarkersRef, otherPartVoxels,
  });

  return (
    <EditorLayout
      ref={canvasRef}
      background={background}
      sidebar={
        <ModelImportSidebar
          step={step} title={title}
          fileName={stepsState.fileName} loading={stepsState.loading} error={stepsState.error} onFileSelect={stepsState.loadModel}
          parts={stepsState.parts} selectedPart={stepsState.selectedPart} partNames={stepsState.partNames}
          categoryCounts={stepsState.categoryCounts} hasBody={stepsState.hasBody}
          partCategories={PART_CATEGORIES} categoryInfo={CATEGORY_INFO}
          onSelectPart={stepsState.setSelectedPart} onToggleVis={stepsState.toggleVis}
          onSetCategory={stepsState.setCat} onBack={stepsState.goBack} onNext={stepsState.goToMarkers}
          markers={markerState.markers} activeMarker={markerState.activeMarker} useSymmetry={markerState.useSymmetry}
          allMarkersPlaced={markerState.allMarkersPlaced} generating={generating} genStatus={genStatus}
          markerGroups={MARKER_GROUPS}
          onSetActiveMarker={markerState.setActiveMarker} onClearMarker={markerState.clearMarker}
          onSetUseSymmetry={markerState.setUseSymmetry}
          onResetMarkers={() => { markerState.setMarkers({}); markerState.setActiveMarker('Chin'); }}
          onGenerate={doGenerate}
          bodyVoxels={bodyVoxels} otherPartVoxels={otherPartVoxels}
          playingMotion={motion.playingMotion} loadingMotion={motion.loadingMotion} motions={MOTIONS}
          onStartMotion={motion.startMotion} onStopMotion={motion.stopMotion}
          onExportSegments={doExportSegments} onExportGLB={doExportGLB}
          onExportSkeletal={doExportSkeletal} onExportBody={doExportBody} onExportPart={doExportPart}
        />
      }
      overlay={
        <CanvasOverlay
          step={step} activeMarker={markerState.activeMarker} dragOver={stepsState.dragOver}
          fileName={stepsState.fileName} loading={stepsState.loading} selectedPart={stepsState.selectedPart}
          parts={stepsState.parts} categoryInfo={CATEGORY_INFO}
          getMarkerColor={getMarkerColor} onDeselectPart={() => stepsState.setSelectedPart(null)}
        />
      }
      canvasContainerProps={{ onDragOver: stepsState.onDragOver, onDragLeave: stepsState.onDragLeave, onDrop: stepsState.onDrop }}
    />
  );
}
