'use client';

interface EditActionsProps {
  hasCalculatedBones: boolean;
  onReset: () => void;
  onEnterPreview: () => void;
}

export function EditActions({ hasCalculatedBones, onReset, onEnterPreview }: EditActionsProps) {
  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #333', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button onClick={onReset} style={{
        padding: '6px 0', borderRadius: 4, cursor: 'pointer',
        background: '#3a2a2a', color: '#ccc', border: '1px solid #555', fontSize: 11,
      }}>Reset to Defaults</button>
      <button
        onClick={onEnterPreview}
        disabled={!hasCalculatedBones}
        style={{
          padding: '10px 0', borderRadius: 4, cursor: 'pointer',
          background: '#3a5a8a', color: '#fff',
          border: '2px solid #5588cc', fontSize: 13, fontWeight: 'bold',
        }}
      >
        決定 → プレビュー
      </button>
    </div>
  );
}
