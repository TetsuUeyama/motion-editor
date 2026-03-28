'use client';

import type { MarkerDef, ViewDef } from '@/utils/bone-config/constants';
import { r1 } from '@/utils/bone-config/constants';
import type { MarkerData, Vec3 } from '@/utils/voxelize/skeleton';

interface MarkerEditorProps {
  selectedMarker: string;
  selMarker: MarkerDef | undefined;
  selPos: Vec3 | null;
  currentViewDef: ViewDef;
  autoMirror: boolean;
  mirrorCenterX: number;
  visibleMarkers: MarkerDef[];
  markers: MarkerData;
  onUpdateMarker: (markerName: string, axis: 'x' | 'y' | 'z', value: number) => void;
  onSelectMarker: (name: string) => void;
}

export function MarkerEditor({
  selectedMarker, selMarker, selPos, currentViewDef, autoMirror, mirrorCenterX,
  visibleMarkers, markers, onUpdateMarker, onSelectMarker,
}: MarkerEditorProps) {
  return (
    <>
      {selMarker && selPos && (
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #333', background: '#11112a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ width: 14, height: 14, borderRadius: '50%', background: selMarker.color, display: 'inline-block', border: '2px solid #fff' }} />
            <span style={{ fontWeight: 'bold', fontSize: 14 }}>{selMarker.label}</span>
            {selMarker.side === 'left' && autoMirror && (
              <span style={{ fontSize: 10, color: '#88f', background: '#1a1a4e', padding: '1px 6px', borderRadius: 8 }}>L/R auto</span>
            )}
          </div>

          {(['x', 'y', 'z'] as const).map(axis => {
            const max = axis === 'x' ? 85 : axis === 'y' ? 34 : 103;
            const labels = { x: 'X (左右)', y: 'Y (前後)', z: 'Z (高さ)' };
            const isDragAxis = currentViewDef.dragAxes.includes(axis);
            return (
              <div key={axis} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 70, fontSize: 11, color: isDragAxis ? '#ddd' : '#666' }}>
                    {labels[axis]}
                  </span>
                  <input type="range" min={0} max={max} step={0.5}
                    value={selPos[axis]}
                    onChange={e => onUpdateMarker(selectedMarker, axis, Number(e.target.value))}
                    style={{ flex: 1 }} />
                  <input type="number" min={0} max={max} step={0.5}
                    value={selPos[axis]}
                    onChange={e => onUpdateMarker(selectedMarker, axis, Number(e.target.value))}
                    style={{
                      width: 50, fontSize: 11, background: '#1a1a3e', color: '#ccc',
                      border: '1px solid #444', borderRadius: 3, padding: '2px 4px', textAlign: 'right',
                    }} />
                </div>
              </div>
            );
          })}

          {autoMirror && selMarker.side === 'left' && (
            <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
              Right auto: X={r1(mirrorCenterX + (mirrorCenterX - selPos.x))}
              {' '}(center: {r1(mirrorCenterX)})
            </div>
          )}
          {(selMarker.name === 'Chin' || selMarker.name === 'Groin') && autoMirror && (
            <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
              Mirror center X: {r1(mirrorCenterX)} (Chin+Groin)/2
            </div>
          )}
        </div>
      )}

      {/* Marker list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ padding: '6px 12px', fontSize: 11, color: '#888', borderBottom: '1px solid #222' }}>
          マーカー一覧 (ドラッグ / クリックで選択)
        </div>
        {visibleMarkers.map(mDef => {
          const isSelected = mDef.name === selectedMarker;
          const pos = markers[mDef.name];
          return (
            <div
              key={mDef.name}
              onClick={() => onSelectMarker(mDef.name)}
              style={{
                padding: '8px 12px', cursor: 'pointer', fontSize: 12,
                background: isSelected ? '#2a2a5e' : 'transparent',
                borderLeft: isSelected ? `3px solid ${mDef.color}` : '3px solid transparent',
                color: isSelected ? '#fff' : '#aaa',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span style={{
                width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
                background: mDef.color, display: 'inline-block',
                border: isSelected ? '2px solid #fff' : '1px solid #666',
              }} />
              <span style={{ flex: 1 }}>{mDef.label}</span>
              {pos && (
                <span style={{ fontSize: 10, color: '#666' }}>
                  ({r1(pos.x)}, {r1(pos.y)}, {r1(pos.z)})
                </span>
              )}
              {autoMirror && mDef.side === 'left' && <span style={{ fontSize: 9, color: '#558' }}>L/R</span>}
            </div>
          );
        })}
      </div>
    </>
  );
}
