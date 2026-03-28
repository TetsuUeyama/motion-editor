'use client';

import Link from 'next/link';
import type { ModelEntry } from '@/utils/model-registry';
import { MODEL_REGISTRY } from '@/utils/model-registry';
import { VIEW_DEFS, type ViewDirection, type ViewDef } from '@/utils/bone-config/constants';

// ============================================================
// SidebarHeader
// ============================================================

interface SidebarHeaderProps {
  currentModel: ModelEntry;
  error: string | null;
  loading: boolean;
  onModelChange: (model: ModelEntry) => void;
}

export function SidebarHeader({ currentModel, error, loading, onModelChange }: SidebarHeaderProps) {
  return (
    <>
      <div style={{ padding: '12px', borderBottom: '1px solid #333' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontWeight: 'bold', fontSize: 16 }}>Bone Config</span>
          <Link href="/" style={{ color: '#888', fontSize: 11, textDecoration: 'none' }}>Top</Link>
        </div>
        <div style={{ fontSize: 11, color: '#888', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>Model:</span>
          <select
            value={currentModel.id}
            onChange={e => {
              const m = MODEL_REGISTRY.find(r => r.id === e.target.value);
              if (m && m.id !== currentModel.id) {
                onModelChange(m);
              }
            }}
            style={{
              fontSize: 11, background: '#1a1a2e', color: '#aaf',
              border: '1px solid #444', borderRadius: 3, padding: '2px 6px',
              cursor: 'pointer',
            }}
          >
            {MODEL_REGISTRY.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <div style={{ padding: 12, color: '#f88', fontSize: 12 }}>Error: {error}</div>}
      {loading && <div style={{ padding: 12, color: '#88f', fontSize: 12 }}>Loading...</div>}
    </>
  );
}

// ============================================================
// ViewDirectionBar
// ============================================================

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
