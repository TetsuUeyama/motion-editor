'use client';

import type { ViewDef, PageMode } from '@/utils/bone-config/constants';
import { MOTION_FILES, r1 } from '@/utils/bone-config/constants';

interface CanvasOverlayProps {
  mode: PageMode;
  currentViewDef: ViewDef;
  dirty: boolean;
  autoMirror: boolean;
  mirrorCenterX: number;
  playingMotion: string | null;
}

export function CanvasOverlay({
  mode, currentViewDef, dirty, autoMirror, mirrorCenterX, playingMotion,
}: CanvasOverlayProps) {
  if (mode === 'edit') {
    return (
      <>
        <div style={{
          position: 'absolute', top: 12, left: 12, padding: '6px 14px',
          background: 'rgba(50, 50, 140, 0.8)', borderRadius: 6, fontSize: 14, color: '#fff', fontWeight: 'bold',
        }}>
          {currentViewDef.label}
        </div>

        {dirty && (
          <div style={{
            position: 'absolute', top: 12, right: 12, padding: '4px 10px',
            background: 'rgba(255, 130, 50, 0.8)', borderRadius: 4, fontSize: 12, color: '#fff',
          }}>Unsaved changes</div>
        )}

        <div style={{
          position: 'absolute', bottom: 12, left: 12, padding: '8px 12px',
          background: 'rgba(0, 0, 0, 0.6)', borderRadius: 6, fontSize: 11, color: '#aaa',
        }}>
          <div>● マーカーをドラッグして配置</div>
          <div>マウスホイールでズーム</div>
          <div style={{ marginTop: 4, color: '#666' }}>
            {autoMirror
              ? `左右対称 ON (center: X=${r1(mirrorCenterX)})`
              : '左右対称 OFF (左右独立)'}
          </div>
        </div>
      </>
    );
  }

  // preview mode
  return (
    <>
      <div style={{
        position: 'absolute', top: 12, left: 12, padding: '6px 14px',
        background: 'rgba(80, 140, 50, 0.8)', borderRadius: 6, fontSize: 14, color: '#fff', fontWeight: 'bold',
      }}>
        Split Preview
        {playingMotion && (
          <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.8 }}>
            {MOTION_FILES.find(p => p.name === playingMotion)?.label}
          </span>
        )}
      </div>
      <div style={{
        position: 'absolute', bottom: 12, left: 12, padding: '8px 12px',
        background: 'rgba(0, 0, 0, 0.6)', borderRadius: 6, fontSize: 11, color: '#aaa',
      }}>
        <div>マウスドラッグで回転、ホイールでズーム</div>
        <div style={{ marginTop: 4, color: '#888' }}>問題なければ「保存」、修正は「戻る」</div>
      </div>
    </>
  );
}
