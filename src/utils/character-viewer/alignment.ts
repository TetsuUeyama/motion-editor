import { Vector3, Mesh, AbstractMesh } from '@babylonjs/core';
import type { GridVoxel, CharacterConfig, AlignInfo } from './types';
import { VOXEL_SIZE } from './constants';

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
