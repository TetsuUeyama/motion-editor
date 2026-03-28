'use client';

import { useRef, useState } from 'react';
import type { ScaleSettings } from '@/utils/character-viewer/constants';
import { DEFAULT_SCALES } from '@/utils/character-viewer/constants';
import { Sidebar } from '@/components/character-viewer/Sidebar';
import EditorLayout from '@/templates/EditorLayout';

import { useCharacterViewerRefs, useCharacterViewerScene, useCharacterViewerDisplay } from '@/utils/character-viewer/hooks';

interface CharacterViewerTemplateProps {
  /** viewから渡されるヘッダー描画関数 */
  renderHeader: (status: string, loading: boolean) => React.ReactNode;
}

export default function CharacterViewerTemplate({ renderHeader }: CharacterViewerTemplateProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const refs = useCharacterViewerRefs();

  // State
  const [status, setStatus] = useState('Loading...');
  const [voxelCount, setVoxelCount] = useState(0);
  const [scales, setScales] = useState<ScaleSettings>({ ...DEFAULT_SCALES });
  const [source, setSource] = useState<'primitive' | 'model'>('primitive');
  const [modelFileName, setModelFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [colorMode, setColorMode] = useState<'texture' | 'bone'>('bone');
  const [detectedBones, setDetectedBones] = useState<{ name: string; count: number }[]>([]);

  // シーン初期化 + 初期データ読み込み
  useCharacterViewerScene({
    refs, canvasRef, setStatus, setVoxelCount, setSource, setDetectedBones,
  });

  // 表示ロジック (リビルド、ファイル読み込み、色モード切替)
  const { handleScaleChange, handleReset, switchToPrimitive, handleFileLoad, handleColorMode } =
    useCharacterViewerDisplay({
      refs, colorMode, scales, source,
      setStatus, setVoxelCount, setScales, setSource, setModelFileName, setLoading, setDetectedBones,
    });

  const onColorMode = (mode: 'texture' | 'bone') => {
    setColorMode(mode);
    handleColorMode(mode);
  };

  const sidebar = (
    <Sidebar
      source={source} modelFileName={modelFileName} loading={loading}
      scales={scales} colorMode={colorMode} detectedBones={detectedBones} voxelCount={voxelCount}
      onFileLoad={handleFileLoad} onSwitchToPrimitive={switchToPrimitive}
      onScaleChange={handleScaleChange} onReset={handleReset} onColorMode={onColorMode}
    />
  );

  return (
    <EditorLayout ref={canvasRef} header={renderHeader(status, loading)} sidebar={sidebar} sidebarWidth={280} />
  );
}
