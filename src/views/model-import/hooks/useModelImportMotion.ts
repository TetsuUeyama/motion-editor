import { useCallback, useState, type MutableRefObject } from 'react';
import {
  Scene, Vector3, Quaternion, TransformNode, Mesh,
} from '@babylonjs/core';
import {
  BODY_SIZE, VSCALE, BONE_DEFS,
  calculateTargetBones,
  voxelToViewer, loadMotionClip, threeQuatToViewer,
  type DeformParams,
} from '@/utils/auto-rigger';
import { MOTION_BASE } from '@/utils/model-import/constants';

interface UseModelImportMotionParams {
  sceneRef: MutableRefObject<Scene | null>;
  skelNodesRef: MutableRefObject<Map<string, TransformNode>>;
  skelMeshesRef: MutableRefObject<Map<string, Mesh>>;
  restPosRef: MutableRefObject<Map<string, Vector3>>;
  deformParamsRef: MutableRefObject<DeformParams | null>;
  worldMarkersRef: MutableRefObject<Record<string, Vector3>>;
  resultMeshesRef: MutableRefObject<Mesh[]>;
  animCallbackRef: MutableRefObject<(() => void) | null>;
  animTimeRef: MutableRefObject<number>;
}

/**
 * Hook for motion playback (start/stop) on the skeletal character.
 */
export function useModelImportMotion({
  sceneRef, skelNodesRef, skelMeshesRef, restPosRef,
  deformParamsRef, worldMarkersRef, resultMeshesRef,
  animCallbackRef, animTimeRef,
}: UseModelImportMotionParams) {
  const [playingMotion, setPlayingMotion] = useState<string | null>(null);
  const [loadingMotion, setLoadingMotion] = useState(false);

  const startMotion = useCallback(async (motionName: string) => {
    const scene = sceneRef.current; if (!scene) return;
    if (animCallbackRef.current) { scene.unregisterBeforeRender(animCallbackRef.current); animCallbackRef.current = null; }
    setPlayingMotion(null); setLoadingMotion(true);
    try {
      const url = `${MOTION_BASE}/${motionName}.motion.json`;
      const clip = await loadMotionClip(url, motionName, motionName);
      if (!deformParamsRef.current) return;
      const bones = calculateTargetBones(worldMarkersRef.current, deformParamsRef.current);
      const cx = BODY_SIZE.x / 2, cy = BODY_SIZE.y / 2;
      const bodyH = BODY_SIZE.z * VSCALE;
      const sf = clip.fbxBodyHeight > 0 ? bodyH / clip.fbxBodyHeight : 1;
      const hipsVP = restPosRef.current.get('Hips') ?? Vector3.Zero();
      const toVQ = (dq: [number, number, number, number]) => threeQuatToViewer(dq);

      for (const bd of BONE_DEFS) {
        const node = skelNodesRef.current.get(bd.name); if (!node) continue;
        if (bd.parent) {
          const pn = skelNodesRef.current.get(bd.parent);
          const bp = bones[bd.name], pp = bones[bd.parent];
          if (pn && bp && pp) { node.parent = pn; node.position = voxelToViewer(bp.x, bp.y, bp.z, cx, cy).subtract(voxelToViewer(pp.x, pp.y, pp.z, cx, cy)); }
        } else { node.parent = null; const rp = restPosRef.current.get(bd.name); if (rp) node.position = rp.clone(); }
        node.rotationQuaternion = Quaternion.Identity();
      }

      const fd = 1.0 / clip.fps; animTimeRef.current = 0; let lt = performance.now();
      const af = (fi: number) => {
        const frame = clip.frames[fi]; if (!frame) return;
        const wdqs = new Map<string, Quaternion>();
        for (const bd of BONE_DEFS) { const d = frame[bd.name]; wdqs.set(bd.name, d ? toVQ(d.dq) : Quaternion.Identity()); }
        for (const bd of BONE_DEFS) {
          const node = skelNodesRef.current.get(bd.name); if (!node) continue;
          const wq = wdqs.get(bd.name) ?? Quaternion.Identity();
          if (bd.parent) { const pwq = wdqs.get(bd.parent) ?? Quaternion.Identity(); node.rotationQuaternion = Quaternion.Inverse(pwq).multiply(wq); }
          else { node.rotationQuaternion = wq; }
        }
        const hd = frame['Hips']; const hn = skelNodesRef.current.get('Hips');
        if (hn && hd?.dp) { hn.position.x = hipsVP.x + (-hd.dp[0]) * sf; hn.position.y = hipsVP.y + hd.dp[1] * sf; hn.position.z = hipsVP.z + hd.dp[2] * sf; }
        else if (hn) { hn.position.copyFrom(hipsVP); }
      };
      const cb = () => { const now = performance.now(); const dt = (now - lt) / 1000; lt = now; animTimeRef.current += dt; const l = animTimeRef.current % clip.duration; const fi = Math.min(Math.floor(l / fd), clip.frameCount - 1); af(fi); };
      // Switch to skeletal meshes for animation
      for (const m of resultMeshesRef.current) m.isVisible = false;
      for (const [, m] of skelMeshesRef.current) m.isVisible = true;

      animCallbackRef.current = cb; scene.registerBeforeRender(cb); setPlayingMotion(motionName);
    } catch (e) { console.error('Motion error:', e); }
    setLoadingMotion(false);
  }, [sceneRef, skelNodesRef, skelMeshesRef, restPosRef, deformParamsRef, worldMarkersRef, resultMeshesRef, animCallbackRef, animTimeRef]);

  const stopMotion = useCallback(() => {
    const scene = sceneRef.current; if (!scene) return;
    if (animCallbackRef.current) { scene.unregisterBeforeRender(animCallbackRef.current); animCallbackRef.current = null; }
    setPlayingMotion(null);
    for (const [, m] of skelMeshesRef.current) m.isVisible = false;
    for (const m of resultMeshesRef.current) m.isVisible = true;
    if (!deformParamsRef.current) return;
    const bones = calculateTargetBones(worldMarkersRef.current, deformParamsRef.current); const cx = BODY_SIZE.x / 2, cy = BODY_SIZE.y / 2;
    for (const bd of BONE_DEFS) {
      const node = skelNodesRef.current.get(bd.name); const bp = bones[bd.name]; if (!node || !bp) continue;
      node.rotationQuaternion = Quaternion.Identity();
      if (bd.parent) { const pp = bones[bd.parent]; if (pp) node.position = voxelToViewer(bp.x, bp.y, bp.z, cx, cy).subtract(voxelToViewer(pp.x, pp.y, pp.z, cx, cy)); }
      else { node.position = voxelToViewer(bp.x, bp.y, bp.z, cx, cy); }
    }
  }, [sceneRef, skelNodesRef, skelMeshesRef, restPosRef, deformParamsRef, worldMarkersRef, resultMeshesRef, animCallbackRef]);

  return { playingMotion, loadingMotion, startMotion, stopMotion, setPlayingMotion };
}
