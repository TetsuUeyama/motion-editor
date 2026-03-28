'use client';

import { Vector3 } from '@babylonjs/core';

interface MarkerGroup {
  label: string;
  color: string;
  names: string[];
}

interface MarkersStepProps {
  markers: Record<string, Vector3>;
  activeMarker: string | null;
  useSymmetry: boolean;
  allMarkersPlaced: boolean;
  generating: boolean;
  genStatus: string;
  error: string | null;
  markerGroups: readonly MarkerGroup[];
  onSetActiveMarker: (name: string) => void;
  onClearMarker: (name: string) => void;
  onSetUseSymmetry: (v: boolean) => void;
  onResetMarkers: () => void;
  onBack: () => void;
  onGenerate: () => void;
}

export function MarkersStep({
  markers, activeMarker, useSymmetry, allMarkersPlaced, generating, genStatus, error,
  markerGroups,
  onSetActiveMarker, onClearMarker, onSetUseSymmetry, onResetMarkers, onBack, onGenerate,
}: MarkersStepProps) {
  return (
    <>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #2a2a3a', fontSize: 11, color: '#777', lineHeight: 1.6 }}>
        Click a marker name, then click on the model to place it.
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {markerGroups.map(g => {
          const left = g.names[0]; const right = g.names.length > 1 ? g.names[1] : null;
          const lOk = !!markers[left]; const rOk = right ? (useSymmetry ? lOk : !!markers[right]) : true;
          return (
            <div key={g.label} style={{ padding: '8px 16px', borderBottom: '1px solid #1a1a24', background: activeMarker === left || activeMarker === right ? '#1a1a30' : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: lOk && rOk ? g.color : 'transparent', border: `2px solid ${g.color}` }} />
                <span style={{ fontWeight: 'bold', fontSize: 13, color: g.color }}>{g.label}</span>
                {lOk && rOk && <span style={{ fontSize: 10, color: '#4c4', marginLeft: 'auto' }}>OK</span>}
              </div>
              <div style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => onSetActiveMarker(left)} style={{
                    padding: '3px 8px', borderRadius: 3, fontSize: 11, minWidth: 80, textAlign: 'left', cursor: 'pointer',
                    background: activeMarker === left ? g.color + '33' : lOk ? '#1a2a1a' : '#1a1a2a',
                    color: activeMarker === left ? g.color : lOk ? '#8a8' : '#888',
                    border: activeMarker === left ? `2px solid ${g.color}` : '1px solid #333',
                  }}>{right ? 'Left' : left}{lOk && ' \u2713'}</button>
                  {lOk && <button onClick={() => onClearMarker(left)} style={{ padding: '1px 5px', fontSize: 9, background: '#2a1a1a', color: '#a66', border: '1px solid #3a2a2a', borderRadius: 3, cursor: 'pointer' }}>x</button>}
                </div>
                {right && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button onClick={() => !useSymmetry && onSetActiveMarker(right)} style={{
                      padding: '3px 8px', borderRadius: 3, fontSize: 11, minWidth: 80, textAlign: 'left',
                      cursor: useSymmetry ? 'default' : 'pointer', opacity: useSymmetry ? 0.5 : 1,
                      background: rOk ? '#1a2a1a' : '#1a1a2a', color: rOk ? '#686' : '#555', border: '1px solid #333',
                    }}>Right{rOk && ' \u2713'}{useSymmetry && rOk && ' (mirror)'}</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ padding: '12px 16px', borderTop: '1px solid #2a2a3a', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={useSymmetry} onChange={e => onSetUseSymmetry(e.target.checked)} /> Use Symmetry
        </label>
        <button onClick={onResetMarkers} style={{ padding: '5px', borderRadius: 4, fontSize: 11, background: '#1a1a2a', color: '#888', border: '1px solid #333', cursor: 'pointer' }}>Reset All</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onBack} style={{ flex: 1, padding: '8px', borderRadius: 4, background: '#1a1a2a', color: '#888', border: '1px solid #333', cursor: 'pointer', fontSize: 12 }}>BACK</button>
          <button onClick={onGenerate} disabled={!allMarkersPlaced || generating} style={{
            flex: 2, padding: '8px', borderRadius: 4, fontSize: 14, fontWeight: 'bold',
            background: allMarkersPlaced ? '#e65100' : '#333', color: allMarkersPlaced ? '#fff' : '#666', border: 'none', cursor: allMarkersPlaced && !generating ? 'pointer' : 'default',
          }}>{generating ? genStatus || 'Generating...' : 'GENERATE'}</button>
        </div>
        {error && <div style={{ fontSize: 10, color: '#f66' }}>{error}</div>}
      </div>
    </>
  );
}
