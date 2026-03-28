import {
  Vector3, Scene, Mesh, VertexData, ShaderMaterial, Effect, AbstractMesh,
} from '@babylonjs/core';
import type { GridVoxel, CharacterConfig, BodyCategory, ScaleSettings, AlignInfo, BoneEntry, PerBoneVoxels } from '@/utils/character-viewer/constants';
import { VOXEL_SIZE, MIN_RADIUS, SKIN_COLOR, BODY_COLOR, getCategory } from '@/utils/character-viewer/constants';
import { FACE_DIRS, FACE_VERTS, FACE_NORMALS } from './core';

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

// ============================================================
// ボーン色を自動生成（HSLベース、均等分布）
// ============================================================
export function generateBoneColors(count: number): { r: number; g: number; b: number }[] {
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
// ボクセルメッシュ構築
// ============================================================
export function ensureShader() {
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

export function buildVoxelMesh(voxels: GridVoxel[], scene: Scene, name: string): Mesh {
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
export function applyBoneColors(data: PerBoneVoxels): GridVoxel[] {
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

export function buildBoneMap(bones: BoneEntry[]): Map<string,Vector3> {
  const map = new Map<string,Vector3>();
  for (const b of bones) map.set(b.name, new Vector3(...b.worldPosition));
  return map;
}

// ============================================================
// アラインメント
// ============================================================
export function computeAlignment(meshes: AbstractMesh[], boneMap: Map<string,Vector3>): AlignInfo {
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
// ボクセルをcharacter-config.jsonのパーツに分割
// 各ボクセルを最寄りのボーンセグメント(bone→childBone)に割り当て
// ============================================================
export function assignVoxelsToBoneParts(
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
