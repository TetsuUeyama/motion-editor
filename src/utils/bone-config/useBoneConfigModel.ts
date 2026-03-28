/**
 * モデル読み込みロジックを管理するフック
 * VOXファイル読み込み、装備パーツマニフェスト読み込み、保存済みボーン設定復元を担当する
 */
import { useEffect } from 'react';
import { loadVoxFile } from '@/utils/voxelize/parser';
import type { VoxelEntry } from '@/utils/voxelize/parser';
import { getDefaultMarkers, type MarkerData } from '@/utils/voxelize/skeleton';
import type { ModelEntry } from '@/utils/model-registry';
import { buildBodyMesh, type EquipPart } from '@/utils/bone-config/constants';
import type { useBoneConfigRefs } from './useBoneConfigScene';

interface ModelHookParams {
  refs: ReturnType<typeof useBoneConfigRefs>;
  currentModel: ModelEntry;
  setLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
  setDirty: (v: boolean) => void;
  setMarkers: React.Dispatch<React.SetStateAction<MarkerData>>;
  setAutoMirror: (v: boolean) => void;
  setEquipParts: (parts: EquipPart[]) => void;
  setEquipEnabled: (enabled: Record<string, boolean>) => void;
  setEquipVoxelCache: (cache: Record<string, VoxelEntry[]>) => void;
}

export function useBoneConfigModel({
  refs, currentModel,
  setLoading, setError, setDirty, setMarkers, setAutoMirror,
  setEquipParts, setEquipEnabled, setEquipVoxelCache,
}: ModelHookParams) {
  const {
    sceneRef, bodyMeshRef, centerRef, voxelsRef, loadKeyRef,
  } = refs;

  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;
    const thisLoadKey = ++loadKeyRef.current;

    // Clear existing body mesh
    if (bodyMeshRef.current) { bodyMeshRef.current.dispose(); bodyMeshRef.current = null; }

    setLoading(true);
    setError(null);
    setDirty(false);

    (async () => {
      try {
        const { model, voxels } = await loadVoxFile(currentModel.bodyFile);
        if (loadKeyRef.current !== thisLoadKey) return; // stale

        const cx = model.sizeX / 2;
        const cy = model.sizeY / 2;
        const maxZ = model.sizeZ;
        centerRef.current = { cx, cy, maxZ };
        voxelsRef.current = voxels;

        bodyMeshRef.current = buildBodyMesh(voxels, scene, cx, cy, 0.25);

        // Load equipment manifest
        try {
          const partsResp = await fetch(currentModel.partsManifest + `?v=${Date.now()}`);
          if (partsResp.ok) {
            const parts: EquipPart[] = await partsResp.json();
            // Filter out the body itself
            const equipOnly = parts.filter(p => p.key !== currentModel.bodyKey);
            setEquipParts(equipOnly);
            // Set default enabled state
            const enabled: Record<string, boolean> = {};
            for (const p of equipOnly) enabled[p.key] = p.default_on;
            setEquipEnabled(enabled);
            setEquipVoxelCache({});
          }
        } catch { /* no equipment available */ }

        // Load saved bone config for this model
        let loaded = false;
        try {
          const resp = await fetch(`/api/bone-config?dir=${currentModel.dir}`);
          if (resp.ok) {
            const data = await resp.json();
            if (data?.markers && typeof data.markers === 'object') {
              setMarkers(prev => ({ ...prev, ...data.markers }));
              if (data.autoMirror === false) setAutoMirror(false);
              else setAutoMirror(true);
              loaded = true;
            }
          }
        } catch { /* use defaults */ }

        if (!loaded) {
          setMarkers(getDefaultMarkers(cx));
          setAutoMirror(true);
        }

        setLoading(false);
      } catch (e) {
        if (loadKeyRef.current !== thisLoadKey) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();
  }, [currentModel]);
}
