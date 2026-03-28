// クライアントコンポーネント宣言
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, Color4, MeshBuilder, StandardMaterial, Color3, Mesh,
  VertexData, ShaderMaterial, Effect, AbstractMesh,
  SceneLoader,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

// ============================================================
// 型定義
// ============================================================
interface BoneEntry { name: string; parent: string | null; worldPosition: [number, number, number]; }
interface BodyPartDef { bone: string; childBone: string; size: [number, number, number]; thickness: number; skin?: boolean; }
interface CharacterConfig { name: string; bodyParts: Record<string, BodyPartDef>; }
interface BoneData { bones: BoneEntry[]; }
interface GridVoxel { gx: number; gy: number; gz: number; r: number; g: number; b: number; }

// パーツ別ボクセルデータ
interface PerBoneVoxels {
  boneNames: string[];                    // 検出されたボーン名一覧
  perBone: Record<string, GridVoxel[]>;   // ボーン名 → ボクセル配列
  allVoxels: GridVoxel[];                 // 全ボクセル（表示用）
}

// ============================================================
// 定数
// ============================================================
const VOXEL_SIZE = 0.012;
const MIN_RADIUS = VOXEL_SIZE * 0.7;
const SKIN_COLOR = { r: 0.85, g: 0.72, b: 0.60 };
const BODY_COLOR = { r: 0.40, g: 0.50, b: 0.70 };

const FACE_DIRS: number[][] = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const FACE_VERTS: number[][][] = [
  [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], [[0,0,1],[0,1,1],[0,1,0],[0,0,0]],
  [[0,1,0],[0,1,1],[1,1,1],[1,1,0]], [[0,0,1],[0,0,0],[1,0,0],[1,0,1]],
  [[0,0,1],[0,1,1],[1,1,1],[1,0,1]], [[1,0,0],[1,1,0],[0,1,0],[0,0,0]],
];
const FACE_NORMALS: number[][] = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

type BodyCategory = 'head' | 'torso' | 'arm' | 'hand' | 'leg' | 'foot';
const CATEGORY_LABELS: Record<BodyCategory, string> = {
  head: 'Head (頭)', torso: 'Torso (胴体)', arm: 'Arms (腕)',
  hand: 'Hands (手指)', leg: 'Legs (脚)', foot: 'Feet (足)',
};
function getCategory(partName: string): BodyCategory {
  const n = partName.toLowerCase();
  if (n.includes('head') || n.includes('neck')) return 'head';
  if (n.includes('thumb') || n.includes('index') || n.includes('hand')) return 'hand';
  if (n.includes('shoulder') || n.includes('upper_arm') || n.includes('forearm') || n.includes('arm')) return 'arm';
  if (n.includes('toe') || n.includes('foot')) return 'foot';
  if (n.includes('thigh') || n.includes('shin') || n.includes('leg')) return 'leg';
  return 'torso';
}

interface ScaleSettings {
  global: number; head: number; torso: number; arm: number; hand: number; leg: number; foot: number;
}
const DEFAULT_SCALES: ScaleSettings = { global: 1, head: 1, torso: 1, arm: 1, hand: 1, leg: 1, foot: 1 };

// ============================================================
// ボーン色を自動生成（HSLベース、均等分布）
// ============================================================
function generateBoneColors(count: number): { r: number; g: number; b: number }[] {
  const colors: { r: number; g: number; b: number }[] = [];
  for (let i = 0; i < count; i++) {
    const h = (i * 137.508) % 360; // 黄金角で均等分布
    const s = 0.65 + (i % 3) * 0.1;
    const l = 0.55 + (i % 2) * 0.1;
    // HSL→RGB変換
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    colors.push({ r: r + m, g: g + m, b: b + m });
  }
  return colors;
}

// ============================================================
// プリミティブ → ボクセル
// ============================================================
function voxelizeCylinder(
  sx: number, sy: number, sz: number, ex: number, ey: number, ez: number,
  diameter: number, color: { r: number; g: number; b: number },
): GridVoxel[] {
  const radius = Math.max(diameter / 2, MIN_RADIUS);
  const dx = ex - sx, dy = ey - sy, dz = ez - sz;
  const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
  if (len < 0.001) return [];
  const nx = dx/len, ny = dy/len, nz = dz/len, rSq = radius*radius;
  const pad = radius + VOXEL_SIZE;
  const gx0 = Math.floor((Math.min(sx,ex)-pad)/VOXEL_SIZE), gx1 = Math.ceil((Math.max(sx,ex)+pad)/VOXEL_SIZE);
  const gy0 = Math.floor((Math.min(sy,ey)-pad)/VOXEL_SIZE), gy1 = Math.ceil((Math.max(sy,ey)+pad)/VOXEL_SIZE);
  const gz0 = Math.floor((Math.min(sz,ez)-pad)/VOXEL_SIZE), gz1 = Math.ceil((Math.max(sz,ez)+pad)/VOXEL_SIZE);
  const voxels: GridVoxel[] = [];
  for (let gx=gx0;gx<=gx1;gx++){const wx=gx*VOXEL_SIZE;
  for (let gy=gy0;gy<=gy1;gy++){const wy=gy*VOXEL_SIZE;
  for (let gz=gz0;gz<=gz1;gz++){const wz=gz*VOXEL_SIZE;
    const ax=wx-sx,ay=wy-sy,az=wz-sz;const t=ax*nx+ay*ny+az*nz;
    if(t<-VOXEL_SIZE||t>len+VOXEL_SIZE)continue;
    const tc=Math.max(0,Math.min(len,t));
    const cx=sx+nx*tc-wx,cy=sy+ny*tc-wy,cz=sz+nz*tc-wz;
    if(cx*cx+cy*cy+cz*cz<=rSq)voxels.push({gx,gy,gz,r:color.r,g:color.g,b:color.b});
  }}}
  return voxels;
}
function voxelizeBox(
  sx: number, sy: number, sz: number, ex: number, ey: number, ez: number,
  size: [number,number,number], color: { r:number;g:number;b:number },
): GridVoxel[] {
  const dx=ex-sx,dy=ey-sy,dz=ez-sz;const len=Math.sqrt(dx*dx+dy*dy+dz*dz);
  if(len<0.001)return [];
  const ux=dx/len,uy=dy/len,uz=dz/len;
  let rx:number,ry:number,rz:number;
  if(Math.abs(uy)>0.99){rx=uz;ry=0;rz=-ux;}else{rx=-uz;ry=0;rz=ux;}
  const rl=Math.sqrt(rx*rx+ry*ry+rz*rz)||1;rx/=rl;ry/=rl;rz/=rl;
  const fx=uy*rz-uz*ry,fy=uz*rx-ux*rz,fz=ux*ry-uy*rx;
  const hw=Math.max((size[0]>0?size[0]:len)/2,MIN_RADIUS);
  const hh=Math.max((size[1]>0?size[1]:len)/2,MIN_RADIUS);
  const hd=Math.max((size[2]>0?size[2]:len)/2,MIN_RADIUS);
  const mx=(sx+ex)/2,my=(sy+ey)/2,mz=(sz+ez)/2;const extent=hw+hh+hd;
  const gx0=Math.floor((mx-extent)/VOXEL_SIZE),gx1=Math.ceil((mx+extent)/VOXEL_SIZE);
  const gy0=Math.floor((my-extent)/VOXEL_SIZE),gy1=Math.ceil((my+extent)/VOXEL_SIZE);
  const gz0=Math.floor((mz-extent)/VOXEL_SIZE),gz1=Math.ceil((mz+extent)/VOXEL_SIZE);
  const voxels: GridVoxel[]=[];
  for(let gx=gx0;gx<=gx1;gx++){const wx=gx*VOXEL_SIZE-mx;
  for(let gy=gy0;gy<=gy1;gy++){const wy=gy*VOXEL_SIZE-my;
  for(let gz=gz0;gz<=gz1;gz++){const wz=gz*VOXEL_SIZE-mz;
    if(Math.abs(wx*rx+wy*ry+wz*rz)<=hw&&Math.abs(wx*ux+wy*uy+wz*uz)<=hh&&Math.abs(wx*fx+wy*fy+wz*fz)<=hd)
      voxels.push({gx,gy,gz,r:color.r,g:color.g,b:color.b});
  }}}
  return voxels;
}
function voxelizeAllParts(
  config: CharacterConfig, boneMap: Map<string,Vector3>, scales: ScaleSettings,
  skipCategories?: Set<BodyCategory>,
): GridVoxel[] {
  const all:GridVoxel[]=[],dedup=new Set<string>();
  for(const[name,part]of Object.entries(config.bodyParts)){
    if(skipCategories && skipCategories.has(getCategory(name))) continue;
    const bp=boneMap.get(part.bone),cp=boneMap.get(part.childBone);
    if(!bp||!cp||cp.subtract(bp).length()<0.001)continue;
    const s=scales.global*scales[getCategory(name)];const col=part.skin?SKIN_COLOR:BODY_COLOR;
    const pv=part.thickness>0
      ?voxelizeCylinder(bp.x,bp.y,bp.z,cp.x,cp.y,cp.z,part.thickness*s,col)
      :voxelizeBox(bp.x,bp.y,bp.z,cp.x,cp.y,cp.z,[part.size[0]*s,part.size[1]*s,part.size[2]*s],col);
    for(const v of pv){const k=`${v.gx},${v.gy},${v.gz}`;if(!dedup.has(k)){dedup.add(k);all.push(v);}}
  }
  return all;
}

// ============================================================
// ボクセルをcharacter-config.jsonのパーツに分割
// 各ボクセルを最寄りのボーンセグメント(bone→childBone)に割り当て
// ============================================================
function assignVoxelsToBoneParts(
  voxels: GridVoxel[],
  config: CharacterConfig,
  boneMap: Map<string, Vector3>,
): Record<string, GridVoxel[]> {
  // bodyPartsからボーンセグメントを構築
  type Seg = { name: string; ax: number; ay: number; az: number; bx: number; by: number; bz: number };
  const segs: Seg[] = [];
  for (const [name, part] of Object.entries(config.bodyParts)) {
    const bp = boneMap.get(part.bone), cp = boneMap.get(part.childBone);
    if (!bp || !cp) continue;
    segs.push({ name, ax: bp.x, ay: bp.y, az: bp.z, bx: cp.x, by: cp.y, bz: cp.z });
  }

  const result: Record<string, GridVoxel[]> = {};
  for (const s of segs) result[s.name] = [];

  // 各ボクセルのワールド座標を復元して最寄りセグメントに割り当て
  for (const v of voxels) {
    const wx = v.gx * VOXEL_SIZE;
    const wy = v.gy * VOXEL_SIZE;
    const wz = v.gz * VOXEL_SIZE;
    let bestName = segs[0]?.name ?? '';
    let bestDist = Infinity;
    for (const s of segs) {
      const abx = s.bx - s.ax, aby = s.by - s.ay, abz = s.bz - s.az;
      const apx = wx - s.ax, apy = wy - s.ay, apz = wz - s.az;
      const lenSq = abx*abx + aby*aby + abz*abz;
      let t = 0;
      if (lenSq > 1e-8) t = Math.max(0, Math.min(1, (apx*abx + apy*aby + apz*abz) / lenSq));
      const cx = s.ax + abx*t - wx, cy = s.ay + aby*t - wy, cz = s.az + abz*t - wz;
      const d = cx*cx + cy*cy + cz*cz;
      if (d < bestDist) { bestDist = d; bestName = s.name; }
    }
    result[bestName].push(v);
  }

  return result;
}

/** 3Dモデル全体をボクセル化（骨格にアラインメント、テクスチャカラー付き） */
async function voxelizeBodyModel(
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
// アラインメント
// ============================================================
interface AlignInfo { scale: number; tx: number; ty: number; tz: number; }

function computeAlignment(meshes: AbstractMesh[], boneMap: Map<string,Vector3>): AlignInfo {
  let sMinY=Infinity,sMaxY=-Infinity,sMinX=Infinity,sMaxX=-Infinity,sMinZ=Infinity,sMaxZ=-Infinity;
  for(const p of boneMap.values()){
    if(p.x<sMinX)sMinX=p.x;if(p.x>sMaxX)sMaxX=p.x;
    if(p.y<sMinY)sMinY=p.y;if(p.y>sMaxY)sMaxY=p.y;
    if(p.z<sMinZ)sMinZ=p.z;if(p.z>sMaxZ)sMaxZ=p.z;
  }
  const skelH=sMaxY-sMinY,skelCX=(sMinX+sMaxX)/2,skelCZ=(sMinZ+sMaxZ)/2;
  let mMinY=Infinity,mMaxY=-Infinity,mMinX=Infinity,mMaxX=-Infinity,mMinZ=Infinity,mMaxZ=-Infinity;
  for(const m of meshes){
    if(!(m instanceof Mesh))continue;const pos=m.getVerticesData('position');if(!pos)continue;
    const wm=m.getWorldMatrix();
    for(let i=0;i<pos.length;i+=3){
      const v=Vector3.TransformCoordinates(new Vector3(pos[i],pos[i+1],pos[i+2]),wm);
      if(v.x<mMinX)mMinX=v.x;if(v.x>mMaxX)mMaxX=v.x;
      if(v.y<mMinY)mMinY=v.y;if(v.y>mMaxY)mMaxY=v.y;
      if(v.z<mMinZ)mMinZ=v.z;if(v.z>mMaxZ)mMaxZ=v.z;
    }
  }
  const modelH=mMaxY-mMinY,modelCX=(mMinX+mMaxX)/2,modelCZ=(mMinZ+mMaxZ)/2;
  if(modelH<1e-6||skelH<1e-6)return{scale:1,tx:0,ty:0,tz:0};
  const s=skelH/modelH;
  console.log(`[Align] model H=${modelH.toFixed(3)} → skel H=${skelH.toFixed(3)}, scale=${s.toFixed(4)}`);
  return{scale:s,tx:skelCX-modelCX*s,ty:sMinY-mMinY*s,tz:skelCZ-modelCZ*s};
}

// ============================================================
// 3Dモデル → パーツ別ボクセル化（スキニングウェイト使用）
// ============================================================
function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

async function voxelizeMeshesPerBone(
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
  const boneColors = generateBoneColors(Math.max(boneNames.length, 1));

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

// ============================================================
// ボクセルメッシュ構築
// ============================================================
function ensureShader() {
  const sName = 'voxLit';
  if (!Effect.ShadersStore[sName + 'VertexShader']) {
    Effect.ShadersStore[sName + 'VertexShader'] = `precision highp float;
      attribute vec3 position; attribute vec3 normal; attribute vec4 color;
      uniform mat4 worldViewProjection;
      varying vec4 vColor; varying vec3 vNormal;
      void main() { gl_Position = worldViewProjection * vec4(position, 1.0); vColor = color; vNormal = normal; }`;
    Effect.ShadersStore[sName + 'FragmentShader'] = `precision highp float;
      varying vec4 vColor; varying vec3 vNormal;
      void main() {
        vec3 light = normalize(vec3(0.4, 0.8, 0.3));
        float diff = max(0.35, dot(normalize(vNormal), light));
        gl_FragColor = vec4(vColor.rgb * diff, 1.0);
      }`;
  }
}

function buildVoxelMesh(voxels: GridVoxel[], scene: Scene, name: string): Mesh {
  const occ = new Set<string>();
  for (const v of voxels) occ.add(`${v.gx},${v.gy},${v.gz}`);
  const pos: number[]=[], nrm: number[]=[], col: number[]=[], idx: number[]=[];
  for (const v of voxels) {
    for (let f=0;f<6;f++){
      const[dx,dy,dz]=FACE_DIRS[f];
      if(occ.has(`${v.gx+dx},${v.gy+dy},${v.gz+dz}`))continue;
      const bi=pos.length/3,fv=FACE_VERTS[f],fn=FACE_NORMALS[f];
      for(let vi=0;vi<4;vi++){
        pos.push((v.gx+fv[vi][0])*VOXEL_SIZE,(v.gy+fv[vi][1])*VOXEL_SIZE,(v.gz+fv[vi][2])*VOXEL_SIZE);
        nrm.push(fn[0],fn[1],fn[2]);col.push(v.r,v.g,v.b,1);
      }
      idx.push(bi,bi+1,bi+2,bi,bi+2,bi+3);
    }
  }
  ensureShader();
  const mat = new ShaderMaterial(name+'_mat', scene, { vertex:'voxLit', fragment:'voxLit' },
    { attributes:['position','normal','color'], uniforms:['worldViewProjection'], needAlphaBlending:false });
  mat.backFaceCulling=true; mat.forceDepthWrite=true;
  const vd=new VertexData(); vd.positions=pos; vd.normals=nrm; vd.colors=col; vd.indices=idx;
  const mesh=new Mesh(name,scene); vd.applyToMesh(mesh); mesh.material=mat;
  return mesh;
}

/** パーツ色表示用: 各ボクセルの色をボーン色に差し替え */
function applyBoneColors(data: PerBoneVoxels): GridVoxel[] {
  const colors = generateBoneColors(data.boneNames.length);
  const result: GridVoxel[] = [];
  data.boneNames.forEach((bn, i) => {
    const c = colors[i];
    for (const v of data.perBone[bn]) {
      result.push({ ...v, r: c.r, g: c.g, b: c.b });
    }
  });
  return result;
}

function buildBoneMap(bones: BoneEntry[]): Map<string,Vector3> {
  const map = new Map<string,Vector3>();
  for (const b of bones) map.set(b.name, new Vector3(...b.worldPosition));
  return map;
}

// ============================================================
// スライダー
// ============================================================
function ScaleSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'#ccc', marginBottom:2 }}>
        <span>{label}</span>
        <span style={{ color:'#8af', fontFamily:'monospace' }}>{value.toFixed(2)}x</span>
      </div>
      <input type="range" min={0.2} max={3.0} step={0.05} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width:'100%', accentColor:'#5566ff' }} />
    </div>
  );
}

// ============================================================
// メインコンポーネント
// ============================================================
export default function CharacterViewerPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const boneColors = generateBoneColors(detectedBones.length);

  return (
    <div style={{width:'100vw',height:'100vh',background:'#1a1a2e',display:'flex',flexDirection:'column'}}>
      <div style={{padding:'10px 20px',display:'flex',alignItems:'center',gap:16,borderBottom:'1px solid #333'}}>
        <a href="/" style={{color:'#7788ff',textDecoration:'none',fontSize:14}}>← Home</a>
        <h1 style={{color:'#fff',fontSize:18,margin:0}}>Character Body Viewer (Voxel)</h1>
        <span style={{color:'#888',fontSize:13}}>{status}</span>
        {loading && <span style={{color:'#fa0',fontSize:12}}>Processing...</span>}
      </div>

      <div style={{flex:1,display:'flex',overflow:'hidden'}}>
        <div style={{width:280,minWidth:280,background:'#1e1e35',borderRight:'1px solid #333',padding:'12px 14px',overflowY:'auto',display:'flex',flexDirection:'column',gap:4}}>

          <div style={{fontSize:11,color:source==='model'?'#8fc':'#8af',marginBottom:4,padding:'4px 8px',background:'#252545',borderRadius:4}}>
            Source: {source==='model'?`3D Model (${modelFileName})`:'Primitive'}
          </div>

          <input ref={fileInputRef} type="file" accept=".glb,.gltf" style={{display:'none'}}
            onChange={e=>{const f=e.target.files?.[0];if(f)handleFileLoad(f);e.target.value='';}} />
          <button onClick={()=>fileInputRef.current?.click()} disabled={loading}
            style={{padding:'8px',fontSize:12,fontWeight:'bold',cursor:loading?'wait':'pointer',
              background:'#2a4a3a',color:'#8fc',border:'1px solid #4a8a6a',borderRadius:5}}>
            {loading?'Processing...':'Load 3D Model (GLB)'}
          </button>
          {source==='model'&&(
            <button onClick={switchToPrimitive}
              style={{padding:'6px',fontSize:11,cursor:'pointer',background:'#333',color:'#aaa',border:'1px solid #555',borderRadius:4}}>
              Reset to Primitive
            </button>
          )}

          <div style={{borderTop:'1px solid #333',margin:'8px 0'}} />

          {source==='primitive'&&(
            <>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <span style={{color:'#fff',fontSize:14,fontWeight:'bold'}}>Body Scale</span>
                <button onClick={handleReset} style={{background:'#333',color:'#aaa',border:'1px solid #555',borderRadius:4,padding:'2px 10px',fontSize:11,cursor:'pointer'}}>Reset</button>
              </div>
              <ScaleSlider label="Global (全体)" value={scales.global} onChange={v=>handleScaleChange('global',v)} />
              <div style={{borderTop:'1px solid #333',margin:'6px 0'}} />
              {(Object.keys(CATEGORY_LABELS) as BodyCategory[]).map(cat=>(
                <ScaleSlider key={cat} label={CATEGORY_LABELS[cat]} value={scales[cat]} onChange={v=>handleScaleChange(cat,v)} />
              ))}
            </>
          )}

          {source==='model'&&(
            <>
              {/* 色モード切替 */}
              <div style={{display:'flex',gap:4,marginBottom:8}}>
                {(['bone','texture'] as const).map(m=>(
                  <button key={m} onClick={()=>handleColorMode(m)}
                    style={{flex:1,padding:'5px 0',fontSize:11,fontWeight:colorMode===m?'bold':'normal',
                      background:colorMode===m?'#3344aa':'#252545',color:colorMode===m?'#fff':'#888',
                      border:`1px solid ${colorMode===m?'#5566ff':'#444'}`,borderRadius:4,cursor:'pointer'}}>
                    {m==='bone'?'Parts Color':'Texture Color'}
                  </button>
                ))}
              </div>

              {/* 検出ボーン一覧 */}
              <div style={{color:'#fff',fontSize:13,fontWeight:'bold',marginBottom:4}}>
                Detected Parts ({detectedBones.length})
              </div>
              <div style={{maxHeight:300,overflowY:'auto',fontSize:11,lineHeight:1.8}}>
                {detectedBones.map((b,i)=>(
                  <div key={b.name} style={{display:'flex',alignItems:'center',gap:6,color:'#ccc'}}>
                    <span style={{
                      display:'inline-block',width:10,height:10,borderRadius:2,flexShrink:0,
                      background:`rgb(${Math.round(boneColors[i].r*255)},${Math.round(boneColors[i].g*255)},${Math.round(boneColors[i].b*255)})`,
                    }} />
                    <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.name}</span>
                    <span style={{color:'#666',flexShrink:0}}>{b.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{marginTop:'auto',paddingTop:12,borderTop:'1px solid #333',fontSize:11,color:'#666'}}>
            <div>Voxel size: {VOXEL_SIZE}m</div>
            <div>Voxels: {voxelCount.toLocaleString()}</div>
          </div>
        </div>

        <canvas ref={canvasRef} style={{flex:1,outline:'none'}} />
      </div>
    </div>
  );
}
