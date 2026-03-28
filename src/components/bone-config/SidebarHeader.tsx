'use client';

import Link from 'next/link';
import type { ModelEntry } from '@/utils/model-registry';
import { MODEL_REGISTRY } from '@/utils/model-registry';

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
