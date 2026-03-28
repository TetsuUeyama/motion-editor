'use client';

import type { Vector3 } from '@babylonjs/core';
import type { VoxelEntry, PartCategory } from '@/utils/auto-rigger';
import type { Step, PartConfig } from '@/utils/model-import/constants';
import type { MarkerGroup } from '@/utils/auto-rigger/constants';

import { UploadStep } from './UploadStep';
import { PartsStep } from './PartsStep';
import { MarkersStep } from './MarkersStep';
import { ResultStep } from './ResultStep';

interface ModelImportSidebarProps {
  step: Step;
  title?: string;
  // Upload
  fileName: string | null;
  loading: boolean;
  error: string | null;
  onFileSelect: (file: File) => void;
  // Parts
  parts: Record<string, PartConfig>;
  selectedPart: string | null;
  partNames: string[];
  categoryCounts: Record<string, number>;
  hasBody: boolean;
  partCategories: PartCategory[];
  categoryInfo: Record<string, { label: string; labelJa: string; color: string }>;
  onSelectPart: (name: string | null) => void;
  onToggleVis: (name: string) => void;
  onSetCategory: (name: string, cat: PartCategory) => void;
  onBack: () => void;
  onNext: () => void;
  // Markers
  markers: Record<string, Vector3>;
  activeMarker: string | null;
  useSymmetry: boolean;
  allMarkersPlaced: boolean;
  generating: boolean;
  genStatus: string;
  markerGroups: MarkerGroup[];
  onSetActiveMarker: (name: string | null) => void;
  onClearMarker: (name: string) => void;
  onSetUseSymmetry: (v: boolean) => void;
  onResetMarkers: () => void;
  onGenerate: () => void;
  // Result
  bodyVoxels: VoxelEntry[];
  otherPartVoxels: Record<string, VoxelEntry[]>;
  playingMotion: string | null;
  loadingMotion: boolean;
  motions: { name: string; label: string }[];
  onStartMotion: (name: string) => void;
  onStopMotion: () => void;
  onExportSegments: () => void;
  onExportGLB: () => void;
  onExportSkeletal: () => void;
  onExportBody: () => void;
  onExportPart: (name: string) => void;
}

export function ModelImportSidebar(props: ModelImportSidebarProps) {
  const { step } = props;

  return (
    <div style={{ background: '#0d0d14', color: '#ccc', borderRight: '1px solid #2a2a3a', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #2a2a3a' }}>
        <div style={{ fontSize: 16, fontWeight: 'bold', color: '#fff', letterSpacing: 1 }}>{props.title ?? 'AUTO-RIGGER'}</div>
        <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
          {step === 'upload' && 'Step 1: Load 3D Model'}
          {step === 'parts' && 'Step 2: Classify Parts'}
          {step === 'markers' && 'Step 3: Place Markers'}
          {step === 'result' && 'Step 4: Result'}
        </div>
      </div>

      {step === 'upload' && (
        <UploadStep fileName={props.fileName} loading={props.loading} error={props.error} onFileSelect={props.onFileSelect} />
      )}
      {step === 'parts' && (
        <PartsStep
          parts={props.parts} selectedPart={props.selectedPart} partNames={props.partNames}
          categoryCounts={props.categoryCounts} hasBody={props.hasBody} error={props.error}
          partCategories={props.partCategories} categoryInfo={props.categoryInfo}
          onSelectPart={props.onSelectPart} onToggleVis={props.onToggleVis}
          onSetCategory={props.onSetCategory} onBack={props.onBack} onNext={props.onNext}
        />
      )}
      {step === 'markers' && (
        <MarkersStep
          markers={props.markers} activeMarker={props.activeMarker} useSymmetry={props.useSymmetry}
          allMarkersPlaced={props.allMarkersPlaced} generating={props.generating}
          genStatus={props.genStatus} error={props.error} markerGroups={props.markerGroups}
          onSetActiveMarker={props.onSetActiveMarker} onClearMarker={props.onClearMarker}
          onSetUseSymmetry={props.onSetUseSymmetry} onResetMarkers={props.onResetMarkers}
          onBack={props.onBack} onGenerate={props.onGenerate}
        />
      )}
      {step === 'result' && (
        <ResultStep
          bodyVoxels={props.bodyVoxels} otherPartVoxels={props.otherPartVoxels}
          playingMotion={props.playingMotion} loadingMotion={props.loadingMotion}
          error={props.error} motions={props.motions}
          onStartMotion={props.onStartMotion} onStopMotion={props.onStopMotion}
          onExportSegments={props.onExportSegments} onExportGLB={props.onExportGLB}
          onExportSkeletal={props.onExportSkeletal} onExportBody={props.onExportBody}
          onExportPart={props.onExportPart} onBack={props.onBack}
        />
      )}
    </div>
  );
}
