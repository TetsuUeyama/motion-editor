'use client';

import type { PartConfig } from '@/utils/model-import/types';
import type { PartCategory } from '@/utils/auto-rigger';

interface CategoryInfo {
  color: string;
  labelJa: string;
}

interface PartsStepProps {
  parts: Record<string, PartConfig>;
  selectedPart: string | null;
  partNames: string[];
  categoryCounts: Record<string, number>;
  hasBody: boolean;
  error: string | null;
  partCategories: readonly PartCategory[];
  categoryInfo: Record<string, CategoryInfo>;
  onSelectPart: (name: string) => void;
  onToggleVis: (name: string) => void;
  onSetCategory: (name: string, cat: PartCategory) => void;
  onBack: () => void;
  onNext: () => void;
}

export function PartsStep({
  parts, selectedPart, partNames, categoryCounts, hasBody,
  partCategories, categoryInfo,
  onSelectPart, onToggleVis, onSetCategory, onBack, onNext,
}: PartsStepProps) {
  return (
    <>
      {/* Instructions */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #2a2a3a', background: '#0f1018' }}>
        <div style={{ fontSize: 11, color: '#aaa', lineHeight: 1.6 }}>
          各パーツのカテゴリを設定してください。<br />
          3Dビューのパーツをクリックで選択できます。
        </div>
      </div>

      {/* Category summary */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #2a2a3a', display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {partCategories.filter(c => categoryCounts[c]).map(c => (
          <span key={c} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 3, background: categoryInfo[c].color + '22', color: categoryInfo[c].color, border: `1px solid ${categoryInfo[c].color}44` }}>
            {categoryInfo[c].labelJa} ({categoryCounts[c]})
          </span>
        ))}
      </div>

      {/* Part list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {partNames.map(name => {
          const p = parts[name]; const ci = categoryInfo[p.category];
          const isSel = selectedPart === name;
          return (
            <div key={name} onClick={() => onSelectPart(name)} style={{
              padding: '10px 12px', borderBottom: '1px solid #1a1a22', cursor: 'pointer',
              background: isSel ? '#1a2a3a' : 'transparent', opacity: p.visible ? 1 : 0.4,
            }}>
              {/* Name row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <button onClick={e => { e.stopPropagation(); onToggleVis(name); }} style={{
                  width: 20, height: 20, border: 'none', borderRadius: 3, background: p.visible ? '#3a3a4a' : '#222',
                  color: p.visible ? '#aaa' : '#555', cursor: 'pointer', fontSize: 12, lineHeight: '20px', padding: 0,
                }}>{p.visible ? '\u25C9' : '\u25CB'}</button>
                <span style={{ fontSize: 12, fontWeight: isSel ? 'bold' : 'normal', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                <span style={{ fontSize: 9, color: '#666' }}>{p.vertexCount}v</span>
              </div>
              {/* Category buttons */}
              <div style={{ display: 'flex', gap: 4, paddingLeft: 26 }} onClick={e => e.stopPropagation()}>
                {partCategories.map(c => {
                  const info = categoryInfo[c];
                  const isActive = p.category === c;
                  return (
                    <button key={c} onClick={() => onSetCategory(name, c)} style={{
                      flex: 1, padding: '4px 2px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
                      background: isActive ? info.color + '44' : '#1a1a22',
                      color: isActive ? info.color : '#666',
                      border: isActive ? `2px solid ${info.color}` : '1px solid #2a2a3a',
                      fontWeight: isActive ? 'bold' : 'normal',
                    }}>
                      {info.labelJa}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #2a2a3a', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!hasBody && (
          <div style={{ fontSize: 11, color: '#f86', padding: '8px 10px', background: '#2a1a1a', borderRadius: 4, lineHeight: 1.5 }}>
            少なくとも1つのパーツを「ボディ」に設定してください
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onBack} style={{ flex: 1, padding: '8px', borderRadius: 4, background: '#1a1a2a', color: '#888', border: '1px solid #333', cursor: 'pointer', fontSize: 12 }}>BACK</button>
          <button onClick={onNext} disabled={!hasBody} style={{
            flex: 2, padding: '8px', borderRadius: 4, fontSize: 14, fontWeight: 'bold',
            background: hasBody ? '#e65100' : '#333', color: hasBody ? '#fff' : '#666', border: 'none', cursor: hasBody ? 'pointer' : 'default',
          }}>NEXT: Markers</button>
        </div>
      </div>
    </>
  );
}
