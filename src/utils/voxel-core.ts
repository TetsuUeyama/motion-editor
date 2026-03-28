/**
 * voxel-core.ts
 * ボクセルスケルトンの共通基盤
 * auto-rigger.ts と voxel-skeleton.ts の両方が使用する
 * 型定義・定数・関数をここに集約する（唯一の情報源）
 *
 * 含まれるもの:
 *   - 型: VoxelEntry, Vec3, BoneDef, BoneFrameData, MotionClip
 *   - 定数: BONE_DEFS (41 Mixamo bones), FACE_DIRS, FACE_VERTS, FACE_NORMALS
 *   - 座標変換: voxelToViewer, threeQuatToViewer
 *   - ボクセル→ボーン: distToSegSq, assignVoxelsToBones, addSphereCaps
 *   - メッシュ構築: createUnlitMaterial, buildBoneMeshLocal, buildSkeletalCharacter
 */

import {
  Scene, Mesh, VertexData, ShaderMaterial, Effect,
  TransformNode, Vector3, Quaternion,
} from '@babylonjs/core';

// ============================================================
// 型定義
// ============================================================
// ボクセル1個のデータ（座標 + RGB色、0-1正規化）
export interface VoxelEntry { x: number; y: number; z: number; r: number; g: number; b: number; }
// 3次元座標（ボクセル空間: X=右, Y=奥行き, Z=上）
export interface Vec3 { x: number; y: number; z: number; }
// ボーン1本の定義（名前、表示ラベル、親ボーン名、UI色）
export interface BoneDef { name: string; label: string; parent: string | null; color: string; }

// 1フレーム中の1ボーンのアニメーションデータ
export interface BoneFrameData {
  dq: [number, number, number, number]; // デルタクォータニオン [x,y,z,w]（ワールド空間、Three.js座標系）
  dp?: [number, number, number];        // デルタポジション [x,y,z]（Hipsのみ使用）
}
// モーションクリップ全体のデータ
export interface MotionClip {
  name: string; label: string; duration: number; fps: number; frameCount: number;
  fbxBodyHeight: number;
  outputBones: string[];
  bindWorldPositions?: Record<string, [number, number, number]>;
  frames: Record<string, BoneFrameData>[];
}

// ============================================================
// ボーン定義（Mixamo標準41ボーン）
// ============================================================
export const BONE_DEFS: BoneDef[] = [
  { name: 'Hips',           label: 'Hips',       parent: null,             color: '#ff4444' },
  { name: 'Spine',          label: 'Spine',      parent: 'Hips',           color: '#ff6644' },
  { name: 'Spine1',         label: 'Spine1',     parent: 'Spine',          color: '#ff8844' },
  { name: 'Spine2',         label: 'Spine2',     parent: 'Spine1',         color: '#ffaa44' },
  { name: 'Neck',           label: 'Neck',       parent: 'Spine2',         color: '#ffcc44' },
  { name: 'Head',           label: 'Head',       parent: 'Neck',           color: '#ffee44' },
  { name: 'LeftShoulder',   label: 'L.Shoulder', parent: 'Spine2',         color: '#44aaff' },
  { name: 'LeftArm',        label: 'L.Arm',      parent: 'LeftShoulder',   color: '#4488ff' },
  { name: 'LeftForeArm',    label: 'L.ForeArm',  parent: 'LeftArm',        color: '#4466ff' },
  { name: 'LeftHand',       label: 'L.Hand',     parent: 'LeftForeArm',    color: '#4444ff' },
  { name: 'LeftHandThumb1', label: 'L.Thumb1',   parent: 'LeftHand',       color: '#5555ff' },
  { name: 'LeftHandThumb2', label: 'L.Thumb2',   parent: 'LeftHandThumb1', color: '#5555ee' },
  { name: 'LeftHandThumb3', label: 'L.Thumb3',   parent: 'LeftHandThumb2', color: '#5555dd' },
  { name: 'LeftHandThumb4', label: 'L.Thumb4',   parent: 'LeftHandThumb3', color: '#5555cc' },
  { name: 'LeftHandIndex1', label: 'L.Index1',   parent: 'LeftHand',       color: '#6666ff' },
  { name: 'LeftHandIndex2', label: 'L.Index2',   parent: 'LeftHandIndex1', color: '#6666ee' },
  { name: 'LeftHandIndex3', label: 'L.Index3',   parent: 'LeftHandIndex2', color: '#6666dd' },
  { name: 'LeftHandIndex4', label: 'L.Index4',   parent: 'LeftHandIndex3', color: '#6666cc' },
  { name: 'RightShoulder',  label: 'R.Shoulder', parent: 'Spine2',         color: '#ff44aa' },
  { name: 'RightArm',       label: 'R.Arm',      parent: 'RightShoulder',  color: '#ff4488' },
  { name: 'RightForeArm',   label: 'R.ForeArm',  parent: 'RightArm',       color: '#ff4466' },
  { name: 'RightHand',      label: 'R.Hand',     parent: 'RightForeArm',   color: '#ff4444' },
  { name: 'RightHandThumb1',label: 'R.Thumb1',   parent: 'RightHand',      color: '#ff5555' },
  { name: 'RightHandThumb2',label: 'R.Thumb2',   parent: 'RightHandThumb1',color: '#ee5555' },
  { name: 'RightHandThumb3',label: 'R.Thumb3',   parent: 'RightHandThumb2',color: '#dd5555' },
  { name: 'RightHandThumb4',label: 'R.Thumb4',   parent: 'RightHandThumb3',color: '#cc5555' },
  { name: 'RightHandIndex1',label: 'R.Index1',   parent: 'RightHand',      color: '#ff6666' },
  { name: 'RightHandIndex2',label: 'R.Index2',   parent: 'RightHandIndex1',color: '#ee6666' },
  { name: 'RightHandIndex3',label: 'R.Index3',   parent: 'RightHandIndex2',color: '#dd6666' },
  { name: 'RightHandIndex4',label: 'R.Index4',   parent: 'RightHandIndex3',color: '#cc6666' },
  { name: 'LeftUpLeg',      label: 'L.UpLeg',    parent: 'Hips',           color: '#44ff88' },
  { name: 'LeftLeg',        label: 'L.Leg',      parent: 'LeftUpLeg',      color: '#44ff66' },
  { name: 'LeftFoot',       label: 'L.Foot',     parent: 'LeftLeg',        color: '#44ff44' },
  { name: 'LeftToeBase',    label: 'L.ToeBase',  parent: 'LeftFoot',       color: '#44ee44' },
  { name: 'LeftToe_End',    label: 'L.ToeEnd',   parent: 'LeftToeBase',    color: '#44dd44' },
  { name: 'RightUpLeg',     label: 'R.UpLeg',    parent: 'Hips',           color: '#aaff44' },
  { name: 'RightLeg',       label: 'R.Leg',      parent: 'RightUpLeg',     color: '#88ff44' },
  { name: 'RightFoot',      label: 'R.Foot',     parent: 'RightLeg',       color: '#66ff44' },
  { name: 'RightToeBase',   label: 'R.ToeBase',  parent: 'RightFoot',      color: '#55ee44' },
  { name: 'RightToe_End',   label: 'R.ToeEnd',   parent: 'RightToeBase',   color: '#55dd44' },
];

// ============================================================
// メッシュ構築用定数
// ============================================================
// 6方向の隣接ボクセルオフセット（+X,-X,+Y,-Y,+Z,-Z）フェイスカリング用
export const FACE_DIRS: number[][] = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
// 各面の4頂点座標（ボクセルローカル0-1範囲）順序: +X,-X,+Y,-Y,+Z,-Z
export const FACE_VERTS: number[][][] = [
  [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], [[0,0,1],[0,1,1],[0,1,0],[0,0,0]],
  [[0,1,0],[0,1,1],[1,1,1],[1,1,0]], [[0,0,1],[0,0,0],[1,0,0],[1,0,1]],
  [[0,0,1],[0,1,1],[1,1,1],[1,0,1]], [[1,0,0],[1,1,0],[0,1,0],[0,0,0]],
];
// 各面の法線ベクトル
export const FACE_NORMALS: number[][] = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

// ============================================================
// 座標変換
// ============================================================
// ボクセル空間→ビューワー空間（Babylon.js）
// X=右, Y=上(voxZ), Z=手前(-voxY)
export function voxelToViewer(vx: number, vy: number, vz: number, cx: number, cy: number): Vector3 {
  return new Vector3((vx - cx) * 0.01, vz * 0.01, -(vy - cy) * 0.01);
}

// Three.jsクォータニオン→ビューワー座標系に変換
export function threeQuatToViewer(dq: [number, number, number, number]): Quaternion {
  return new Quaternion(dq[0], -dq[1], -dq[2], dq[3]);
}

// ============================================================
// 点→線分距離（二乗）
// ============================================================
// 点P(px,py,pz)から線分A(ax,ay,az)-B(bx,by,bz)までの距離の二乗を返す
// ボクセルを最も近いボーンセグメントに割り当てるために使用
export function distToSegSq(px: number, py: number, pz: number,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az; // ABベクトル
  const apx = px - ax, apy = py - ay, apz = pz - az; // APベクトル
  const lenSq = abx * abx + aby * aby + abz * abz;   // AB長さの二乗
  if (lenSq < 0.0001) return apx * apx + apy * apy + apz * apz; // 退化線分→点距離
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / lenSq)); // 射影パラメータ
  const cx = ax + abx * t - px, cy = ay + aby * t - py, cz = az + abz * t - pz; // 最近接点→P
  return cx * cx + cy * cy + cz * cz;
}

// ============================================================
// ボクセル→ボーン割り当て
// ============================================================
// 全ボクセルを最も近いボーンセグメントに割り当てる
// 1. 各ボーンの線分（自身→子ボーン）を構築
// 2. 各ボクセルを最短距離のセグメントに割り当て
// 3. 連結性チェック: 分離したクラスターは隣接ボーンに再割り当て
export function assignVoxelsToBones(
  voxels: VoxelEntry[], bones: Record<string, Vec3>,
): Record<string, VoxelEntry[]> {
  const boneNames = Object.keys(bones);
  const result: Record<string, VoxelEntry[]> = {};
  for (const n of boneNames) result[n] = [];

  // 子ボーンマップを構築
  const childrenMap = new Map<string, string[]>();
  for (const n of boneNames) childrenMap.set(n, []);
  for (const d of BONE_DEFS) {
    if (boneNames.includes(d.name) && d.parent && boneNames.includes(d.parent))
      childrenMap.get(d.parent)!.push(d.name);
  }

  type Seg = { name: string; ax: number; ay: number; az: number; bx: number; by: number; bz: number };
  const segs: Seg[] = [];
  for (const n of boneNames) {
    const b = bones[n];
    const ch = childrenMap.get(n) ?? [];
    if (ch.length > 0) {
      for (const cn of ch) { const c = bones[cn]; segs.push({ name: n, ax: b.x, ay: b.y, az: b.z, bx: c.x, by: c.y, bz: c.z }); }
    } else {
      segs.push({ name: n, ax: b.x, ay: b.y, az: b.z, bx: b.x, by: b.y, bz: b.z });
    }
  }

  for (const v of voxels) {
    let best = segs[0].name, bestD = Infinity;
    for (const s of segs) {
      const d = distToSegSq(v.x, v.y, v.z, s.ax, s.ay, s.az, s.bx, s.by, s.bz);
      if (d < bestD) { bestD = d; best = s.name; }
    }
    result[best].push(v);
  }

  // 連結性チェック + 再割り当て
  const globalMap = new Map<string, string>();
  for (const [bn, bvs] of Object.entries(result)) for (const v of bvs) globalMap.set(`${v.x},${v.y},${v.z}`, bn);

  for (const bn of boneNames) {
    const bvs = result[bn];
    if (bvs.length === 0) continue;
    const posSet = new Set<string>();
    const posMap = new Map<string, VoxelEntry>();
    for (const v of bvs) { const k = `${v.x},${v.y},${v.z}`; posSet.add(k); posMap.set(k, v); }

    const visited = new Set<string>();
    const comps: VoxelEntry[][] = [];
    for (const v of bvs) {
      const k = `${v.x},${v.y},${v.z}`;
      if (visited.has(k)) continue;
      const comp: VoxelEntry[] = [];
      const q = [k]; visited.add(k);
      while (q.length > 0) {
        const ck = q.pop()!; comp.push(posMap.get(ck)!);
        const cv = posMap.get(ck)!;
        for (const [ddx, ddy, ddz] of FACE_DIRS) {
          const nk = `${cv.x + ddx},${cv.y + ddy},${cv.z + ddz}`;
          if (posSet.has(nk) && !visited.has(nk)) { visited.add(nk); q.push(nk); }
        }
      }
      comps.push(comp);
    }
    if (comps.length <= 1) continue;
    comps.sort((a, b) => b.length - a.length);
    result[bn] = comps[0];
    for (let ci = 1; ci < comps.length; ci++) {
      for (const v of comps[ci]) {
        let reassign: string | null = null, rDist = Infinity;
        for (const [ddx, ddy, ddz] of FACE_DIRS) {
          const nk = `${v.x + ddx},${v.y + ddy},${v.z + ddz}`;
          const nb = globalMap.get(nk);
          if (nb && nb !== bn) {
            for (const s of segs) { if (s.name !== nb) continue; const d = distToSegSq(v.x, v.y, v.z, s.ax, s.ay, s.az, s.bx, s.by, s.bz); if (d < rDist) { rDist = d; reassign = nb; } }
          }
        }
        if (!reassign) { for (const s of segs) { if (s.name === bn) continue; const d = distToSegSq(v.x, v.y, v.z, s.ax, s.ay, s.az, s.bx, s.by, s.bz); if (d < rDist) { rDist = d; reassign = s.name; } } }
        if (reassign) { result[reassign].push(v); globalMap.set(`${v.x},${v.y},${v.z}`, reassign); }
      }
    }
  }
  return result;
}

// ============================================================
// ボーン境界の球体キャップ
// 隣接する2つのボーンの境界中間点に球状ボクセルを追加し、
// アニメーション時にボーン間の隙間が見えないようにする
// ============================================================
export function addSphereCaps(boneVoxels: Record<string, VoxelEntry[]>): void {
  const boneMaps = new Map<string, Map<string, VoxelEntry>>();
  for (const [bn, vs] of Object.entries(boneVoxels)) {
    const m = new Map<string, VoxelEntry>();
    for (const v of vs) m.set(`${v.x},${v.y},${v.z}`, v);
    boneMaps.set(bn, m);
  }
  const processed = new Set<string>();
  const toAdd = new Map<string, VoxelEntry[]>();
  for (const n of Object.keys(boneVoxels)) toAdd.set(n, []);

  for (const [bn] of Object.entries(boneVoxels)) {
    const thisMap = boneMaps.get(bn)!;
    const adjBnd = new Map<string, Map<string, VoxelEntry>>();
    for (const [k, v] of thisMap) {
      for (const [ddx, ddy, ddz] of FACE_DIRS) {
        const nk = `${v.x + ddx},${v.y + ddy},${v.z + ddz}`;
        if (thisMap.has(nk)) continue;
        for (const [on, om] of boneMaps) {
          if (on !== bn && om.has(nk)) {
            if (!adjBnd.has(on)) adjBnd.set(on, new Map());
            adjBnd.get(on)!.set(k, v);
            break;
          }
        }
      }
    }
    for (const [on, thisBnd] of adjBnd) {
      const pk = [bn, on].sort().join('|');
      if (processed.has(pk)) continue;
      processed.add(pk);
      const otherMap = boneMaps.get(on)!;
      const otherBnd = new Map<string, VoxelEntry>();
      for (const [, v] of otherMap) {
        for (const [ddx, ddy, ddz] of FACE_DIRS) {
          const nk = `${v.x + ddx},${v.y + ddy},${v.z + ddz}`;
          if (thisMap.has(nk)) { otherBnd.set(`${v.x},${v.y},${v.z}`, v); break; }
        }
      }
      let tx = 0, ty = 0, tz = 0;
      for (const v of thisBnd.values()) { tx += v.x; ty += v.y; tz += v.z; }
      tx /= thisBnd.size; ty /= thisBnd.size; tz /= thisBnd.size;
      let ox = 0, oy = 0, oz = 0;
      for (const v of otherBnd.values()) { ox += v.x; oy += v.y; oz += v.z; }
      if (otherBnd.size === 0) continue;
      ox /= otherBnd.size; oy /= otherBnd.size; oz /= otherBnd.size;
      const mx = (tx + ox) / 2, my = (ty + oy) / 2, mz = (tz + oz) / 2;
      const ndx = ox - tx, ndy = oy - ty, ndz = oz - tz;
      const nLen = Math.sqrt(ndx * ndx + ndy * ndy + ndz * ndz) || 1;
      const nnx = ndx / nLen, nny = ndy / nLen, nnz = ndz / nLen;
      let maxDSq = 0;
      for (const v of thisBnd.values()) { const d = (v.x - mx) ** 2 + (v.y - my) ** 2 + (v.z - mz) ** 2; if (d > maxDSq) maxDSq = d; }
      for (const v of otherBnd.values()) { const d = (v.x - mx) ** 2 + (v.y - my) ** 2 + (v.z - mz) ** 2; if (d > maxDSq) maxDSq = d; }
      const r = Math.max(1, Math.sqrt(maxDSq) / 2), rSq = r * r, ri = Math.ceil(r);
      const allBnd = [...thisBnd.values(), ...otherBnd.values()];
      for (let sx = -ri; sx <= ri; sx++) for (let sy = -ri; sy <= ri; sy++) for (let sz = -ri; sz <= ri; sz++) {
        const vx = Math.round(mx) + sx, vy = Math.round(my) + sy, vz = Math.round(mz) + sz;
        if ((vx - mx) ** 2 + (vy - my) ** 2 + (vz - mz) ** 2 > rSq) continue;
        const k = `${vx},${vy},${vz}`;
        let nrD = Infinity, nc = { r: 0.5, g: 0.5, b: 0.5 };
        for (const bv of allBnd) { const d = (vx - bv.x) ** 2 + (vy - bv.y) ** 2 + (vz - bv.z) ** 2; if (d < nrD) { nrD = d; nc = { r: bv.r, g: bv.g, b: bv.b }; } }
        const entry: VoxelEntry = { x: vx, y: vy, z: vz, r: nc.r, g: nc.g, b: nc.b };
        const proj = (vx - mx) * nnx + (vy - my) * nny + (vz - mz) * nnz;
        if (proj > 0) { if (!thisMap.has(k)) toAdd.get(bn)!.push(entry); }
        else { if (!otherMap.has(k)) toAdd.get(on)!.push(entry); }
      }
    }
  }
  for (const [bn, adds] of toAdd) if (adds.length > 0) boneVoxels[bn].push(...adds);
}

// ============================================================
// Unlitシェーダーマテリアル
// ライティングなしで頂点カラーをそのまま表示する
// ボクセルメッシュの描画に使用
// ============================================================
export function createUnlitMaterial(scene: Scene, name: string): ShaderMaterial {
  Effect.ShadersStore[name + 'VertexShader'] = `precision highp float;attribute vec3 position;attribute vec4 color;uniform mat4 worldViewProjection;varying vec4 vColor;void main(){gl_Position=worldViewProjection*vec4(position,1.0);vColor=color;}`;
  Effect.ShadersStore[name + 'FragmentShader'] = `precision highp float;varying vec4 vColor;void main(){gl_FragColor=vColor;}`;
  const mat = new ShaderMaterial(name, scene, { vertex: name, fragment: name }, {
    attributes: ['position', 'color'], uniforms: ['worldViewProjection'], needAlphaBlending: false,
  });
  mat.backFaceCulling = false;
  mat.forceDepthWrite = true;
  return mat;
}

// ============================================================
// ボーンローカル座標メッシュ構築（内部関数）
// 頂点位置をボーン位置からの相対座標にベイクする
// これによりボーンのTransformNodeが回転するとメッシュも一緒に動く
// ============================================================
function buildBoneMeshLocal(
  voxels: VoxelEntry[], scene: Scene, name: string,
  cx: number, cy: number, bonePos: Vec3, scale: number,
): Mesh {
  const bvx = (bonePos.x - cx) * scale, bvy = bonePos.z * scale, bvz = -(bonePos.y - cy) * scale;
  const occ = new Set<string>();
  for (const v of voxels) occ.add(`${v.x},${v.y},${v.z}`);
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], idx: number[] = [];
  for (const vx of voxels) {
    for (let f = 0; f < 6; f++) {
      const [ddx, ddy, ddz] = FACE_DIRS[f];
      if (occ.has(`${vx.x + ddx},${vx.y + ddy},${vx.z + ddz}`)) continue;
      const bi = pos.length / 3;
      const fv = FACE_VERTS[f], fn = FACE_NORMALS[f];
      for (let vi = 0; vi < 4; vi++) {
        pos.push((vx.x + fv[vi][0] - cx) * scale - bvx, (vx.z + fv[vi][2]) * scale - bvy, -(vx.y + fv[vi][1] - cy) * scale - bvz);
        nrm.push(fn[0], fn[2], -fn[1]);
        col.push(vx.r, vx.g, vx.b, 1);
      }
      idx.push(bi, bi + 1, bi + 2, bi, bi + 2, bi + 3);
    }
  }
  const vd = new VertexData();
  vd.positions = pos; vd.normals = nrm; vd.colors = col; vd.indices = idx;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  mesh.material = createUnlitMaterial(scene, name + '_unlit');
  return mesh;
}

// ============================================================
// スケルタルキャラクター構築
// ボクセル→ボーン割り当て→スフィアキャップ追加→
// ボーン階層TransformNode + ボーンごとメッシュを構築して返す
// nodes: アニメーション制御用、meshes: 描画用、restPos: レストポーズ位置
// ============================================================
export function buildSkeletalCharacter(
  voxels: VoxelEntry[], bones: Record<string, Vec3>,
  scene: Scene, cx: number, cy: number, prefix = 'char', scale = 0.01,
): { nodes: Map<string, TransformNode>; meshes: Map<string, Mesh>; restPos: Map<string, Vector3> } {
  const boneVoxels = assignVoxelsToBones(voxels, bones);
  addSphereCaps(boneVoxels);

  const nodes = new Map<string, TransformNode>();
  const meshes = new Map<string, Mesh>();
  const restPos = new Map<string, Vector3>();

  for (const bd of BONE_DEFS) {
    const bp = bones[bd.name];
    if (!bp) continue;
    const node = new TransformNode(`${prefix}_bone_${bd.name}`, scene);
    nodes.set(bd.name, node);
    restPos.set(bd.name, new Vector3((bp.x - cx) * scale, bp.z * scale, -(bp.y - cy) * scale));
  }

  for (const bd of BONE_DEFS) {
    const node = nodes.get(bd.name);
    const bp = bones[bd.name];
    if (!node || !bp) continue;
    const vp = new Vector3((bp.x - cx) * scale, bp.z * scale, -(bp.y - cy) * scale);
    if (bd.parent) {
      const pn = nodes.get(bd.parent);
      const pp = bones[bd.parent];
      if (pn && pp) {
        node.parent = pn;
        node.position = vp.subtract(new Vector3((pp.x - cx) * scale, pp.z * scale, -(pp.y - cy) * scale));
      } else { node.position = vp; }
    } else { node.position = vp; }
  }

  for (const bd of BONE_DEFS) {
    const bv = boneVoxels[bd.name];
    const node = nodes.get(bd.name);
    const bp = bones[bd.name];
    if (!bv || bv.length === 0 || !node || !bp) continue;
    const mesh = buildBoneMeshLocal(bv, scene, `${prefix}_${bd.name}`, cx, cy, bp, scale);
    mesh.parent = node;
    mesh.isPickable = false;
    meshes.set(bd.name, mesh);
  }

  return { nodes, meshes, restPos };
}
