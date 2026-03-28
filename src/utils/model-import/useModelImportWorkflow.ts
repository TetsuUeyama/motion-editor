import { useEffect, useState, useCallback, type MutableRefObject } from 'react';
import {
  Vector3, Color3, Mesh, MeshBuilder, AbstractMesh, TransformNode,
  Scene, ArcRotateCamera, StandardMaterial,
} from '@babylonjs/core';
import type { HighlightLayer } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { SceneLoader } from '@babylonjs/core';

import {
  guessCategory, type PartCategory, type DeformParams, type VoxelEntry,
  MIRROR_PAIRS, getMarkerColor,
} from '@/utils/auto-rigger';

import type { Step, PartConfig } from '@/utils/model-import/constants';
import { PLACEABLE_MARKERS, PLACEABLE_MARKERS_NO_SYM } from '@/utils/model-import/constants';
import { parseObjToMeshes, computeModelBounds } from '@/utils/model-import/parsers';

// ============================================================
// useModelImportSteps
// ============================================================

interface UseModelImportStepsParams {
  sceneRef: MutableRefObject<Scene | null>;
  highlightRef: MutableRefObject<HighlightLayer | null>;
  meshMapRef: MutableRefObject<Map<string, AbstractMesh[]>>;
  centerLineRef: MutableRefObject<Mesh | null>;
  markerMeshesRef: MutableRefObject<Map<string, Mesh>>;
  skelNodesRef: MutableRefObject<Map<string, TransformNode>>;
  skelMeshesRef: MutableRefObject<Map<string, Mesh>>;
  restPosRef: MutableRefObject<Map<string, Vector3>>;
  animCallbackRef: MutableRefObject<(() => void) | null>;
  resultMeshesRef: MutableRefObject<Mesh[]>;
  modelCenter: Vector3;
  setModelCenter: (c: Vector3) => void;
  setMarkers: (m: Record<string, Vector3>) => void;
  setActiveMarker: (m: string | null) => void;
  setPlayingMotion: (m: string | null) => void;
  setBodyVoxels: (v: VoxelEntry[]) => void;
  setOtherPartVoxels: (v: Record<string, VoxelEntry[]>) => void;
  step: Step;
  setStep: (s: Step) => void;
}

/**
 * Step navigation, model loading, part visibility, and related state.
 */
export function useModelImportSteps({
  sceneRef, highlightRef, meshMapRef, centerLineRef, markerMeshesRef,
  skelNodesRef, skelMeshesRef, restPosRef, animCallbackRef, resultMeshesRef,
  modelCenter, setModelCenter, setMarkers, setActiveMarker,
  setPlayingMotion, setBodyVoxels, setOtherPartVoxels,
  step, setStep,
}: UseModelImportStepsParams) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parts, setParts] = useState<Record<string, PartConfig>>({});
  const [selectedPart, setSelectedPart] = useState<string | null>(null);

  // clearResult
  const clearResult = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (animCallbackRef.current) { scene.unregisterBeforeRender(animCallbackRef.current); animCallbackRef.current = null; }
    for (const m of resultMeshesRef.current) m.dispose(); resultMeshesRef.current = [];
    for (const [, m] of skelMeshesRef.current) m.dispose(); skelMeshesRef.current.clear();
    for (const [, n] of skelNodesRef.current) n.dispose(); skelNodesRef.current.clear();
    restPosRef.current.clear();
    setBodyVoxels([]); setOtherPartVoxels({}); setPlayingMotion(null);
  }, [sceneRef, animCallbackRef, resultMeshesRef, skelMeshesRef, skelNodesRef, restPosRef,
      setBodyVoxels, setOtherPartVoxels, setPlayingMotion]);

  // loadModel
  const loadModel = useCallback(async (file: File) => {
    const scene = sceneRef.current;
    if (!scene) return;
    setLoading(true); setError(null); setFileName(file.name);
    setParts({}); setSelectedPart(null); setMarkers({}); setActiveMarker(null);
    clearResult();

    for (const m of [...meshMapRef.current.values()].flat()) m.dispose();
    meshMapRef.current.clear();
    for (const [, m] of markerMeshesRef.current) m.dispose(); markerMeshesRef.current.clear();
    if (centerLineRef.current) { centerLineRef.current.dispose(); centerLineRef.current = null; }
    for (const m of scene.meshes.filter(mm => mm.name !== 'ground')) m.dispose();
    for (const n of scene.transformNodes) n.dispose();

    try {
      const url = URL.createObjectURL(file);
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      let result: { meshes: AbstractMesh[] };
      if (ext === 'glb' || ext === 'gltf') result = await SceneLoader.ImportMeshAsync('', url, '', scene, null, '.glb');
      else if (ext === 'obj') {
        const objText = await file.text();
        result = { meshes: parseObjToMeshes(objText, scene) };
      }
      else throw new Error(`Unsupported format: .${ext}`);
      URL.revokeObjectURL(url);

      const partMap = new Map<string, AbstractMesh[]>();
      const partConfigs: Record<string, PartConfig> = {};

      for (const m of result.meshes) {
        if (m.name === '__root__' || !(m instanceof Mesh) || m.getTotalVertices() < 3) { m.isPickable = false; continue; }
        let partName = m.name.replace(/^mixamorig:?/i, '').replace(/\.\d+$/, '').trim();
        if (!partName) partName = m.name;
        if (!partMap.has(partName)) partMap.set(partName, []);
        partMap.get(partName)!.push(m);
        m.isPickable = true;
      }

      for (const [name, meshes] of partMap) {
        const totalVerts = meshes.reduce((s, m) => s + (m instanceof Mesh ? m.getTotalVertices() : 0), 0);
        partConfigs[name] = { category: guessCategory(name), meshName: name, vertexCount: totalVerts, visible: true };
      }

      meshMapRef.current = partMap;
      setParts(partConfigs);

      // Fit camera
      const allMeshes = [...partMap.values()].flat();
      const { center } = computeModelBounds(allMeshes);
      setModelCenter(center);
      const bounds = scene.getWorldExtends();
      const size = bounds.max.subtract(bounds.min).length();
      const cam = scene.activeCamera as ArcRotateCamera;
      if (cam) { cam.target = center; cam.radius = Math.max(size * 1.2, 2); }

      // Click to select part
      scene.onPointerDown = (_evt, pick) => {
        if (pick?.hit && pick.pickedMesh) {
          for (const [pn, ms] of meshMapRef.current) {
            if (ms.includes(pick.pickedMesh)) { setSelectedPart(pn); return; }
          }
        }
      };

      setStep('parts');
      setLoading(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); }
  }, [sceneRef, clearResult, meshMapRef, markerMeshesRef, centerLineRef,
      setMarkers, setActiveMarker, setModelCenter]);

  // Highlight selected part
  useEffect(() => {
    const hl = highlightRef.current; if (!hl) return;
    hl.removeAllMeshes();
    if (selectedPart && meshMapRef.current.has(selectedPart)) {
      for (const m of meshMapRef.current.get(selectedPart)!)
        if (m instanceof Mesh) hl.addMesh(m, Color3.FromHexString('#44aaff'));
    }
  }, [selectedPart, highlightRef, meshMapRef]);

  // toggleVis
  const toggleVis = useCallback((name: string) => {
    const ms = meshMapRef.current.get(name); if (!ms) return;
    setParts(p => {
      const n = { ...p }; n[name] = { ...n[name], visible: !n[name].visible };
      for (const m of ms) m.isVisible = n[name].visible;
      return n;
    });
  }, [meshMapRef]);

  // setCat
  const setCat = useCallback((name: string, cat: PartCategory) => {
    setParts(p => ({ ...p, [name]: { ...p[name], category: cat } }));
  }, []);

  // goToMarkers
  const goToMarkers = useCallback(() => {
    const scene = sceneRef.current; if (!scene) return;
    const allMeshes = [...meshMapRef.current.values()].flat();
    const { center, min, max } = computeModelBounds(allMeshes);
    setModelCenter(center);
    if (centerLineRef.current) centerLineRef.current.dispose();
    const cl = MeshBuilder.CreateLines('centerLine', {
      points: [new Vector3(center.x, min.y - 0.05, center.z), new Vector3(center.x, max.y + 0.05, center.z)],
    }, scene);
    cl.color = new Color3(1, 1, 1); cl.isPickable = false;
    centerLineRef.current = cl;

    scene.onPointerDown = undefined;
    highlightRef.current?.removeAllMeshes();
    setSelectedPart(null);
    setActiveMarker('Chin');
    setStep('markers');
  }, [sceneRef, highlightRef, meshMapRef, centerLineRef, setModelCenter, setActiveMarker]);

  // goBack
  const goBack = useCallback(() => {
    const scene = sceneRef.current; if (!scene) return;
    if (step === 'parts') {
      setStep('upload');
    } else if (step === 'markers') {
      if (centerLineRef.current) { centerLineRef.current.dispose(); centerLineRef.current = null; }
      for (const [, m] of markerMeshesRef.current) m.dispose(); markerMeshesRef.current.clear();
      scene.onPointerDown = (_evt, pick) => {
        if (pick?.hit && pick.pickedMesh) {
          for (const [pn, ms] of meshMapRef.current) { if (ms.includes(pick.pickedMesh)) { setSelectedPart(pn); return; } }
        }
      };
      setStep('parts');
    } else if (step === 'result') {
      clearResult();
      for (const [name, ms] of meshMapRef.current) {
        const visible = parts[name]?.visible ?? true;
        for (const m of ms) { m.setEnabled(true); m.isVisible = visible; }
      }
      if (centerLineRef.current) { centerLineRef.current.setEnabled(true); centerLineRef.current.isVisible = true; }
      for (const [, m] of markerMeshesRef.current) { m.setEnabled(true); m.isVisible = true; }
      const cam = scene.activeCamera as ArcRotateCamera; if (cam) { cam.target = modelCenter; }
      setStep('markers');
    }
  }, [step, sceneRef, clearResult, parts, modelCenter,
      meshMapRef, centerLineRef, markerMeshesRef, highlightRef]);

  // Drag & drop handlers
  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(true); }, []);
  const onDragLeave = useCallback(() => setDragOver(false), []);
  const onDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) loadModel(f); }, [loadModel]);

  // Part counts (derived)
  const categoryCounts: Record<string, number> = {};
  for (const p of Object.values(parts)) categoryCounts[p.category] = (categoryCounts[p.category] ?? 0) + 1;
  const hasBody = categoryCounts['body'] > 0;

  const partNames = Object.keys(parts).sort((a, b) => {
    const o: Record<string, number> = { body: 0, hair: 1, clothing: 2, other: 3, exclude: 4 };
    const oa = o[parts[a].category] ?? 3, ob = o[parts[b].category] ?? 3;
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  });

  return {
    step, setStep, fileName, loading, error, setError, parts, selectedPart, dragOver,
    loadModel, goToMarkers, goBack, toggleVis, setCat, clearResult,
    setSelectedPart, setDragOver,
    partNames, categoryCounts, hasBody,
    onDragOver, onDragLeave, onDrop,
  };
}

// ============================================================
// useModelImportMarkers
// ============================================================

interface UseModelImportMarkersParams {
  sceneRef: MutableRefObject<Scene | null>;
  markerMeshesRef: MutableRefObject<Map<string, Mesh>>;
  step: Step;
}

/**
 * Marker state, placement logic, and sphere visuals.
 */
export function useModelImportMarkers({
  sceneRef, markerMeshesRef, step,
}: UseModelImportMarkersParams) {
  const [markers, setMarkers] = useState<Record<string, Vector3>>({});
  const [activeMarker, setActiveMarker] = useState<string | null>(null);
  const [useSymmetry, setUseSymmetry] = useState(true);
  const [modelCenter, setModelCenter] = useState<Vector3>(Vector3.Zero());

  // Mirror helper
  const mirrorPos = useCallback((pos: Vector3): Vector3 => {
    return new Vector3(2 * modelCenter.x - pos.x, pos.y, pos.z);
  }, [modelCenter]);

  // Complete markers (fill in mirrored sides)
  const completeMarkers = useCallback((): Record<string, Vector3> => {
    const r = { ...markers };
    if (useSymmetry) {
      for (const [right, left] of Object.entries(MIRROR_PAIRS)) {
        if (r[left]) r[right] = mirrorPos(r[left]);
      }
    }
    return r;
  }, [markers, useSymmetry, mirrorPos]);

  // Clear a single marker (and its mirror)
  const clearMarker = useCallback((name: string) => {
    setMarkers(prev => {
      const n = { ...prev }; delete n[name];
      if (useSymmetry) {
        const mt = Object.entries(MIRROR_PAIRS).find(([, s]) => s === name);
        if (mt) delete n[mt[0]];
        if (MIRROR_PAIRS[name]) delete n[MIRROR_PAIRS[name]];
      }
      return n;
    });
    setActiveMarker(name);
  }, [useSymmetry]);

  // Derived
  const allMarkersPlaced = (useSymmetry ? PLACEABLE_MARKERS : PLACEABLE_MARKERS_NO_SYM).every(n => !!markers[n]);

  // Marker placement effect (pointer handler)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || step !== 'markers') return;

    scene.onPointerDown = (_evt, pick) => {
      if (!activeMarker || !pick?.hit || !pick.pickedPoint) return;
      if (pick.pickedMesh?.name.startsWith('marker_')) return;

      const pos = pick.pickedPoint.clone();
      const newMarkers = { ...markers, [activeMarker]: pos };

      if (useSymmetry) {
        const mt = Object.entries(MIRROR_PAIRS).find(([, src]) => src === activeMarker);
        if (mt) newMarkers[mt[0]] = mirrorPos(pos);
      }

      setMarkers(newMarkers);
      const list = useSymmetry ? PLACEABLE_MARKERS : PLACEABLE_MARKERS_NO_SYM;
      const next = list.find(n => !newMarkers[n]);
      if (next) setActiveMarker(next);
    };

    return () => { scene.onPointerDown = undefined; };
  }, [step, activeMarker, markers, useSymmetry, mirrorPos, sceneRef]);

  // Marker sphere visuals effect
  useEffect(() => {
    const scene = sceneRef.current; if (!scene) return;
    for (const [, m] of markerMeshesRef.current) m.dispose(); markerMeshesRef.current.clear();

    const all = { ...markers };
    if (useSymmetry) {
      for (const [r, l] of Object.entries(MIRROR_PAIRS)) {
        if (all[l] && !all[r]) all[r] = mirrorPos(all[l]);
      }
    }

    for (const [name, pos] of Object.entries(all)) {
      const isActive = name === activeMarker;
      const isMirr = useSymmetry && MIRROR_PAIRS[name] && !markers[name];
      const s = MeshBuilder.CreateSphere(`marker_${name}`, { diameter: isActive ? 0.08 : 0.06 }, scene);
      s.position = pos;
      const mt = new StandardMaterial(`mmat_${name}`, scene);
      const c = Color3.FromHexString(getMarkerColor(name));
      mt.diffuseColor = c; mt.emissiveColor = c.scale(isActive ? 1.0 : isMirr ? 0.3 : 0.7);
      mt.alpha = isMirr ? 0.6 : 1.0;
      s.material = mt; s.isPickable = false;
      markerMeshesRef.current.set(name, s);
    }
  }, [markers, activeMarker, useSymmetry, mirrorPos, sceneRef, markerMeshesRef]);

  return {
    markers, setMarkers,
    activeMarker, setActiveMarker,
    useSymmetry, setUseSymmetry,
    modelCenter, setModelCenter,
    mirrorPos, completeMarkers, clearMarker,
    allMarkersPlaced,
  };
}
