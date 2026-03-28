'use client';

import type { MotionClip } from '@/utils/voxel-skeleton';

interface FrameControlsProps {
  paused: boolean;
  currentFrame: number;
  playingMotion: string;
  clip: MotionClip | undefined;
  onTogglePause: () => void;
  onPrevFrame: () => void;
  onNextFrame: () => void;
}

export function FrameControls({
  paused, currentFrame, playingMotion, clip,
  onTogglePause, onPrevFrame, onNextFrame,
}: FrameControlsProps) {
  return (
    <div style={{ padding: '6px 12px', borderBottom: '1px solid #333' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          onClick={onTogglePause}
          style={{
            padding: '2px 8px', fontSize: 11, cursor: 'pointer',
            background: paused ? '#664400' : '#333', color: '#ccc',
            border: '1px solid #555', borderRadius: 3,
          }}
        >
          {paused ? '▶ Play' : '⏸ Pause'}
        </button>
        {paused && (
          <>
            <button
              onClick={onPrevFrame}
              style={{ padding: '2px 6px', fontSize: 11, cursor: 'pointer', background: '#333', color: '#ccc', border: '1px solid #555', borderRadius: 3 }}
            >◀</button>
            <button
              onClick={onNextFrame}
              style={{ padding: '2px 6px', fontSize: 11, cursor: 'pointer', background: '#333', color: '#ccc', border: '1px solid #555', borderRadius: 3 }}
            >▶</button>
          </>
        )}
        <span style={{ fontSize: 11, color: '#aaa' }}>
          Frame: {currentFrame} / {clip?.frameCount ?? '?'}
        </span>
      </div>
    </div>
  );
}
