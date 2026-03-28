'use client';

import { VIEW_DEFS, type ViewDirection, type ViewDef } from '@/utils/bone-config/constants';

interface ViewDirectionBarProps {
  viewDir: ViewDirection;
  currentViewDef: ViewDef;
  showBody: boolean;
  showBones: boolean;
  autoMirror: boolean;
  onSwitchView: (dir: ViewDirection) => void;
  onToggleBody: () => void;
  onToggleBones: () => void;
  onToggleAutoMirror: () => void;
}

export function ViewDirectionBar({
  viewDir, currentViewDef, showBody, showBones, autoMirror,
  onSwitchView, onToggleBody, onToggleBones, onToggleAutoMirror,
}: ViewDirectionBarProps) {
  return (
    <>
      {/* View direction buttons */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #333' }}>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>View Direction</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {VIEW_DEFS.map(vDef => {
            const active = viewDir === vDef.key;
            return (
              <button
                key={vDef.key}
                onClick={() => onSwitchView(vDef.key)}
                style={{
                  flex: 1, padding: '6px 0', border: 'none', borderRadius: 4, cursor: 'pointer',
                  fontSize: 12, fontWeight: 'bold',
                  background: active ? '#3a3a8e' : '#1a1a3e',
                  color: active ? '#fff' : '#888',
                  outline: active ? '2px solid #66f' : '1px solid #333',
                }}
              >{vDef.label}</button>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>
          ドラッグ軸: {currentViewDef.axisLabels}
        </div>
      </div>

      {/* Toggles */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #333', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={showBody} onChange={onToggleBody} />
          Body
        </label>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={showBones} onChange={onToggleBones} />
          Bones
        </label>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={autoMirror} onChange={onToggleAutoMirror} />
          <span style={{ color: autoMirror ? '#88f' : '#888' }}>左右対称</span>
        </label>
      </div>

      {/* Tabs header is handled by the parent since it controls which tab content shows */}
    </>
  );
}
