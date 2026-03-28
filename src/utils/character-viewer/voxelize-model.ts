import {
  Scene, Vector3, Mesh, AbstractMesh, SceneLoader,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import type { GridVoxel, PerBoneVoxels, AlignInfo } from './constants';
import { VOXEL_SIZE } from './constants';
import { clamp01 } from '@/utils/voxel-core';
import { generateBoneColors, computeAlignment } from './voxelize';

/** 3Dモデル全体をボクセル化（骨格にアラインメント、テクスチャカラー付き） */
export async function voxelizeBodyModel(
  scene: Scene, modelUrl: string, boneMap: Map<string,Vector3>,
): Promise<GridVoxel[]> {
  const result = await SceneLoader.ImportMeshAsync('', modelUrl, '', scene, null, '.glb');
  const valid: Mesh[] = [];
  for (const m of result.meshes) {
    if (m.name === '__root__' || !(m instanceof Mesh) || m.getTotalVertices() < 3) {
      m.isPickable = false; m.isVisible = false; continue;
    }
    valid.push(m);
  }
  if (valid.length === 0) { return []; }

  console.log(`[Body] meshes: ${valid.map(m => m.name).join(', ')}`);

  // アラインメント: モデル全体を骨格にスケール+平行移動
  const align = computeAlignment(valid, boneMap);
  const s = align.scale, tx = align.tx, ty = align.ty, tz = align.tz;
  console.log(`[Body] align scale=${s.toFixed(4)}`);

  const step = VOXEL_SIZE * 0.5;
  const set = new Map<string, GridVoxel>();

  for (const mesh of valid) {
    const positions = mesh.getVerticesData('position');
    const indices = mesh.getIndices();
    const uvs = mesh.getVerticesData('uv');
    const vcolors = mesh.getVerticesData('color');
    if (!positions || !indices) continue;
    const wm = mesh.getWorldMatrix();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meshMat = mesh.material as any;
    let flatR=0.7,flatG=0.65,flatB=0.6;
    let texPx:Uint8Array|null=null,texW=0,texH=0,tintR=1,tintG=1,tintB=1;
    if(meshMat){
      const mc=meshMat.albedoColor??meshMat.diffuseColor;
      if(mc&&typeof mc.r==='number'){flatR=mc.r;flatG=mc.g;flatB=mc.b;tintR=mc.r;tintG=mc.g;tintB=mc.b;}
      if(uvs){
        const tex=meshMat.albedoTexture??meshMat.diffuseTexture??meshMat._albedoTexture??meshMat._diffuseTexture;
        if(tex){
          try{
            if(tex.isReady?.()){const sz=tex.getSize();texW=sz.width;texH=sz.height;
              if(texW>0&&texH>0){const raw=await tex.readPixels();
                if(raw){texPx=raw instanceof Float32Array?(() => { const o = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) o[i] = Math.round(clamp01(raw[i]) * 255); return o; })():new Uint8Array(raw.buffer,raw.byteOffset,raw.byteLength);}
              }
            }
          }catch{}
          if(!texPx){try{
            const url:string|undefined=tex.url??tex._texture?.url;
            if(url){const img=new Image();img.crossOrigin='anonymous';
              await new Promise<void>((res,rej)=>{img.onload=()=>res();img.onerror=()=>rej();img.src=url;});
              const c2=document.createElement('canvas');c2.width=img.width;c2.height=img.height;
              const ctx=c2.getContext('2d');
              if(ctx){ctx.drawImage(img,0,0);const id=ctx.getImageData(0,0,c2.width,c2.height);texPx=new Uint8Array(id.data.buffer);texW=c2.width;texH=c2.height;}
            }
          }catch{}}
        }
      }
    }

    for(let ti=0;ti<indices.length;ti+=3){
      const i0=indices[ti],i1=indices[ti+1],i2=indices[ti+2];
      const r0=Vector3.TransformCoordinates(new Vector3(positions[i0*3],positions[i0*3+1],positions[i0*3+2]),wm);
      const r1=Vector3.TransformCoordinates(new Vector3(positions[i1*3],positions[i1*3+1],positions[i1*3+2]),wm);
      const r2=Vector3.TransformCoordinates(new Vector3(positions[i2*3],positions[i2*3+1],positions[i2*3+2]),wm);
      const p0x=r0.x*s+tx,p0y=r0.y*s+ty,p0z=r0.z*s+tz;
      const p1x=r1.x*s+tx,p1y=r1.y*s+ty,p1z=r1.z*s+tz;
      const p2x=r2.x*s+tx,p2y=r2.y*s+ty,p2z=r2.z*s+tz;

      const hasUV=uvs&&texPx;
      const uv0=uvs?[uvs[i0*2],uvs[i0*2+1]]:[0,0];
      const uv1=uvs?[uvs[i1*2],uvs[i1*2+1]]:[0,0];
      const uv2=uvs?[uvs[i2*2],uvs[i2*2+1]]:[0,0];
      const hasVC=!!vcolors;
      const vc0=vcolors?[vcolors[i0*4],vcolors[i0*4+1],vcolors[i0*4+2]]:[0,0,0];
      const vc1=vcolors?[vcolors[i1*4],vcolors[i1*4+1],vcolors[i1*4+2]]:[0,0,0];
      const vc2=vcolors?[vcolors[i2*4],vcolors[i2*4+1],vcolors[i2*4+2]]:[0,0,0];

      const e0=Math.sqrt((p1x-p0x)**2+(p1y-p0y)**2+(p1z-p0z)**2);
      const e1=Math.sqrt((p2x-p1x)**2+(p2y-p1y)**2+(p2z-p1z)**2);
      const e2=Math.sqrt((p0x-p2x)**2+(p0y-p2y)**2+(p0z-p2z)**2);
      const steps=Math.max(1,Math.ceil(Math.max(e0,e1,e2)/step));

      for(let si=0;si<=steps;si++){for(let sj=0;sj<=steps-si;sj++){
        const a=si/steps,b=sj/steps,c=1-a-b;
        const wx=p0x*c+p1x*a+p2x*b,wy=p0y*c+p1y*a+p2y*b,wz=p0z*c+p1z*a+p2z*b;
        let cr:number,cg:number,cb:number;
        if(hasUV&&texPx){
          const su=uv0[0]*c+uv1[0]*a+uv2[0]*b,sv=uv0[1]*c+uv1[1]*a+uv2[1]*b;
          const tu=((su%1)+1)%1,tv=((sv%1)+1)%1;
          const px=Math.min(Math.floor(tu*texW),texW-1),py=Math.min(Math.floor((1-tv)*texH),texH-1);
          const pi=(py*texW+px)*4;
          cr=((texPx[pi]??128)/255)*tintR;cg=((texPx[pi+1]??128)/255)*tintG;cb=((texPx[pi+2]??128)/255)*tintB;
        }else if(hasVC){cr=vc0[0]*c+vc1[0]*a+vc2[0]*b;cg=vc0[1]*c+vc1[1]*a+vc2[1]*b;cb=vc0[2]*c+vc1[2]*a+vc2[2]*b;
        }else{cr=flatR;cg=flatG;cb=flatB;}
        const gx=Math.round(wx/VOXEL_SIZE),gy=Math.round(wy/VOXEL_SIZE),gz=Math.round(wz/VOXEL_SIZE);
        const key=`${gx},${gy},${gz}`;
        if(!set.has(key))set.set(key,{gx,gy,gz,r:clamp01(cr),g:clamp01(cg),b:clamp01(cb)});
      }}
    }
  }

  console.log(`[Body] result: ${set.size} voxels`);

  for (const m of valid) m.dispose();
  for (const m of result.meshes) { try { if (!m.isDisposed()) m.dispose(); } catch {} }

  return Array.from(set.values());
}

// ============================================================
// 3Dモデル → パーツ別ボクセル化（スキニングウェイト使用）
// ============================================================
export async function voxelizeMeshesPerBone(
  meshes: AbstractMesh[], align: AlignInfo,
): Promise<PerBoneVoxels> {
  const as = align.scale, atx = align.tx, aty = align.ty, atz = align.tz;
  const step = VOXEL_SIZE * 0.5;

  // ボーン名リストを収集（スケルトンから）
  let skeleton: import('@babylonjs/core').Skeleton | null = null;
  for (const m of meshes) { if (m.skeleton) { skeleton = m.skeleton; break; } }

  const boneNames: string[] = skeleton
    ? skeleton.bones.map(b => b.name.replace(/^mixamorig:?/i, '').trim() || b.name)
    : [];
  const hasSkeleton = boneNames.length > 0;

  console.log(`[Voxelize] skeleton: ${hasSkeleton ? `${boneNames.length} bones` : 'none'}`);
  if (hasSkeleton) console.log(`[Voxelize] bones: ${boneNames.slice(0, 20).join(', ')}${boneNames.length > 20 ? '...' : ''}`);

  // パーツ別色（ボーンごとに自動色）
  const _boneColors = generateBoneColors(Math.max(boneNames.length, 1));
  void _boneColors; // used for reference, actual coloring done at display time

  // ボーンごとのボクセルマップ: boneName → Map<key, voxel>
  const perBoneMap: Record<string, Map<string, GridVoxel>> = {};
  for (const bn of boneNames) perBoneMap[bn] = new Map();
  const noBoneMap = new Map<string, GridVoxel>(); // スキニングなしメッシュ用

  for (const mesh of meshes) {
    if (!(mesh instanceof Mesh)) continue;
    const positions = mesh.getVerticesData('position');
    const indices = mesh.getIndices();
    const uvs = mesh.getVerticesData('uv');
    const vcolors = mesh.getVerticesData('color');
    if (!positions || !indices) continue;
    const wm = mesh.getWorldMatrix();

    // スキニングデータ読み取り
    const matIndices = mesh.getVerticesData('matricesIndices');
    const matWeights = mesh.getVerticesData('matricesWeights');
    const hasSkin = hasSkeleton && matIndices && matWeights;

    // マテリアルセグメント
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meshMat = mesh.material as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    interface MatSeg { mat: any; idxStart: number; idxEnd: number; }
    const segments: MatSeg[] = [];
    if (mesh.subMeshes && mesh.subMeshes.length > 1 && meshMat?.subMaterials) {
      for (const sm of mesh.subMeshes) segments.push({ mat: meshMat.subMaterials[sm.materialIndex] ?? null, idxStart: sm.indexStart, idxEnd: sm.indexStart + sm.indexCount });
    } else {
      segments.push({ mat: meshMat, idxStart: 0, idxEnd: indices.length });
    }

    for (const seg of segments) {
      // テクスチャ読み取り
      let texPx: Uint8Array | null = null, texW = 0, texH = 0;
      let tintR = 1, tintG = 1, tintB = 1, flatR = 0.6, flatG = 0.6, flatB = 0.6;
      if (seg.mat) {
        const mc = seg.mat.albedoColor ?? seg.mat.diffuseColor;
        if (mc && typeof mc.r === 'number') { tintR = mc.r; tintG = mc.g; tintB = mc.b; flatR = mc.r; flatG = mc.g; flatB = mc.b; }
        if (uvs) {
          const tex = seg.mat.albedoTexture ?? seg.mat.diffuseTexture ?? seg.mat._albedoTexture ?? seg.mat._diffuseTexture;
          if (tex) {
            try {
              if (tex.isReady?.()) {
                const sz = tex.getSize(); texW = sz.width; texH = sz.height;
                if (texW > 0 && texH > 0) {
                  const raw = await tex.readPixels();
                  if (raw) {
                    texPx = raw instanceof Float32Array
                      ? (() => { const o = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) o[i] = Math.round(clamp01(raw[i]) * 255); return o; })()
                      : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
                  }
                }
              }
            } catch { /* ignore */ }
            if (!texPx) {
              try {
                const url: string | undefined = tex.url ?? tex._texture?.url;
                if (url) {
                  const img = new Image(); img.crossOrigin = 'anonymous';
                  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); img.src = url; });
                  const c2 = document.createElement('canvas'); c2.width = img.width; c2.height = img.height;
                  const ctx = c2.getContext('2d');
                  if (ctx) { ctx.drawImage(img, 0, 0); const id = ctx.getImageData(0, 0, c2.width, c2.height); texPx = new Uint8Array(id.data.buffer); texW = c2.width; texH = c2.height; }
                }
              } catch { /* ignore */ }
            }
          }
        }
      }

      // 三角形ラスタライズ
      for (let ti = seg.idxStart; ti < seg.idxEnd; ti += 3) {
        const i0 = indices[ti], i1 = indices[ti+1], i2 = indices[ti+2];

        // ワールド座標 + アラインメント
        const r0 = Vector3.TransformCoordinates(new Vector3(positions[i0*3], positions[i0*3+1], positions[i0*3+2]), wm);
        const r1 = Vector3.TransformCoordinates(new Vector3(positions[i1*3], positions[i1*3+1], positions[i1*3+2]), wm);
        const r2 = Vector3.TransformCoordinates(new Vector3(positions[i2*3], positions[i2*3+1], positions[i2*3+2]), wm);
        const p0x = r0.x*as+atx, p0y = r0.y*as+aty, p0z = r0.z*as+atz;
        const p1x = r1.x*as+atx, p1y = r1.y*as+aty, p1z = r1.z*as+atz;
        const p2x = r2.x*as+atx, p2y = r2.y*as+aty, p2z = r2.z*as+atz;

        // 頂点ごとのボーンインデックス+ウェイト（4影響ずつ）
        let bi0: number[] = [0,0,0,0], bw0: number[] = [1,0,0,0];
        let bi1: number[] = [0,0,0,0], bw1: number[] = [1,0,0,0];
        let bi2: number[] = [0,0,0,0], bw2: number[] = [1,0,0,0];
        if (hasSkin && matIndices && matWeights) {
          bi0 = [matIndices[i0*4], matIndices[i0*4+1], matIndices[i0*4+2], matIndices[i0*4+3]];
          bw0 = [matWeights[i0*4], matWeights[i0*4+1], matWeights[i0*4+2], matWeights[i0*4+3]];
          bi1 = [matIndices[i1*4], matIndices[i1*4+1], matIndices[i1*4+2], matIndices[i1*4+3]];
          bw1 = [matWeights[i1*4], matWeights[i1*4+1], matWeights[i1*4+2], matWeights[i1*4+3]];
          bi2 = [matIndices[i2*4], matIndices[i2*4+1], matIndices[i2*4+2], matIndices[i2*4+3]];
          bw2 = [matWeights[i2*4], matWeights[i2*4+1], matWeights[i2*4+2], matWeights[i2*4+3]];
        }

        // UV
        const hasUV = uvs && texPx;
        const uv0 = uvs ? [uvs[i0*2], uvs[i0*2+1]] : [0,0];
        const uv1 = uvs ? [uvs[i1*2], uvs[i1*2+1]] : [0,0];
        const uv2 = uvs ? [uvs[i2*2], uvs[i2*2+1]] : [0,0];
        const hasVC = !!vcolors;
        const vc0 = vcolors ? [vcolors[i0*4], vcolors[i0*4+1], vcolors[i0*4+2]] : [0,0,0];
        const vc1 = vcolors ? [vcolors[i1*4], vcolors[i1*4+1], vcolors[i1*4+2]] : [0,0,0];
        const vc2 = vcolors ? [vcolors[i2*4], vcolors[i2*4+1], vcolors[i2*4+2]] : [0,0,0];

        const e0 = Math.sqrt((p1x-p0x)**2+(p1y-p0y)**2+(p1z-p0z)**2);
        const e1 = Math.sqrt((p2x-p1x)**2+(p2y-p1y)**2+(p2z-p1z)**2);
        const e2 = Math.sqrt((p0x-p2x)**2+(p0y-p2y)**2+(p0z-p2z)**2);
        const steps = Math.max(1, Math.ceil(Math.max(e0, e1, e2) / step));

        for (let si = 0; si <= steps; si++) {
          for (let sj = 0; sj <= steps - si; sj++) {
            const a = si / steps, b = sj / steps, c = 1 - a - b;
            const wx = p0x*c + p1x*a + p2x*b;
            const wy = p0y*c + p1y*a + p2y*b;
            const wz = p0z*c + p1z*a + p2z*b;

            // 色
            let cr: number, cg: number, cb: number;
            if (hasUV && texPx) {
              const su = uv0[0]*c+uv1[0]*a+uv2[0]*b, sv = uv0[1]*c+uv1[1]*a+uv2[1]*b;
              const tu = ((su%1)+1)%1, tv = ((sv%1)+1)%1;
              const px = Math.min(Math.floor(tu*texW), texW-1), py = Math.min(Math.floor((1-tv)*texH), texH-1);
              const pi = (py*texW+px)*4;
              cr=((texPx[pi]??128)/255)*tintR; cg=((texPx[pi+1]??128)/255)*tintG; cb=((texPx[pi+2]??128)/255)*tintB;
            } else if (hasVC) {
              cr=vc0[0]*c+vc1[0]*a+vc2[0]*b; cg=vc0[1]*c+vc1[1]*a+vc2[1]*b; cb=vc0[2]*c+vc1[2]*a+vc2[2]*b;
            } else { cr=flatR; cg=flatG; cb=flatB; }

            // ボーン割り当て: 3頂点のウェイトを重心補間して最大ウェイトのボーンを選択
            let bestBone = -1;
            if (hasSkin) {
              const accum = new Map<number, number>();
              for (let k = 0; k < 4; k++) {
                const w0 = bw0[k] * c, w1 = bw1[k] * a, w2 = bw2[k] * b;
                if (w0 > 0.001) accum.set(bi0[k], (accum.get(bi0[k]) ?? 0) + w0);
                if (w1 > 0.001) accum.set(bi1[k], (accum.get(bi1[k]) ?? 0) + w1);
                if (w2 > 0.001) accum.set(bi2[k], (accum.get(bi2[k]) ?? 0) + w2);
              }
              let bestW = -1;
              for (const [bi, w] of accum) { if (w > bestW) { bestW = w; bestBone = bi; } }
            }

            const gx = Math.round(wx / VOXEL_SIZE), gy = Math.round(wy / VOXEL_SIZE), gz = Math.round(wz / VOXEL_SIZE);
            const key = `${gx},${gy},${gz}`;
            const voxel: GridVoxel = { gx, gy, gz, r: clamp01(cr), g: clamp01(cg), b: clamp01(cb) };

            if (bestBone >= 0 && bestBone < boneNames.length) {
              const bn = boneNames[bestBone];
              const bm = perBoneMap[bn];
              if (bm && !bm.has(key)) bm.set(key, voxel);
            } else {
              if (!noBoneMap.has(key)) noBoneMap.set(key, voxel);
            }
          }
        }
      }
    }
  }

  // 結果組み立て
  const perBone: Record<string, GridVoxel[]> = {};
  const allVoxels: GridVoxel[] = [];
  const activeBoneNames: string[] = [];

  for (const bn of boneNames) {
    const map = perBoneMap[bn];
    if (map.size === 0) continue;
    perBone[bn] = Array.from(map.values());
    activeBoneNames.push(bn);
    allVoxels.push(...perBone[bn]);
  }
  if (noBoneMap.size > 0) {
    const unassigned = Array.from(noBoneMap.values());
    perBone['__unassigned'] = unassigned;
    activeBoneNames.push('__unassigned');
    allVoxels.push(...unassigned);
  }

  console.log(`[Voxelize] ${activeBoneNames.length} active bones, ${allVoxels.length} total voxels`);
  for (const bn of activeBoneNames) console.log(`  ${bn}: ${perBone[bn].length} voxels`);

  return { boneNames: activeBoneNames, perBone, allVoxels };
}
