// クライアントコンポーネント宣言
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, Color4, MeshBuilder, StandardMaterial, Color3, Mesh,
  AbstractMesh, SceneLoader,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

import type { CharacterConfig, BoneData, GridVoxel, ScaleSettings, PerBoneVoxels } from '@/utils/character-viewer/types';
import { DEFAULT_SCALES } from '@/utils/character-viewer/constants';
import { voxelizeAllParts } from '@/utils/character-viewer/voxelize';
import { buildVoxelMesh, applyBoneColors, buildBoneMap, generateBoneColors } from '@/utils/character-viewer/voxel-mesh';
import { computeAlignment, assignVoxelsToBoneParts } from '@/utils/character-viewer/alignment';
import { voxelizeBodyModel, voxelizeMeshesPerBone } from '@/utils/character-viewer/voxelize-model';
import { Sidebar } from '@/components/character-viewer/Sidebar';
import EditorLayout from '@/templates/EditorLayout';

// ============================================================
// メインコンポーネント
// ============================================================
export default function CharacterViewerView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('Loading...');
  const [voxelCount, setVoxelCount] = useState(0);
  const [scales, setScales] = useState<ScaleSettings>({...DEFAULT_SCALES});
  const [source, setSource] = useState<'primitive'|'model'>('primitive');
  const [modelFileName, setModelFileName] = useState<string|null>(null);
  const [loading, setLoading] = useState(false);
  const [colorMode, setColorMode] = useState<'texture'|'bone'>('bone');
  const [detectedBones, setDetectedBones] = useState<{name:string;count:number}[]>([]);

  const sceneRef = useRef<Scene|null>(null);
  const configRef = useRef<CharacterConfig|null>(null);
  const boneMapRef = useRef<Map<string,Vector3>|null>(null);
  const meshRef = useRef<Mesh|null>(null);
  const loadedMeshesRef = useRef<AbstractMesh[]>([]);
  const perBoneDataRef = useRef<PerBoneVoxels|null>(null);
  const rebuildTimerRef = useRef<number|null>(null);

  const disposeMesh = useCallback(() => {
    if (meshRef.current) { meshRef.current.material?.dispose(); meshRef.current.dispose(); meshRef.current = null; }
  }, []);
  const disposeLoaded = useCallback(() => {
    for (const m of loadedMeshesRef.current) { try{m.dispose();}catch{} }
    loadedMeshesRef.current = [];
  }, []);

  // プリミティブ再ボクセル化
  const rebuildPrimitive = useCallback((newScales: ScaleSettings) => {
    const scene=sceneRef.current,config=configRef.current,boneMap=boneMapRef.current;
    if(!scene||!config||!boneMap)return;
    disposeMesh();
    const t0=performance.now();
    const voxels=voxelizeAllParts(config,boneMap,newScales);
    meshRef.current=buildVoxelMesh(voxels,scene,'vox_'+Date.now());
    const ms=(performance.now()-t0).toFixed(0);
    setVoxelCount(voxels.length);setStatus(`${voxels.length.toLocaleString()} voxels (${ms}ms)`);
  },[disposeMesh]);

  // モデルボクセルの表示更新（色モード切替時）
  const rebuildModelDisplay = useCallback((mode: 'texture'|'bone') => {
    const scene=sceneRef.current,data=perBoneDataRef.current;
    if(!scene||!data)return;
    disposeMesh();
    const voxels = mode === 'bone' ? applyBoneColors(data) : data.allVoxels;
    meshRef.current = buildVoxelMesh(voxels, scene, 'vox_'+Date.now());
    setVoxelCount(voxels.length);
  },[disposeMesh]);

  const handleScaleChange = useCallback((key: keyof ScaleSettings, value: number) => {
    setScales(prev => {
      const next={...prev,[key]:value};
      if(rebuildTimerRef.current)clearTimeout(rebuildTimerRef.current);
      rebuildTimerRef.current=window.setTimeout(()=>rebuildPrimitive(next),50);
      return next;
    });
  },[rebuildPrimitive]);
  const handleReset = useCallback(() => {
    const d={...DEFAULT_SCALES};setScales(d);rebuildPrimitive(d);
  },[rebuildPrimitive]);
  const switchToPrimitive = useCallback(() => {
    disposeLoaded();perBoneDataRef.current=null;setSource('primitive');setModelFileName(null);
    setDetectedBones([]);rebuildPrimitive(scales);
  },[disposeLoaded,rebuildPrimitive,scales]);

  // 3Dモデル読み込み → パーツ別ボクセル化
  const handleFileLoad = useCallback(async(file: File)=>{
    const scene=sceneRef.current,boneMap=boneMapRef.current;
    if(!scene||!boneMap)return;
    setLoading(true);setModelFileName(file.name);setStatus('Loading model...');
    disposeMesh();disposeLoaded();perBoneDataRef.current=null;

    try{
      const url=URL.createObjectURL(file);
      const ext=file.name.split('.').pop()?.toLowerCase()??'';
      if(ext!=='glb'&&ext!=='gltf')throw new Error(`Unsupported: .${ext}`);
      const result=await SceneLoader.ImportMeshAsync('',url,'',scene,null,'.glb');
      URL.revokeObjectURL(url);

      const valid: AbstractMesh[]=[];
      for(const m of result.meshes){
        if(m.name==='__root__'||!(m instanceof Mesh)||m.getTotalVertices()<3){m.isPickable=false;m.isVisible=false;continue;}
        valid.push(m);
      }
      loadedMeshesRef.current=valid;

      setStatus(`Analyzing ${valid.length} meshes...`);
      await new Promise(r=>setTimeout(r,30));

      const align=computeAlignment(valid,boneMap);

      setStatus('Voxelizing per bone...');
      await new Promise(r=>setTimeout(r,30));

      const t0=performance.now();
      const data=await voxelizeMeshesPerBone(valid,align);
      perBoneDataRef.current=data;
      const ms=(performance.now()-t0).toFixed(0);

      // 元メッシュ非表示
      for(const m of valid)m.isVisible=false;

      // ボーン色で表示
      const voxels = colorMode === 'bone' ? applyBoneColors(data) : data.allVoxels;
      meshRef.current=buildVoxelMesh(voxels,scene,'voxModel_'+Date.now());
      setVoxelCount(data.allVoxels.length);
      setSource('model');
      setDetectedBones(data.boneNames.map(bn=>({name:bn,count:data.perBone[bn].length})));
      setStatus(`${data.allVoxels.length.toLocaleString()} voxels, ${data.boneNames.length} parts (${ms}ms)`);
    }catch(err){console.error(err);setStatus('Error: '+(err as Error).message);}
    setLoading(false);
  },[disposeMesh,disposeLoaded,colorMode]);

  // 色モード切替
  const handleColorMode = useCallback((mode: 'texture'|'bone') => {
    setColorMode(mode);
    if (source === 'model') rebuildModelDisplay(mode);
  }, [source, rebuildModelDisplay]);

  // シーン初期化
  useEffect(()=>{
    if(!canvasRef.current)return;
    const canvas=canvasRef.current;
    const engine=new Engine(canvas,true,{preserveDrawingBuffer:true});
    const scene=new Scene(engine);scene.clearColor=new Color4(0.1,0.1,0.15,1);
    sceneRef.current=scene;
    const camera=new ArcRotateCamera('cam',Math.PI/2,Math.PI/3,3,new Vector3(0,1,0),scene);
    camera.attachControl(canvas,true);camera.lowerRadiusLimit=0.5;camera.upperRadiusLimit=10;camera.wheelPrecision=50;
    new HemisphericLight('h',new Vector3(0,1,0),scene).intensity=0.6;
    new DirectionalLight('d',new Vector3(-1,-2,1),scene).intensity=0.5;
    const ground=MeshBuilder.CreateGround('ground',{width:4,height:4,subdivisions:20},scene);
    const gm=new StandardMaterial('gm',scene);gm.diffuseColor=new Color3(0.2,0.2,0.25);gm.alpha=0.5;gm.wireframe=true;ground.material=gm;

    let disposed=false;
    (async()=>{
      try{
        setStatus('Loading data...');
        const[cr,br]=await Promise.all([
          fetch('/api/game-assets/characters/mixamo-ybot/character-config.json'),
          fetch('/api/game-assets/characters/mixamo-ybot/bone-data.json'),
        ]);
        if(!cr.ok||!br.ok){setStatus('Failed');return;}
        const config:CharacterConfig=await cr.json();
        const boneData:BoneData=await br.json();
        if(disposed)return;
        const boneMap=buildBoneMap(boneData.bones);
        configRef.current=config;boneMapRef.current=boneMap;

        // 3Dモデルを全身ボクセル化
        setStatus('Loading body model...');
        let modelVoxels: GridVoxel[] = [];
        try {
          modelVoxels = await voxelizeBodyModel(scene, '/api/game-assets/characters/mixamo-ybot/face.glb', boneMap);
          console.log(`[Init] model voxels: ${modelVoxels.length}`);
        } catch (e) {
          console.warn('Body model load failed, using primitives:', e);
        }

        if (modelVoxels.length > 0) {
          // ボクセルをボーンセグメントでパーツ分割
          setStatus('Assigning voxels to bones...');
          const partResult = assignVoxelsToBoneParts(modelVoxels, config, boneMap);
          console.log(`[Init] ${Object.keys(partResult).length} parts assigned`);
          for (const [name, voxels] of Object.entries(partResult)) {
            if (voxels.length > 0) console.log(`  ${name}: ${voxels.length} voxels`);
          }

          // パーツ別色分け表示用にボーン色を適用
          const allVoxels: GridVoxel[] = [];
          const partNames = Object.keys(partResult).filter(k => partResult[k].length > 0);
          const colors = generateBoneColors(partNames.length);
          partNames.forEach((name, i) => {
            const c = colors[i];
            for (const v of partResult[name]) {
              allVoxels.push({ ...v, r: c.r, g: c.g, b: c.b });
            }
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
      }catch(err){console.error(err);setStatus('Error: '+(err as Error).message);}
    })();
    engine.runRenderLoop(()=>scene.render());
    const onResize=()=>engine.resize();window.addEventListener('resize',onResize);
    return()=>{disposed=true;sceneRef.current=null;configRef.current=null;boneMapRef.current=null;meshRef.current=null;loadedMeshesRef.current=[];window.removeEventListener('resize',onResize);engine.dispose();};
  },[]);

  const header = (
    <div style={{padding:'10px 20px',display:'flex',alignItems:'center',gap:16,borderBottom:'1px solid #333'}}>
      <a href="/" style={{color:'#7788ff',textDecoration:'none',fontSize:14}}>← Home</a>
      <h1 style={{color:'#fff',fontSize:18,margin:0}}>Character Body Viewer (Voxel)</h1>
      <span style={{color:'#888',fontSize:13}}>{status}</span>
      {loading && <span style={{color:'#fa0',fontSize:12}}>Processing...</span>}
    </div>
  );

  const sidebar = (
    <Sidebar
      source={source}
      modelFileName={modelFileName}
      loading={loading}
      scales={scales}
      colorMode={colorMode}
      detectedBones={detectedBones}
      voxelCount={voxelCount}
      onFileLoad={handleFileLoad}
      onSwitchToPrimitive={switchToPrimitive}
      onScaleChange={handleScaleChange}
      onReset={handleReset}
      onColorMode={handleColorMode}
    />
  );

  return (
    <EditorLayout
      ref={canvasRef}
      header={header}
      sidebar={sidebar}
      sidebarWidth={280}
    />
  );
}
