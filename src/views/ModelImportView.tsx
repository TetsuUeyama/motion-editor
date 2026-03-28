/**
 * モデルインポート - 4ステップワークフロー
 *
 * Step 1: アップロード → 3Dモデル読み込み（GLB/GLTF/OBJ）
 * Step 2: パーツ分類   → メッシュをカテゴリ分け（ボディ/髪/衣類/その他/除外）
 * Step 3: マーカー配置 → Mixamo互換の5マーカーを配置（顎、手首、肘、膝、股間）
 * Step 4: 結果         → チビボクセルボディ + オーバーレイパーツ + スケルトン + モーションテスト
 *
 * 出力: ボーンごとに分離されたボクセルデータ（segments_bundle.json + segments.json）
 *       → contactformのrealistic-viewerで読み込んでモーション再生可能
 */

import { useState } from 'react';

import {
  MARKER_GROUPS, getMarkerColor,
  CATEGORY_INFO, PART_CATEGORIES,
  type VoxelEntry,
} from '@/utils/auto-rigger';

import type { Step } from '@/utils/model-import/constants';
import { MOTIONS } from '@/utils/model-import/constants';

import { UploadStep } from '@/components/model-import/UploadStep';
import { PartsStep } from '@/components/model-import/PartsStep';
import { MarkersStep } from '@/components/model-import/MarkersStep';
import { ResultStep } from '@/components/model-import/ResultStep';
import { CanvasOverlay } from '@/components/model-import/CanvasOverlay';
import EditorLayout from '@/templates/EditorLayout';

import { useModelImportScene, useModelImportRefs } from '@/utils/model-import/hooks/useModelImportScene';
import { useModelImportMarkers, useModelImportSteps } from '@/utils/model-import/hooks/useModelImportWorkflow';
import { useModelImportGenerate, useModelImportMotion, useModelImportExport } from '@/utils/model-import/hooks/useModelImportOutput';

// ============================================================
// メインビューコンポーネント
// ============================================================
export default function ModelImportView() {
  const { canvasRef, sceneRef, highlightRef } = useModelImportScene();
  const refs = useModelImportRefs();

  // Shared state hoisted to resolve hook dependency order
  const [step, setStep] = useState<Step>('upload');
  const [bodyVoxels, setBodyVoxels] = useState<VoxelEntry[]>([]);
  const [otherPartVoxels, setOtherPartVoxels] = useState<Record<string, VoxelEntry[]>>({});

  // Markers (needs step)
  const markerState = useModelImportMarkers({
    sceneRef, markerMeshesRef: refs.markerMeshesRef, step,
  });

  // Motion (no deps on stepsState)
  const motion = useModelImportMotion({
    sceneRef,
    skelNodesRef: refs.skelNodesRef, skelMeshesRef: refs.skelMeshesRef,
    restPosRef: refs.restPosRef, deformParamsRef: refs.deformParamsRef,
    worldMarkersRef: refs.worldMarkersRef, resultMeshesRef: refs.resultMeshesRef,
    animCallbackRef: refs.animCallbackRef, animTimeRef: refs.animTimeRef,
  });

  // Steps / navigation
  const stepsState = useModelImportSteps({
    sceneRef, highlightRef,
    meshMapRef: refs.meshMapRef, centerLineRef: refs.centerLineRef,
    markerMeshesRef: refs.markerMeshesRef, skelNodesRef: refs.skelNodesRef,
    skelMeshesRef: refs.skelMeshesRef, restPosRef: refs.restPosRef,
    animCallbackRef: refs.animCallbackRef, resultMeshesRef: refs.resultMeshesRef,
    modelCenter: markerState.modelCenter,
    setModelCenter: markerState.setModelCenter,
    setMarkers: markerState.setMarkers,
    setActiveMarker: markerState.setActiveMarker,
    setPlayingMotion: motion.setPlayingMotion,
    setBodyVoxels, setOtherPartVoxels,
    step, setStep,
  });

  // Generate
  const { doGenerate, generating, genStatus } = useModelImportGenerate({
    sceneRef, highlightRef,
    meshMapRef: refs.meshMapRef, centerLineRef: refs.centerLineRef,
    markerMeshesRef: refs.markerMeshesRef, deformParamsRef: refs.deformParamsRef,
    worldMarkersRef: refs.worldMarkersRef, resultMeshesRef: refs.resultMeshesRef,
    skelNodesRef: refs.skelNodesRef, skelMeshesRef: refs.skelMeshesRef, restPosRef: refs.restPosRef,
    completeMarkers: markerState.completeMarkers,
    clearResult: stepsState.clearResult,
    parts: stepsState.parts,
    setBodyVoxels, setOtherPartVoxels,
    setError: stepsState.setError,
    setStep,
  });

  // Export
  const { doExportBody, doExportSkeletal, doExportGLB, doExportSegments, doExportPart } = useModelImportExport({
    bodyVoxels, fileName: stepsState.fileName,
    deformParamsRef: refs.deformParamsRef, worldMarkersRef: refs.worldMarkersRef,
    otherPartVoxels,
  });

  // ============================================================
  // Render
  // ============================================================
  const sidebar = (
    <div style={{ background: '#0d0d14', color: '#ccc', borderRight: '1px solid #2a2a3a', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #2a2a3a' }}>
        <div style={{ fontSize: 16, fontWeight: 'bold', color: '#fff', letterSpacing: 1 }}>AUTO-RIGGER</div>
        <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
          {step === 'upload' && 'Step 1: Load 3D Model'}
          {step === 'parts' && 'Step 2: Classify Parts'}
          {step === 'markers' && 'Step 3: Place Markers'}
          {step === 'result' && 'Step 4: Result'}
        </div>
      </div>

      {step === 'upload' && (
        <UploadStep fileName={stepsState.fileName} loading={stepsState.loading} error={stepsState.error} onFileSelect={stepsState.loadModel} />
      )}
      {step === 'parts' && (
        <PartsStep
          parts={stepsState.parts} selectedPart={stepsState.selectedPart} partNames={stepsState.partNames}
          categoryCounts={stepsState.categoryCounts} hasBody={stepsState.hasBody} error={stepsState.error}
          partCategories={PART_CATEGORIES} categoryInfo={CATEGORY_INFO}
          onSelectPart={stepsState.setSelectedPart} onToggleVis={stepsState.toggleVis}
          onSetCategory={stepsState.setCat} onBack={stepsState.goBack} onNext={stepsState.goToMarkers}
        />
      )}
      {step === 'markers' && (
        <MarkersStep
          markers={markerState.markers} activeMarker={markerState.activeMarker} useSymmetry={markerState.useSymmetry}
          allMarkersPlaced={markerState.allMarkersPlaced} generating={generating}
          genStatus={genStatus} error={stepsState.error} markerGroups={MARKER_GROUPS}
          onSetActiveMarker={markerState.setActiveMarker} onClearMarker={markerState.clearMarker}
          onSetUseSymmetry={markerState.setUseSymmetry}
          onResetMarkers={() => { markerState.setMarkers({}); markerState.setActiveMarker('Chin'); }}
          onBack={stepsState.goBack} onGenerate={doGenerate}
        />
      )}
      {step === 'result' && (
        <ResultStep
          bodyVoxels={bodyVoxels} otherPartVoxels={otherPartVoxels}
          playingMotion={motion.playingMotion} loadingMotion={motion.loadingMotion}
          error={stepsState.error} motions={MOTIONS}
          onStartMotion={motion.startMotion} onStopMotion={motion.stopMotion}
          onExportSegments={doExportSegments} onExportGLB={doExportGLB}
          onExportSkeletal={doExportSkeletal} onExportBody={doExportBody}
          onExportPart={doExportPart} onBack={stepsState.goBack}
        />
      )}
    </div>
  );

  const overlay = (
    <CanvasOverlay
      step={step} activeMarker={markerState.activeMarker} dragOver={stepsState.dragOver}
      fileName={stepsState.fileName} loading={stepsState.loading} selectedPart={stepsState.selectedPart}
      parts={stepsState.parts} categoryInfo={CATEGORY_INFO}
      getMarkerColor={getMarkerColor} onDeselectPart={() => stepsState.setSelectedPart(null)}
    />
  );

  return (
    <EditorLayout
      ref={canvasRef}
      sidebar={sidebar}
      overlay={overlay}
      background="#111118"
      canvasContainerProps={{ onDragOver: stepsState.onDragOver, onDragLeave: stepsState.onDragLeave, onDrop: stepsState.onDrop }}
    />
  );
}
