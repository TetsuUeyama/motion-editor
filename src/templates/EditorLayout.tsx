'use client';

import { forwardRef, type ReactNode } from 'react';

interface EditorLayoutProps {
  /** サイドバーの内容 */
  sidebar: ReactNode;
  /** サイドバー幅 (px) デフォルト 320 */
  sidebarWidth?: number;
  /** キャンバス上のオーバーレイ */
  overlay?: ReactNode;
  /** キャンバス領域のイベント (drag & drop等) */
  canvasContainerProps?: React.HTMLAttributes<HTMLDivElement>;
  /** 背景色 デフォルト #1a1a2e */
  background?: string;
  /** ヘッダー (任意) */
  header?: ReactNode;
}

/**
 * エディター共通テンプレート
 * サイドバー + Babylon.jsキャンバスの2カラムレイアウト
 */
const EditorLayout = forwardRef<HTMLCanvasElement, EditorLayoutProps>(
  function EditorLayout(
    {
      sidebar,
      sidebarWidth = 320,
      overlay,
      canvasContainerProps,
      background = '#1a1a2e',
      header,
    },
    canvasRef,
  ) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background, fontFamily: 'system-ui, sans-serif' }}>
        {header}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ width: sidebarWidth, minWidth: sidebarWidth, display: 'flex', flexDirection: 'column' }}>
            {sidebar}
          </div>
          <div style={{ flex: 1, position: 'relative' }} {...canvasContainerProps}>
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', outline: 'none' }} />
            {overlay}
          </div>
        </div>
      </div>
    );
  },
);

export default EditorLayout;
