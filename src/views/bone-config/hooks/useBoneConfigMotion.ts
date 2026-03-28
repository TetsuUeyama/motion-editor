/**
 * モーション再生ロジックを管理するフック
 * モーションクリップの読み込み、再生、停止、デバッグボーン表示を担当する
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Vector3, Mesh, MeshBuilder, StandardMaterial, Color3, Quaternion,
} from '@babylonjs/core';
import { BONE_DEFS, type Vec3, type MotionClip, voxelToViewer } from '@/utils/voxel-skeleton';
import { MOTION_FILES, type QuatConversion } from '@/utils/bone-config/constants';
import type { useBoneConfigRefs } from './useBoneConfigRefs';

// フックが受け取るパラメータ型
interface MotionHookParams {
  refs: ReturnType<typeof useBoneConfigRefs>;   // 全Refオブジェクト
  calculatedBones: Record<string, Vec3>;         // マーカーから計算された41ボーン位置
  motionSpeed: number;                           // 再生速度倍率
  quatConv: QuatConversion;                      // クォータニオン変換方式（デバッグ用）
  showBonesOnly: boolean;                        // ボクセルメッシュ非表示でデバッグボーンのみ表示
  setCurrentFrame: (f: number) => void;          // フレーム番号更新（UIスライダー連動）
}

export function useBoneConfigMotion({
  refs, calculatedBones, motionSpeed, quatConv, showBonesOnly, setCurrentFrame,
}: MotionHookParams) {
  const {
    sceneRef, previewNodesRef, previewMeshesRef, debugBonesRef,
    boneRestPosRef, voxelBodyHeightRef, animCallbackRef, animTimeRef, pausedRef, applyFrameRef,
  } = refs;

  const [playingMotion, setPlayingMotion] = useState<string | null>(null);    // 現在再生中のモーション名（null=停止）
  const [loadedClips, setLoadedClips] = useState<Record<string, MotionClip>>({}); // 読み込み済みクリップのキャッシュ
  const [loadingMotion, setLoadingMotion] = useState(false);                  // クリップ読み込み中フラグ

  // モーション停止
  const stopMotion = useCallback(() => {
    const scene = sceneRef.current;
    if (scene && animCallbackRef.current) {
      scene.unregisterBeforeRender(animCallbackRef.current);
    }
    animCallbackRef.current = null;
    animTimeRef.current = 0;
    setPlayingMotion(null);
  }, [sceneRef, animCallbackRef, animTimeRef]);

  // モーションクリップをJSONファイルから読み込む
  const loadMotionClip = useCallback(async (motionName: string): Promise<MotionClip | null> => {
    if (loadedClips[motionName]) return loadedClips[motionName];

    const motionDef = MOTION_FILES.find(m => m.name === motionName);
    if (!motionDef) return null;

    setLoadingMotion(true);
    try {
      const resp = await fetch(motionDef.file);
      if (!resp.ok) throw new Error(`Failed to load ${motionDef.file}`);
      const data = await resp.json();
      const clip: MotionClip = {
        name: motionName,
        label: motionDef.label,
        duration: data.duration,
        fps: data.fps,
        frameCount: data.frameCount,
        fbxBodyHeight: data.fbxBodyHeight || 2.854,
        outputBones: data.outputBones || [],
        bindWorldPositions: data.bindWorldPositions,
        frames: data.frames,
      };
      setLoadedClips(prev => ({ ...prev, [motionName]: clip }));
      setLoadingMotion(false);
      return clip;
    } catch (e) {
      console.error('Failed to load motion:', e);
      setLoadingMotion(false);
      return null;
    }
  }, [loadedClips]);

  // モーションクリップを再生する
  // モーションクリップを再生する（主要ロジック）
  // 1. FBXとボクセルのスケール合わせ
  // 2. レストポーズ補正の計算
  // 3. ボーン階層の整合性確保
  // 4. デバッグボーン球体/矢印の生成
  // 5. フレームごとのクォータニオン→ローカル回転変換+適用
  const playMotionClip = useCallback((clip: MotionClip) => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (animCallbackRef.current) {
      scene.unregisterBeforeRender(animCallbackRef.current);
      animCallbackRef.current = null;
    }

    // スケール係数: ボクセルボディ高さ / FBXボディ高さ
    const scaleFactor = clip.fbxBodyHeight > 0
      ? voxelBodyHeightRef.current / clip.fbxBodyHeight
      : 1;

    const bwp = clip.bindWorldPositions;
    const voxelHipsPos = boneRestPosRef.current.get('Hips') ?? Vector3.Zero();
    const hipsBindFBX = bwp?.['Hips'] ?? [0, 0, 0];

    // FBXレストポジション（ビューワー空間。デバッグボーン表示用）
    const fbxRestViewer = new Map<string, Vector3>();
    for (const boneDef of BONE_DEFS) {
      const bp = bwp?.[boneDef.name];
      if (bp) {
        const relX = bp[0] - hipsBindFBX[0];
        const relY = bp[1] - hipsBindFBX[1];
        const relZ = bp[2] - hipsBindFBX[2];
        fbxRestViewer.set(boneDef.name, new Vector3(
          voxelHipsPos.x + (-relX) * scaleFactor,
          voxelHipsPos.y + relY * scaleFactor,
          voxelHipsPos.z + relZ * scaleFactor,
        ));
      }
    }

    // レストポーズ補正: ボクセルボーン方向→FBXボーン方向への回転を計算
    const restCorrections = new Map<string, Quaternion>();
    for (const boneDef of BONE_DEFS) {
      if (!boneDef.parent) continue;
      const voxelChild = boneRestPosRef.current.get(boneDef.name);
      const voxelParent = boneRestPosRef.current.get(boneDef.parent);
      const fbxChild = fbxRestViewer.get(boneDef.name);
      const fbxParent = fbxRestViewer.get(boneDef.parent);
      if (!voxelChild || !voxelParent || !fbxChild || !fbxParent) continue;

      const voxelDir = voxelChild.subtract(voxelParent);
      const fbxDirRaw = fbxChild.subtract(fbxParent);
      const fbxDir = new Vector3(fbxDirRaw.x, fbxDirRaw.y, -fbxDirRaw.z);
      if (voxelDir.length() < 0.001 || fbxDir.length() < 0.001) continue;

      voxelDir.normalize();
      fbxDir.normalize();

      if (['LeftArm','LeftForeArm','LeftUpLeg','LeftLeg','Spine','Spine2','Neck'].includes(boneDef.name)) {
        console.log(`[RestCorr] ${boneDef.name}: voxel=(${voxelDir.x.toFixed(3)},${voxelDir.y.toFixed(3)},${voxelDir.z.toFixed(3)}) fbx=(${fbxDir.x.toFixed(3)},${fbxDir.y.toFixed(3)},${fbxDir.z.toFixed(3)}) dot=${Vector3.Dot(voxelDir, fbxDir).toFixed(3)}`);
      }

      const dot = Vector3.Dot(voxelDir, fbxDir);
      if (dot > 0.9999) continue;
      if (dot < -0.9999) {
        const perp = Math.abs(voxelDir.x) < 0.9
          ? Vector3.Cross(voxelDir, Vector3.Right())
          : Vector3.Cross(voxelDir, Vector3.Up());
        perp.normalize();
        restCorrections.set(boneDef.name, new Quaternion(perp.x, perp.y, perp.z, 0));
        continue;
      }
      const axis = Vector3.Cross(voxelDir, fbxDir);
      axis.normalize();
      const angle = Math.acos(Math.min(1, Math.max(-1, dot)));
      restCorrections.set(boneDef.name, Quaternion.RotationAxis(axis, angle));
    }

    // 階層の整合性を確保
    for (const boneDef of BONE_DEFS) {
      const node = previewNodesRef.current.get(boneDef.name);
      if (!node) continue;
      if (boneDef.parent) {
        const parentNode = previewNodesRef.current.get(boneDef.parent);
        if (parentNode && node.parent !== parentNode) {
          node.parent = parentNode;
          const bonePos = boneRestPosRef.current.get(boneDef.name);
          const parentPos = boneRestPosRef.current.get(boneDef.parent);
          if (bonePos && parentPos) {
            node.position = bonePos.subtract(parentPos);
          }
        }
      } else {
        node.parent = null;
        const rest = boneRestPosRef.current.get(boneDef.name);
        if (rest) node.position = rest.clone();
      }
      node.rotationQuaternion = Quaternion.Identity();
    }

    // デバッグボーン球体を生成
    for (const s of debugBonesRef.current.spheres) s.dispose();
    if (debugBonesRef.current.lines) debugBonesRef.current.lines.dispose();
    const debugSpheres: Mesh[] = [];
    for (const boneDef of BONE_DEFS) {
      const fbxRest = fbxRestViewer.get(boneDef.name);
      if (!fbxRest) continue;
      const sphere = MeshBuilder.CreateSphere(`dbg_${boneDef.name}`, { diameter: 0.15 }, scene);
      const mat = new StandardMaterial(`dbg_mat_${boneDef.name}`, scene);
      mat.diffuseColor = Color3.FromHexString(boneDef.color);
      mat.emissiveColor = Color3.FromHexString(boneDef.color).scale(0.5);
      sphere.material = mat;
      sphere.position = fbxRest.clone();
      sphere.isPickable = false;
      sphere.setEnabled(showBonesOnly);
      debugSpheres.push(sphere);
    }

    // デバッグ: 各ボーンの方向矢印を描画
    const debugArrows: Mesh[] = [];
    const arrowLen = 0.8;
    const debugBoneNames = ['LeftArm','LeftForeArm','LeftUpLeg','LeftLeg','LeftHand','Spine','Spine2','Neck','Head','RightArm','RightForeArm','RightUpLeg','RightLeg'];
    for (const boneName of debugBoneNames) {
      const boneDef = BONE_DEFS.find(d => d.name === boneName);
      if (!boneDef?.parent) continue;
      const vChild = boneRestPosRef.current.get(boneDef.name);
      const vParent = boneRestPosRef.current.get(boneDef.parent);
      const fChild = fbxRestViewer.get(boneDef.name);
      const fParent = fbxRestViewer.get(boneDef.parent);
      if (!vChild || !vParent || !fChild || !fParent) continue;

      const vDir = vChild.subtract(vParent).normalize().scale(arrowLen);
      const fDirRaw = fChild.subtract(fParent);
      const fDir = new Vector3(fDirRaw.x, fDirRaw.y, -fDirRaw.z).normalize().scale(arrowLen);
      const origin = vParent.clone();

      const redLine = MeshBuilder.CreateLines(`dbg_vdir_${boneName}`, { points: [origin, origin.add(vDir)] }, scene);
      redLine.color = new Color3(1, 0, 0);
      redLine.isPickable = false;
      redLine.setEnabled(showBonesOnly);
      debugArrows.push(redLine);

      const greenLine = MeshBuilder.CreateLines(`dbg_fdir_${boneName}`, { points: [origin, origin.add(fDir)] }, scene);
      greenLine.color = new Color3(0, 1, 0);
      greenLine.isPickable = false;
      greenLine.setEnabled(showBonesOnly);
      debugArrows.push(greenLine);
    }
    debugSpheres.push(...debugArrows);

    debugBonesRef.current = { spheres: debugSpheres, lines: null };
    const boneToSphereIdx = new Map<string, number>();
    let sIdx = 0;
    for (const boneDef of BONE_DEFS) {
      if (fbxRestViewer.has(boneDef.name)) boneToSphereIdx.set(boneDef.name, sIdx++);
    }

    animTimeRef.current = 0;
    let lastTime = performance.now();
    const frameDuration = 1.0 / clip.fps;

    // クォータニオン変換: Three.js→ビューワー座標系
    const toViewerQuat = (dq: [number, number, number, number]) => {
      switch (quatConv) {
        case 'correct':  return new Quaternion(dq[0], -dq[1], -dq[2], dq[3]);
        case 'conv1':    return new Quaternion(-dq[0], -dq[1], dq[2], dq[3]);
        case 'conv2':    return new Quaternion(dq[0], dq[1], -dq[2], dq[3]);
        case 'identity': return new Quaternion(dq[0], dq[1], dq[2], dq[3]);
      }
    };

    // フレーム適用関数
    const applyFrame = (frameIndex: number) => {
      const frame = clip.frames[frameIndex];

      // ワールド空間クォータニオンを計算
      const worldDqs = new Map<string, Quaternion>();
      for (const boneDef of BONE_DEFS) {
        const data = frame[boneDef.name];
        worldDqs.set(boneDef.name, data ? toViewerQuat(data.dq) : Quaternion.Identity());
      }

      // ワールドdq→ローカル回転に変換
      for (const boneDef of BONE_DEFS) {
        const node = previewNodesRef.current.get(boneDef.name);
        if (!node) continue;
        const worldDq = worldDqs.get(boneDef.name) ?? Quaternion.Identity();
        if (boneDef.parent) {
          const parentWorldDq = worldDqs.get(boneDef.parent) ?? Quaternion.Identity();
          const parentInv = Quaternion.Inverse(parentWorldDq);
          const localDq = parentInv.multiply(worldDq);
          node.rotationQuaternion = localDq;
        } else {
          node.rotationQuaternion = worldDq;
        }
      }

      // Hipsポジション
      const hipsData = frame['Hips'];
      const hipsNode = previewNodesRef.current.get('Hips');
      if (hipsNode && hipsData?.dp) {
        hipsNode.position.x = voxelHipsPos.x + (-hipsData.dp[0]) * scaleFactor;
        hipsNode.position.y = voxelHipsPos.y + hipsData.dp[1] * scaleFactor;
        hipsNode.position.z = voxelHipsPos.z + hipsData.dp[2] * scaleFactor;
      } else if (hipsNode) {
        hipsNode.position.copyFrom(voxelHipsPos);
      }

      // デバッグ: 球体位置とラインを更新
      const debugPositions = new Map<string, Vector3>();
      for (const boneDef of BONE_DEFS) {
        const fbxRest = fbxRestViewer.get(boneDef.name);
        if (!fbxRest) continue;
        const data = frame[boneDef.name];
        if (data?.dp) {
          debugPositions.set(boneDef.name, new Vector3(
            fbxRest.x + (-data.dp[0]) * scaleFactor,
            fbxRest.y + data.dp[1] * scaleFactor,
            fbxRest.z + data.dp[2] * scaleFactor,
          ));
        } else {
          debugPositions.set(boneDef.name, fbxRest.clone());
        }
      }
      const spheres = debugBonesRef.current.spheres;
      for (const boneDef of BONE_DEFS) {
        const idx = boneToSphereIdx.get(boneDef.name);
        if (idx === undefined) continue;
        const pos = debugPositions.get(boneDef.name);
        if (pos && spheres[idx]) spheres[idx].position.copyFrom(pos);
      }
      if (debugBonesRef.current.lines) {
        debugBonesRef.current.lines.dispose();
        debugBonesRef.current.lines = null;
      }
      const linePoints: Vector3[][] = [];
      for (const boneDef of BONE_DEFS) {
        if (!boneDef.parent) continue;
        const childPos = debugPositions.get(boneDef.name);
        const parentPos = debugPositions.get(boneDef.parent);
        if (childPos && parentPos) linePoints.push([parentPos, childPos]);
      }
      if (linePoints.length > 0) {
        const linesMesh = MeshBuilder.CreateLineSystem('dbg_lines', { lines: linePoints }, scene);
        linesMesh.color = new Color3(1, 1, 0);
        linesMesh.isPickable = false;
        linesMesh.setEnabled(showBonesOnly);
        debugBonesRef.current.lines = linesMesh;
      }
    };

    // アニメーションコールバック（毎フレーム実行）
    const callback = () => {
      if (pausedRef.current) return;
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      animTimeRef.current += dt * motionSpeed;
      const loopedTime = animTimeRef.current % clip.duration;
      const frameIndex = Math.min(Math.floor(loopedTime / frameDuration), clip.frameCount - 1);
      setCurrentFrame(frameIndex);
      applyFrame(frameIndex);
    };

    applyFrameRef.current = applyFrame;
    animCallbackRef.current = callback;
    scene.registerBeforeRender(callback);
    setPlayingMotion(clip.name);
  }, [sceneRef, previewNodesRef, debugBonesRef, boneRestPosRef, voxelBodyHeightRef,
      animCallbackRef, animTimeRef, pausedRef, applyFrameRef,
      motionSpeed, quatConv, calculatedBones, showBonesOnly, setCurrentFrame]);

  // モーション再生開始
  // モーション名からクリップを読み込んで再生開始する（UIから呼ばれる）
  const startMotion = useCallback(async (motionName: string) => {
    const clip = await loadMotionClip(motionName);
    if (clip) playMotionClip(clip);
  }, [loadMotionClip, playMotionClip]);

  // 速度/変換方式変更時にアニメーションを再適用
  useEffect(() => {
    if (playingMotion && loadedClips[playingMotion]) {
      playMotionClip(loadedClips[playingMotion]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionSpeed, quatConv, showBonesOnly]);

  // ボクセルメッシュ/デバッグボーンの表示切替
  useEffect(() => {
    const meshes = previewMeshesRef.current;
    const debug = debugBonesRef.current;
    for (const m of meshes.values()) m.setEnabled(!showBonesOnly);
    for (const s of debug.spheres) s.setEnabled(showBonesOnly);
    if (debug.lines) debug.lines.setEnabled(showBonesOnly);
  }, [showBonesOnly, previewMeshesRef, debugBonesRef]);

  return {
    playingMotion,
    loadingMotion,
    loadedClips,
    stopMotion,
    startMotion,
    playMotionClip,
  };
}
