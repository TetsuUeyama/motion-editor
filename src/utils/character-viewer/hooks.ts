/**
 * character-viewer用カスタムフック
 * Refs管理、シーン初期化、表示ロジックを一括管理
 */
import { useRef, useEffect, useCallback } from 'react';
import { Mesh, AbstractMesh, SceneLoader } from '@babylonjs/core';
import type { Scene, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

import type { CharacterConfig, BoneData, GridVoxel, ScaleSettings, PerBoneVoxels } from './constants';
import { DEFAULT_SCALES } from './constants';
import { voxelizeAllParts, buildVoxelMesh, buildBoneMap, generateBoneColors, applyBoneColors, assignVoxelsToBoneParts, computeAlignment } from './voxelize';
import { voxelizeBodyModel, voxelizeMeshesPerBone } from './voxelize-model';
import { setupBabylonScene } from '@/utils/babylon-setup';

// ============================================================
// useCharacterViewerRefs
// ============================================================

export function useCharacterViewerRefs() {
  const sceneRef = useRef<Scene | null>(null);
  const configRef = useRef<CharacterConfig | null>(null);
  const boneMapRef = useRef<Map<string, Vector3> | null>(null);
  const meshRef = useRef<Mesh | null>(null);
  const loadedMeshesRef = useRef<AbstractMesh[]>([]);
  const perBoneDataRef = useRef<PerBoneVoxels | null>(null);
  const rebuildTimerRef = useRef<number | null>(null);

  return { sceneRef, configRef, boneMapRef, meshRef, loadedMeshesRef, perBoneDataRef, rebuildTimerRef };
}

export type CharacterViewerRefs = ReturnType<typeof useCharacterViewerRefs>;

// ============================================================
// useCharacterViewerScene
// ============================================================

interface UseCharacterViewerSceneParams {
  refs: CharacterViewerRefs;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  setStatus: (s: string) => void;
  setVoxelCount: (n: number) => void;
  setSource: (s: 'primitive' | 'model') => void;
  setDetectedBones: (b: { name: string; count: number }[]) => void;
}

export function useCharacterViewerScene({
  refs, canvasRef, setStatus, setVoxelCount, setSource, setDetectedBones,
}: UseCharacterViewerSceneParams) {
  const { sceneRef, configRef, boneMapRef, meshRef, loadedMeshesRef } = refs;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { scene, dispose } = setupBabylonScene({ canvas, groundSubdivisions: 20 });
    sceneRef.current = scene;

    let disposed = false;
    (async () => {
      try {
        setStatus('Loading data...');
        const [cr, br] = await Promise.all([
          fetch('/api/game-assets/characters/mixamo-ybot/character-config.json'),
          fetch('/api/game-assets/characters/mixamo-ybot/bone-data.json'),
        ]);
        if (!cr.ok || !br.ok) { setStatus('Failed'); return; }
        const config: CharacterConfig = await cr.json();
        const boneData: BoneData = await br.json();
        if (disposed) return;
        const boneMap = buildBoneMap(boneData.bones);
        configRef.current = config;
        boneMapRef.current = boneMap;

        setStatus('Loading body model...');
        let modelVoxels: GridVoxel[] = [];
        try {
          modelVoxels = await voxelizeBodyModel(scene, '/api/game-assets/characters/mixamo-ybot/face.glb', boneMap);
        } catch (e) {
          console.warn('Body model load failed, using primitives:', e);
        }

        if (modelVoxels.length > 0) {
          setStatus('Assigning voxels to bones...');
          const partResult = assignVoxelsToBoneParts(modelVoxels, config, boneMap);
          const allVoxels: GridVoxel[] = [];
          const partNames = Object.keys(partResult).filter(k => partResult[k].length > 0);
          const colors = generateBoneColors(partNames.length);
          partNames.forEach((name, i) => {
            const c = colors[i];
            for (const v of partResult[name]) allVoxels.push({ ...v, r: c.r, g: c.g, b: c.b });
          });
          meshRef.current = buildVoxelMesh(allVoxels, scene, 'vox_init');
          setVoxelCount(allVoxels.length);
          setDetectedBones(partNames.map(name => ({ name, count: partResult[name].length })));
          setSource('model');
          setStatus(`${allVoxels.length.toLocaleString()} voxels, ${partNames.length} parts (from 3D model)`);
        } else {
          const voxels = voxelizeAllParts(config, boneMap, DEFAULT_SCALES);
          meshRef.current = buildVoxelMesh(voxels, scene, 'vox_init');
          setVoxelCount(voxels.length);
          setStatus(`${voxels.length.toLocaleString()} voxels`);
        }
      } catch (err) {
        console.error(err);
        setStatus('Error: ' + (err as Error).message);
      }
    })();

    return () => {
      disposed = true;
      sceneRef.current = null; configRef.current = null; boneMapRef.current = null;
      meshRef.current = null; loadedMeshesRef.current = [];
      dispose();
    };
  }, []);
}

// ============================================================
// useCharacterViewerDisplay
// ============================================================

interface UseCharacterViewerDisplayParams {
  refs: CharacterViewerRefs;
  colorMode: 'texture' | 'bone';
  scales: ScaleSettings;
  source: 'primitive' | 'model';
  setStatus: (s: string) => void;
  setVoxelCount: (n: number) => void;
  setScales: React.Dispatch<React.SetStateAction<ScaleSettings>>;
  setSource: (s: 'primitive' | 'model') => void;
  setModelFileName: (s: string | null) => void;
  setLoading: (b: boolean) => void;
  setDetectedBones: (b: { name: string; count: number }[]) => void;
}

export function useCharacterViewerDisplay({
  refs, colorMode, scales, source,
  setStatus, setVoxelCount, setScales, setSource, setModelFileName, setLoading, setDetectedBones,
}: UseCharacterViewerDisplayParams) {
  const { sceneRef, configRef, boneMapRef, meshRef, loadedMeshesRef, perBoneDataRef, rebuildTimerRef } = refs;

  const disposeMesh = useCallback(() => {
    if (meshRef.current) { meshRef.current.material?.dispose(); meshRef.current.dispose(); meshRef.current = null; }
  }, [meshRef]);

  const disposeLoaded = useCallback(() => {
    for (const m of loadedMeshesRef.current) { try { m.dispose(); } catch {} }
    loadedMeshesRef.current = [];
  }, [loadedMeshesRef]);

  const rebuildPrimitive = useCallback((newScales: ScaleSettings) => {
    const scene = sceneRef.current, config = configRef.current, boneMap = boneMapRef.current;
    if (!scene || !config || !boneMap) return;
    disposeMesh();
    const t0 = performance.now();
    const voxels = voxelizeAllParts(config, boneMap, newScales);
    meshRef.current = buildVoxelMesh(voxels, scene, 'vox_' + Date.now());
    const ms = (performance.now() - t0).toFixed(0);
    setVoxelCount(voxels.length);
    setStatus(`${voxels.length.toLocaleString()} voxels (${ms}ms)`);
  }, [sceneRef, configRef, boneMapRef, meshRef, disposeMesh, setVoxelCount, setStatus]);

  const rebuildModelDisplay = useCallback((mode: 'texture' | 'bone') => {
    const scene = sceneRef.current, data = perBoneDataRef.current;
    if (!scene || !data) return;
    disposeMesh();
    const voxels = mode === 'bone' ? applyBoneColors(data) : data.allVoxels;
    meshRef.current = buildVoxelMesh(voxels, scene, 'vox_' + Date.now());
    setVoxelCount(voxels.length);
  }, [sceneRef, perBoneDataRef, meshRef, disposeMesh, setVoxelCount]);

  const handleScaleChange = useCallback((key: keyof ScaleSettings, value: number) => {
    setScales(prev => {
      const next = { ...prev, [key]: value };
      if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current);
      rebuildTimerRef.current = window.setTimeout(() => rebuildPrimitive(next), 50);
      return next;
    });
  }, [rebuildTimerRef, rebuildPrimitive, setScales]);

  const handleReset = useCallback(() => {
    const d = { ...DEFAULT_SCALES };
    setScales(d);
    rebuildPrimitive(d);
  }, [rebuildPrimitive, setScales]);

  const switchToPrimitive = useCallback(() => {
    disposeLoaded();
    perBoneDataRef.current = null;
    setSource('primitive'); setModelFileName(null); setDetectedBones([]);
    rebuildPrimitive(scales);
  }, [disposeLoaded, perBoneDataRef, rebuildPrimitive, scales, setSource, setModelFileName, setDetectedBones]);

  const handleFileLoad = useCallback(async (file: File) => {
    const scene = sceneRef.current, boneMap = boneMapRef.current;
    if (!scene || !boneMap) return;
    setLoading(true); setModelFileName(file.name); setStatus('Loading model...');
    disposeMesh(); disposeLoaded(); perBoneDataRef.current = null;

    try {
      const url = URL.createObjectURL(file);
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (ext !== 'glb' && ext !== 'gltf') throw new Error(`Unsupported: .${ext}`);
      const result = await SceneLoader.ImportMeshAsync('', url, '', scene, null, '.glb');
      URL.revokeObjectURL(url);

      const valid: AbstractMesh[] = [];
      for (const m of result.meshes) {
        if (m.name === '__root__' || !(m instanceof Mesh) || m.getTotalVertices() < 3) { m.isPickable = false; m.isVisible = false; continue; }
        valid.push(m);
      }
      loadedMeshesRef.current = valid;

      setStatus(`Analyzing ${valid.length} meshes...`);
      await new Promise(r => setTimeout(r, 30));
      const align = computeAlignment(valid, boneMap);
      setStatus('Voxelizing per bone...');
      await new Promise(r => setTimeout(r, 30));

      const t0 = performance.now();
      const data = await voxelizeMeshesPerBone(valid, align);
      perBoneDataRef.current = data;
      const ms = (performance.now() - t0).toFixed(0);

      for (const m of valid) m.isVisible = false;

      const voxels = colorMode === 'bone' ? applyBoneColors(data) : data.allVoxels;
      meshRef.current = buildVoxelMesh(voxels, scene, 'voxModel_' + Date.now());
      setVoxelCount(data.allVoxels.length);
      setSource('model');
      setDetectedBones(data.boneNames.map(bn => ({ name: bn, count: data.perBone[bn].length })));
      setStatus(`${data.allVoxels.length.toLocaleString()} voxels, ${data.boneNames.length} parts (${ms}ms)`);
    } catch (err) {
      console.error(err);
      setStatus('Error: ' + (err as Error).message);
    }
    setLoading(false);
  }, [sceneRef, boneMapRef, meshRef, loadedMeshesRef, perBoneDataRef, disposeMesh, disposeLoaded, colorMode, setLoading, setModelFileName, setStatus, setVoxelCount, setSource, setDetectedBones]);

  const handleColorMode = useCallback((mode: 'texture' | 'bone') => {
    if (source === 'model') rebuildModelDisplay(mode);
  }, [source, rebuildModelDisplay]);

  return { handleScaleChange, handleReset, switchToPrimitive, handleFileLoad, handleColorMode };
}
