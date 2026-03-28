'use client';

import type { Vec3, MarkerData } from '@/utils/voxelize/skeleton';
import type { MotionClip } from '@/utils/voxelize/core';
import type { MarkerDef, ViewDef, ViewDirection, EquipPart, PageMode, QuatConversion } from '@/utils/bone-config/constants';
import type { Mesh, TransformNode } from '@babylonjs/core';

import { SidebarHeader, ViewDirectionBar } from './SidebarHeader';
import { MarkerEditor } from './MarkerEditor';
import { BoneList } from './BoneList';
import { MotionPanel, FrameControls, EquipmentPanel } from './MotionPanel';
import { EditActions, PreviewActions } from './ActionButtons';

interface BoneConfigSidebarProps {
  // Header
  currentModel: { id: string; label: string; dir: string; bodyFile: string; partsManifest: string; bodyKey: string; gender: string };
  error: string | null;
  loading: boolean;
  onModelChange: (m: any) => void;
  // Mode
  mode: PageMode;
  // Edit mode
  viewDir: ViewDirection;
  currentViewDef: ViewDef;
  showBody: boolean;
  showBones: boolean;
  autoMirror: boolean;
  onSwitchView: (dir: ViewDirection) => void;
  onToggleBody: () => void;
  onToggleBones: () => void;
  onToggleAutoMirror: () => void;
  tab: 'markers' | 'bones';
  onSetTab: (tab: 'markers' | 'bones') => void;
  // Markers
  selectedMarker: string;
  selMarker: MarkerDef | undefined;
  selPos: Vec3 | null;
  mirrorCenterX: number;
  visibleMarkers: MarkerDef[];
  markers: MarkerData;
  onUpdateMarker: (name: string, axis: 'x' | 'y' | 'z', value: number) => void;
  onSelectMarker: (name: string) => void;
  // Bones
  calculatedBones: Record<string, Vec3>;
  // Edit actions
  onReset: () => void;
  onEnterPreview: () => void;
  // Preview - Motion
  playingMotion: string | null;
  loadingMotion: boolean;
  loadedClips: Record<string, MotionClip>;
  motionSpeed: number;
  quatConv: QuatConversion;
  showBonesOnly: boolean;
  onStartMotion: (name: string) => void;
  onStopMotion: () => void;
  onSetMotionSpeed: (v: number) => void;
  onSetQuatConv: (v: QuatConversion) => void;
  onSetShowBonesOnly: (v: boolean) => void;
  // Preview - Frame
  paused: boolean;
  currentFrame: number;
  onTogglePause: () => void;
  onPrevFrame: () => void;
  onNextFrame: () => void;
  // Preview - Equipment
  equipParts: EquipPart[];
  equipEnabled: Record<string, boolean>;
  equipLoading: boolean;
  onToggleEquip: (key: string, enabled: boolean) => void;
  onRebuildEquipment: () => void;
  // Preview - Bone list
  previewMeshes: Map<string, Mesh>;
  // Preview actions
  saving: boolean;
  onExitPreview: () => void;
  onSave: () => void;
}

export function BoneConfigSidebar(props: BoneConfigSidebarProps) {
  const { mode, tab, onSetTab, autoMirror } = props;

  return (
    <div style={{ background: '#0f0f23', color: '#ccc', borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', overflow: 'auto', height: '100%' }}>
      <SidebarHeader currentModel={props.currentModel as any} error={props.error} loading={props.loading} onModelChange={props.onModelChange} />

      {mode === 'edit' && (
        <ViewDirectionBar viewDir={props.viewDir} currentViewDef={props.currentViewDef}
          showBody={props.showBody} showBones={props.showBones} autoMirror={autoMirror}
          onSwitchView={props.onSwitchView} onToggleBody={props.onToggleBody}
          onToggleBones={props.onToggleBones} onToggleAutoMirror={props.onToggleAutoMirror} />
      )}
      {mode === 'edit' && (
        <div style={{ display: 'flex', borderBottom: '1px solid #333' }}>
          <button onClick={() => onSetTab('markers')} style={{
            flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 'bold',
            background: tab === 'markers' ? '#2a2a5e' : 'transparent', color: tab === 'markers' ? '#fff' : '#888',
            borderBottom: tab === 'markers' ? '2px solid #88f' : '2px solid transparent',
          }}>Markers ({autoMirror ? 5 : 8})</button>
          <button onClick={() => onSetTab('bones')} style={{
            flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 'bold',
            background: tab === 'bones' ? '#2a2a5e' : 'transparent', color: tab === 'bones' ? '#fff' : '#888',
            borderBottom: tab === 'bones' ? '2px solid #88f' : '2px solid transparent',
          }}>Auto Bones (41)</button>
        </div>
      )}
      {mode === 'edit' && tab === 'markers' && (
        <MarkerEditor selectedMarker={props.selectedMarker} selMarker={props.selMarker} selPos={props.selPos}
          currentViewDef={props.currentViewDef} autoMirror={autoMirror}
          mirrorCenterX={props.mirrorCenterX} visibleMarkers={props.visibleMarkers} markers={props.markers}
          onUpdateMarker={props.onUpdateMarker} onSelectMarker={props.onSelectMarker} />
      )}
      {mode === 'edit' && tab === 'bones' && <BoneList mode="edit" calculatedBones={props.calculatedBones} />}
      {mode === 'edit' && (
        <EditActions hasCalculatedBones={Object.keys(props.calculatedBones).length > 0} onReset={props.onReset} onEnterPreview={props.onEnterPreview} />
      )}

      {mode === 'preview' && (
        <>
          <MotionPanel playingMotion={props.playingMotion} loadingMotion={props.loadingMotion} loadedClips={props.loadedClips}
            motionSpeed={props.motionSpeed} quatConv={props.quatConv} showBonesOnly={props.showBonesOnly}
            onStartMotion={props.onStartMotion} onStopMotion={props.onStopMotion}
            onSetMotionSpeed={props.onSetMotionSpeed} onSetQuatConv={props.onSetQuatConv} onSetShowBonesOnly={props.onSetShowBonesOnly} />
          {props.playingMotion && (
            <FrameControls paused={props.paused} currentFrame={props.currentFrame} playingMotion={props.playingMotion}
              clip={props.loadedClips[props.playingMotion]} onTogglePause={props.onTogglePause}
              onPrevFrame={props.onPrevFrame} onNextFrame={props.onNextFrame} />
          )}
          <EquipmentPanel equipParts={props.equipParts} equipEnabled={props.equipEnabled} equipLoading={props.equipLoading}
            onToggleEquip={props.onToggleEquip} onRebuildEquipment={props.onRebuildEquipment} />
          <div style={{ padding: '6px 12px', borderBottom: '1px solid #333' }}>
            <span style={{ fontSize: 11, color: '#888' }}>
              {props.playingMotion ? 'モーション再生中 (41ボーン階層アニメーション)' : 'モーションを選択してください'}
            </span>
          </div>
          <BoneList mode="preview" previewMeshes={props.previewMeshes} />
          <PreviewActions saving={props.saving} onBack={props.onExitPreview} onSave={props.onSave} />
        </>
      )}
    </div>
  );
}
