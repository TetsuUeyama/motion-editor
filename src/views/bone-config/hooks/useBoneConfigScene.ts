/**
 * Babylon.jsエンジン・シーンの初期化とマーカードラッグ操作を管理するフック
 * マウント時に1回だけ実行し、シーン、カメラ、ライト、グラウンド、PointerEventsを設定する
 */
import { useEffect } from 'react';
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight,
  Vector3, Color4,
  MeshBuilder, StandardMaterial, Color3, Plane, PointerEventTypes,
} from '@babylonjs/core';
import { mirrorMarker, type MarkerData } from '@/utils/voxel-skeleton';
import {
  MARKER_DEFS, VIEW_DEFS, viewerToVoxel,
} from '@/utils/bone-config/constants';
import type { useBoneConfigRefs } from './useBoneConfigRefs';

interface SceneHookParams {
  refs: ReturnType<typeof useBoneConfigRefs>;
  setMarkers: React.Dispatch<React.SetStateAction<MarkerData>>;
  setDirty: (v: boolean) => void;
  setSelectedMarker: (name: string) => void;
  setTab: (tab: 'markers' | 'bones') => void;
}

export function useBoneConfigScene({
  refs, setMarkers, setDirty, setSelectedMarker, setTab,
}: SceneHookParams) {
  const {
    canvasRef, sceneRef, cameraRef,
    centerRef, draggingRef, viewRef, autoMirrorRef,
  } = refs;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.10, 0.10, 0.16, 1);

    const ground = MeshBuilder.CreateGround('ground', { width: 4, height: 4 }, scene);
    const gMat = new StandardMaterial('gMat', scene);
    gMat.diffuseColor = new Color3(0.2, 0.2, 0.25);
    gMat.alpha = 0.3; gMat.wireframe = true;
    ground.material = gMat;
    ground.isPickable = false;

    const camera = new ArcRotateCamera('cam', Math.PI / 2, Math.PI / 2, 2.5, new Vector3(0, 0.5, 0), scene);
    camera.lowerRadiusLimit = 0.5; camera.upperRadiusLimit = 8; camera.wheelPrecision = 80;
    camera.inputs.clear();
    camera.inputs.addMouseWheel();
    cameraRef.current = camera;

    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.5;

    // --- Drag & drop ---
    scene.onPointerObservable.add((pointerInfo) => {
      const { cx, cy } = centerRef.current;
      const currentView = VIEW_DEFS.find(v => v.key === viewRef.current)!;

      switch (pointerInfo.type) {
        case PointerEventTypes.POINTERDOWN: {
          const pickResult = scene.pick(scene.pointerX, scene.pointerY);
          if (pickResult?.hit && pickResult.pickedMesh?.metadata?.markerName) {
            const markerName = pickResult.pickedMesh.metadata.markerName as string;
            const meshPos = pickResult.pickedMesh.position;
            const cameraDir = camera.position.subtract(camera.target).normalize();
            const dragPlane = Plane.FromPositionAndNormal(meshPos, cameraDir);
            const pickPoint = pickResult.pickedPoint!;
            const offset = meshPos.subtract(pickPoint);
            draggingRef.current = { markerName, plane: dragPlane, offset };
            setSelectedMarker(markerName);
            setTab('markers');
          }
          break;
        }
        case PointerEventTypes.POINTERMOVE: {
          if (!draggingRef.current) break;
          const { markerName, plane, offset } = draggingRef.current;

          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, null, camera);
          const denom = Vector3.Dot(ray.direction, plane.normal);
          if (Math.abs(denom) < 1e-6) break;
          const t = -(Vector3.Dot(ray.origin, plane.normal) + plane.d) / denom;
          if (t < 0) break;
          const hitPoint = ray.origin.add(ray.direction.scale(t)).add(offset);
          const newVox = viewerToVoxel(hitPoint, cx, cy);

          setMarkers(prev => {
            const old = prev[markerName];
            const updated = { ...old };

            if (currentView.dragAxes.includes('x')) {
              updated.x = Math.max(0, Math.min(85, Math.round(newVox.x * 2) / 2));
            }
            if (currentView.dragAxes.includes('y')) {
              updated.y = Math.max(0, Math.min(34, Math.round(newVox.y * 2) / 2));
            }
            if (currentView.dragAxes.includes('z')) {
              updated.z = Math.max(0, Math.min(103, Math.round(newVox.z * 2) / 2));
            }

            let next = { ...prev, [markerName]: updated };

            // Auto-mirror: if editing a left marker, sync right
            if (autoMirrorRef.current) {
              const mDef = MARKER_DEFS.find(m => m.name === markerName);
              if (mDef?.side === 'left') {
                const rightName = MARKER_DEFS.find(m => m.mirrorOf === markerName)?.name;
                if (rightName) {
                  const mcx = (next['Chin'].x + next['Groin'].x) / 2;
                  next[rightName] = mirrorMarker(updated, mcx);
                }
              }
              // If editing Chin or Groin (center changes), re-mirror all
              if (markerName === 'Chin' || markerName === 'Groin') {
                const mcx = (next['Chin'].x + next['Groin'].x) / 2;
                next['RightWrist'] = mirrorMarker(next['LeftWrist'], mcx);
                next['RightElbow'] = mirrorMarker(next['LeftElbow'], mcx);
                next['RightKnee']  = mirrorMarker(next['LeftKnee'], mcx);
              }
            }

            return next;
          });
          setDirty(true);
          break;
        }
        case PointerEventTypes.POINTERUP: {
          if (draggingRef.current) {
            draggingRef.current = null;
          }
          break;
        }
      }
    });

    sceneRef.current = scene;
    engine.runRenderLoop(() => scene.render());
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);

    return () => { window.removeEventListener('resize', onResize); engine.dispose(); };
  }, []);
}
