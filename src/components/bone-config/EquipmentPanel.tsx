'use client';

import type { EquipPart } from '@/utils/bone-config/constants';

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
