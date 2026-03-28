import { Vector3 } from '@babylonjs/core';
import type { GridVoxel, CharacterConfig, BodyCategory, ScaleSettings } from './types';
import { VOXEL_SIZE, MIN_RADIUS, SKIN_COLOR, BODY_COLOR, getCategory } from './constants';

// ============================================================
// ユーティリティ
// ============================================================
export function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

// ============================================================
// プリミティブ → ボクセル
// ============================================================
export function voxelizeCylinder(
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

export function voxelizeBox(
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

export function voxelizeAllParts(
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
