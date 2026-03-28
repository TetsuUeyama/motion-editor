'use client';

import type { ReactNode } from 'react';
import CharacterViewerTemplate from '@/templates/CharacterViewerTemplate';

/** ページレベルの関心事: ヘッダー定義 */
export default function CharacterViewerView() {
  const header = (status: string, loading: boolean): ReactNode => (
    <div style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 16, borderBottom: '1px solid #333' }}>
      <a href="/" style={{ color: '#7788ff', textDecoration: 'none', fontSize: 14 }}>← Home</a>
      <h1 style={{ color: '#fff', fontSize: 18, margin: 0 }}>Character Body Viewer (Voxel)</h1>
      <span style={{ color: '#888', fontSize: 13 }}>{status}</span>
      {loading && <span style={{ color: '#fa0', fontSize: 12 }}>Processing...</span>}
    </div>
  );

  return <CharacterViewerTemplate renderHeader={header} />;
}
