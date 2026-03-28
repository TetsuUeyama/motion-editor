'use client';

import type { VoxelEntry } from '@/utils/auto-rigger';

interface Motion {
  name: string;
  label: string;
}

interface ResultStepProps {
  bodyVoxels: VoxelEntry[];
  otherPartVoxels: Record<string, VoxelEntry[]>;
  playingMotion: string | null;
  loadingMotion: boolean;
  error: string | null;
  motions: readonly Motion[];
  onStartMotion: (name: string) => void;
  onStopMotion: () => void;
  onExportSegments: () => void;
  onExportGLB: () => void;
  onExportSkeletal: () => void;
  onExportBody: () => void;
  onExportPart: (name: string) => void;
  onBack: () => void;
}

export function ResultStep({
  bodyVoxels, otherPartVoxels, playingMotion, loadingMotion, error,
  motions,
  onStartMotion, onStopMotion,
  onExportSegments, onExportGLB, onExportSkeletal, onExportBody, onExportPart,
  onBack,
}: ResultStepProps) {
  return (
    <>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a3a' }}>
        <div style={{ fontSize: 13, color: '#4c4', fontWeight: 'bold' }}>Complete</div>
        <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{bodyVoxels.length} body voxels / 41 bones</div>
      </div>

      {/* Motion test */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #2a2a3a' }}>
        <div style={{ fontSize: 12, color: '#aaa', fontWeight: 'bold', marginBottom: 6 }}>Motion Test</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {motions.map(m => (
            <button key={m.name} onClick={() => playingMotion === m.name ? onStopMotion() : onStartMotion(m.name)} disabled={loadingMotion} style={{
              padding: '5px 8px', borderRadius: 3, fontSize: 11, textAlign: 'left', cursor: 'pointer',
              background: playingMotion === m.name ? '#2a3a1a' : '#1a1a2a',
              color: playingMotion === m.name ? '#8c4' : '#888',
              border: playingMotion === m.name ? '1px solid #4a5a3a' : '1px solid #2a2a3a',
            }}>{playingMotion === m.name ? '\u25A0 ' : '\u25B6 '}{m.label}</button>
          ))}
        </div>
      </div>

      {/* Other parts */}
      {Object.keys(otherPartVoxels).length > 0 && (
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #2a2a3a' }}>
          <div style={{ fontSize: 12, color: '#aaa', fontWeight: 'bold', marginBottom: 6 }}>Other Parts</div>
          {Object.entries(otherPartVoxels).map(([name, vox]) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
              <span style={{ fontSize: 11, flex: 1, color: '#888' }}>{name}</span>
              <span style={{ fontSize: 9, color: '#666' }}>{vox.length}v</span>
              <button onClick={() => onExportPart(name)} style={{ padding: '2px 8px', fontSize: 10, background: '#1a2a44', color: '#6af', border: '1px solid #3a5a8a', borderRadius: 3, cursor: 'pointer' }}>.vox</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ flex: 1 }} />
      <div style={{ padding: '12px 16px', borderTop: '1px solid #2a2a3a', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button onClick={onExportSegments} style={{ padding: '10px', borderRadius: 4, fontSize: 13, fontWeight: 'bold', background: '#1a3a1a', color: '#6f6', border: '1px solid #3a8a3a', cursor: 'pointer' }}>Export Segments (ボーン分離)</button>
        <button onClick={onExportGLB} style={{ padding: '10px', borderRadius: 4, fontSize: 13, fontWeight: 'bold', background: '#2a3a1a', color: '#af6', border: '1px solid #5a7a3a', cursor: 'pointer' }}>Export Skinned .glb</button>
        <button onClick={onExportSkeletal} style={{ padding: '10px', borderRadius: 4, fontSize: 13, fontWeight: 'bold', background: '#2a1a44', color: '#a6f', border: '1px solid #5a3a8a', cursor: 'pointer' }}>Export Skeletal .json</button>
        <button onClick={onExportBody} style={{ padding: '10px', borderRadius: 4, fontSize: 13, fontWeight: 'bold', background: '#1a2a44', color: '#6af', border: '1px solid #3a5a8a', cursor: 'pointer' }}>Export Body .vox</button>
        <button onClick={onBack} style={{ padding: '8px', borderRadius: 4, fontSize: 12, background: '#1a1a2a', color: '#888', border: '1px solid #333', cursor: 'pointer' }}>BACK</button>
        {error && <div style={{ fontSize: 10, color: '#f66' }}>{error}</div>}
      </div>
    </>
  );
}
