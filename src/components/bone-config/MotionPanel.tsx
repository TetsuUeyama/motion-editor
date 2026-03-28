'use client';

import { MOTION_FILES, QUAT_CONVERSIONS, type QuatConversion, type EquipPart } from '@/utils/bone-config/constants';
import type { MotionClip } from '@/utils/voxel-skeleton';

// ============================================================
// MotionPanel
// ============================================================

interface MotionPanelProps {
  playingMotion: string | null;
  loadingMotion: boolean;
  loadedClips: Record<string, any>;
  motionSpeed: number;
  quatConv: QuatConversion;
  showBonesOnly: boolean;
  onStartMotion: (name: string) => void;
  onStopMotion: () => void;
  onSetMotionSpeed: (speed: number) => void;
  onSetQuatConv: (conv: QuatConversion) => void;
  onSetShowBonesOnly: (value: boolean) => void;
}

export function MotionPanel({
  playingMotion, loadingMotion, loadedClips, motionSpeed, quatConv, showBonesOnly,
  onStartMotion, onStopMotion, onSetMotionSpeed, onSetQuatConv, onSetShowBonesOnly,
}: MotionPanelProps) {
  return (
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
              onClick={() => isActive ? onStopMotion() : onStartMotion(motion.name)}
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
          onChange={e => onSetMotionSpeed(Number(e.target.value))}
          style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: '#888', width: 30, textAlign: 'right' }}>{motionSpeed.toFixed(1)}x</span>
      </div>
      {/* Quaternion conversion formula selector */}
      <div style={{ marginTop: 6 }}>
        <span style={{ fontSize: 11, color: '#888' }}>Quat Conv:</span>
        <select
          value={quatConv}
          onChange={e => onSetQuatConv(e.target.value as QuatConversion)}
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
          onChange={e => onSetShowBonesOnly(e.target.checked)}
        />
        <span style={{ fontSize: 11, color: '#ff8' }}>Bones Only (dp positions)</span>
      </label>
    </div>
  );
}

// ============================================================
// FrameControls
// ============================================================

interface FrameControlsProps {
  paused: boolean;
  currentFrame: number;
  playingMotion: string;
  clip: MotionClip | undefined;
  onTogglePause: () => void;
  onPrevFrame: () => void;
  onNextFrame: () => void;
}

export function FrameControls({
  paused, currentFrame, playingMotion, clip,
  onTogglePause, onPrevFrame, onNextFrame,
}: FrameControlsProps) {
  return (
    <div style={{ padding: '6px 12px', borderBottom: '1px solid #333' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          onClick={onTogglePause}
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
              onClick={onPrevFrame}
              style={{ padding: '2px 6px', fontSize: 11, cursor: 'pointer', background: '#333', color: '#ccc', border: '1px solid #555', borderRadius: 3 }}
            >◀</button>
            <button
              onClick={onNextFrame}
              style={{ padding: '2px 6px', fontSize: 11, cursor: 'pointer', background: '#333', color: '#ccc', border: '1px solid #555', borderRadius: 3 }}
            >▶</button>
          </>
        )}
        <span style={{ fontSize: 11, color: '#aaa' }}>
          Frame: {currentFrame} / {clip?.frameCount ?? '?'}
        </span>
      </div>
    </div>
  );
}

// ============================================================
// EquipmentPanel
// ============================================================

interface EquipmentPanelProps {
  equipParts: EquipPart[];
  equipEnabled: Record<string, boolean>;
  equipLoading: boolean;
  onToggleEquip: (key: string, enabled: boolean) => void;
  onRebuildEquipment: () => void;
}

export function EquipmentPanel({
  equipParts, equipEnabled, equipLoading,
  onToggleEquip, onRebuildEquipment,
}: EquipmentPanelProps) {
  if (equipParts.length === 0) return null;

  return (
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
                onToggleEquip(part.key, e.target.checked);
              }}
            />
            <span style={{ color: equipEnabled[part.key] ? '#ccc' : '#666' }}>{part.key}</span>
            <span style={{ fontSize: 9, color: '#555' }}>({part.voxels})</span>
          </label>
        ))}
      </div>
      <button
        onClick={onRebuildEquipment}
        style={{
          marginTop: 6, padding: '4px 0', width: '100%', borderRadius: 3, cursor: 'pointer',
          background: '#2a3a5e', color: '#aaf', border: '1px solid #446', fontSize: 11,
        }}
      >
        装備を反映
      </button>
    </div>
  );
}
