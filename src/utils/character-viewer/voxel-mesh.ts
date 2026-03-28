import {
  Scene, Mesh, VertexData, ShaderMaterial, Effect, Vector3,
} from '@babylonjs/core';
import type { GridVoxel, BoneEntry, PerBoneVoxels } from './types';
import { VOXEL_SIZE, FACE_DIRS, FACE_VERTS, FACE_NORMALS } from './constants';

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
