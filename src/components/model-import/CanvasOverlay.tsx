'use client';

import type { Step, PartConfig } from '@/utils/model-import/types';

interface CategoryInfo {
  color: string;
  labelJa: string;
}

interface CanvasOverlayProps {
  step: Step;
  activeMarker: string | null;
  dragOver: boolean;
  fileName: string | null;
  loading: boolean;
  selectedPart: string | null;
  parts: Record<string, PartConfig>;
  categoryInfo: Record<string, CategoryInfo>;
  getMarkerColor: (name: string) => string;
  onDeselectPart: () => void;
}

export function CanvasOverlay({
  step, activeMarker, dragOver, fileName, loading, selectedPart, parts,
  categoryInfo, getMarkerColor, onDeselectPart,
}: CanvasOverlayProps) {
  return (
    <>
      {dragOver && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(40,80,160,0.3)', border: '3px dashed #48f', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ fontSize: 24, color: '#8cf', fontWeight: 'bold' }}>Drop model file here</div>
        </div>
      )}
      {step === 'upload' && !fileName && !loading && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ fontSize: 48, color: '#333', marginBottom: 16 }}>+</div>
          <div style={{ fontSize: 16, color: '#555' }}>Drag & drop a 3D model</div>
          <div style={{ fontSize: 12, color: '#444', marginTop: 8 }}>.glb / .gltf / .obj</div>
        </div>
      )}
      {step === 'markers' && activeMarker && (
        <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.8)', padding: '8px 16px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: getMarkerColor(activeMarker) }} />
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>Click to place: {activeMarker}</span>
        </div>
      )}
      {/* Selected part info */}
      {step === 'parts' && selectedPart && parts[selectedPart] && (
        <div style={{ position: 'absolute', bottom: 16, left: 16, right: 16, background: 'rgba(15,15,35,0.9)', border: '1px solid #333', borderRadius: 8, padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, display: 'inline-block', background: categoryInfo[parts[selectedPart].category].color }} />
            <span style={{ fontSize: 13, fontWeight: 'bold', color: '#ccc' }}>{selectedPart}</span>
            <span style={{ fontSize: 11, color: '#888' }}>{categoryInfo[parts[selectedPart].category].labelJa}</span>
            <span style={{ fontSize: 10, color: '#666' }}>{parts[selectedPart].vertexCount} verts</span>
            <button onClick={onDeselectPart} style={{ marginLeft: 'auto', padding: '2px 8px', border: '1px solid #555', borderRadius: 3, background: '#2a2a3a', color: '#888', cursor: 'pointer', fontSize: 11 }}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
