/**
 * Uniform Chibi Voxelization
 * 3D model + markers -> fixed-size chibi voxel body
 */

import {
  Mesh, AbstractMesh, Vector3,
} from '@babylonjs/core';

import { clamp01, type VoxelEntry, type Vec3 } from '@/utils/voxel-core';
import type { DeformParams } from './constants';
import { BODY_SIZE } from './constants';

// ============================================================
// Utility functions
// ============================================================

export function mergeVoxelLayers(...layers: VoxelEntry[][]): VoxelEntry[] {
  const map = new Map<string, VoxelEntry>();
  for (const layer of layers) {
    for (const v of layer) map.set(`${v.x},${v.y},${v.z}`, v);
  }
  return Array.from(map.values());
}

export function normDir(to: Vec3, from: Vec3): Vec3 {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

export function offsetV(base: Vec3, dir: Vec3, dist: number): Vec3 {
  return { x: base.x + dir.x * dist, y: base.y + dir.y * dist, z: base.z + dir.z * dist };
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export function piecewiseLinear(val: number, srcKeys: number[], tgtKeys: number[]): number {
  if (val <= srcKeys[0]) return tgtKeys[0];
  for (let i = 1; i < srcKeys.length; i++) {
    if (val <= srcKeys[i]) {
      const denom = srcKeys[i] - srcKeys[i - 1];
      const t = denom > 0.0001 ? (val - srcKeys[i - 1]) / denom : 0;
      return tgtKeys[i - 1] + t * (tgtKeys[i] - tgtKeys[i - 1]);
    }
  }
  return tgtKeys[tgtKeys.length - 1];
}

/** Convert world-space point to voxel-space using deform params */
export function worldToVoxel(wx: number, wy: number, wz: number, p: DeformParams): Vec3 {
  const normH = (wy - p.footY) / p.bH;
  const vz = piecewiseLinear(normH, p.srcH, p.tgtH);
  const zoneMul = piecewiseLinear(normH, p.srcWD, p.tgtWD);
  const vx = (BODY_SIZE.x - 1) / 2 + (wx - p.centerX) * p.baseScale * zoneMul;
  const vy = (BODY_SIZE.y - 1) / 2 - (wz - p.centerZ) * p.baseScale * zoneMul;
  return { x: vx, y: vy, z: vz };
}

// ============================================================
// Uniform Chibi Voxelization
// ============================================================
export async function uniformChibiVoxelize(
  meshes: AbstractMesh[],
  worldMarkers: Record<string, Vector3>,
  modelBounds: { min: Vector3; max: Vector3 },
): Promise<{ voxels: VoxelEntry[]; deformParams: DeformParams }> {

  // ---- Model bounding box ----
  const bMin = modelBounds.min;
  const bMax = modelBounds.max;
  const bW = Math.max(bMax.x - bMin.x, 1e-6);
  const bH = Math.max(bMax.y - bMin.y, 1e-6);
  const bD = Math.max(bMax.z - bMin.z, 1e-6);

  // ---- Chibi deformation via markers ----
  const footY = bMin.y;
  const kneeY = ((worldMarkers['LeftKnee']?.y ?? 0) + (worldMarkers['RightKnee']?.y ?? 0)) / 2
    || (footY + bH * 0.25);
  const groinY = worldMarkers['Groin']?.y ?? (footY + bH * 0.45);
  const chinY = worldMarkers['Chin']?.y ?? (footY + bH * 0.80);

  // Body height remap: model ratios -> 5-head-tall voxel Z
  const srcH = [0, (kneeY - footY) / bH, (groinY - footY) / bH, (chinY - footY) / bH, 1];
  const tgtH = [0, 25, 51, 81, BODY_SIZE.z - 1];

  // Width/depth zone multiplier (piecewise by height)
  const srcWD = [...srcH];
  const tgtWD = [1.1, 1.1, 1.1, 1.1, 1.8];

  // Model center (X, Z)
  const centerX = (bMin.x + bMax.x) / 2;
  const centerZ = (bMin.z + bMax.z) / 2;

  // Base scale from height axis
  const baseScale = (BODY_SIZE.z - 1) / bH;

  console.log(`[Voxelize] meshes=${meshes.length} bbox=${bW.toFixed(3)}×${bH.toFixed(3)}×${bD.toFixed(3)} baseScale=${baseScale.toFixed(2)} srcH=[${srcH.map(v=>v.toFixed(2)).join(',')}]`);

  // ---- Rasterization step ----
  const sampleStep = (1 / baseScale) * 0.5;

  const voxelSet = new Map<string, VoxelEntry>();

  for (const mesh of meshes) {
    if (!(mesh instanceof Mesh)) continue;
    const positions = mesh.getVerticesData('position');
    const indices   = mesh.getIndices();
    const uvs       = mesh.getVerticesData('uv');
    const vcolors   = mesh.getVerticesData('color');
    if (!positions || !indices) {
      console.log(`[Voxelize] SKIP mesh="${mesh.name}" positions=${!!positions} indices=${!!indices}`);
      continue;
    }
    console.log(`[Voxelize] mesh="${mesh.name}" verts=${positions.length / 3} tris=${indices.length / 3} hasUV=${!!uvs} hasVC=${!!vcolors}`);

    const wm  = mesh.getWorldMatrix();

    // ---- Build material segments (handles MultiMaterial / SubMesh) ----
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meshMat = mesh.material as any;
    interface MatSeg { mat: any; idxStart: number; idxEnd: number; }
    const segments: MatSeg[] = [];
    if (mesh.subMeshes && mesh.subMeshes.length > 1 && meshMat?.subMaterials) {
      for (const sm of mesh.subMeshes) {
        segments.push({
          mat: meshMat.subMaterials[sm.materialIndex] ?? null,
          idxStart: sm.indexStart,
          idxEnd: sm.indexStart + sm.indexCount,
        });
      }
    } else {
      segments.push({ mat: meshMat, idxStart: 0, idxEnd: indices.length });
    }

    for (const seg of segments) {
      // ---- Read texture pixels for this segment's material ----
      let texPx: Uint8Array | null = null;
      let texW = 0, texH = 0;
      let tintR = 1, tintG = 1, tintB = 1;
      let flatR = 0.6, flatG = 0.6, flatB = 0.6;

      if (seg.mat) {
        // Material color factor (used as tint with texture, flat color without)
        const mc = seg.mat.albedoColor ?? seg.mat.diffuseColor;
        if (mc && typeof mc.r === 'number') {
          tintR = mc.r; tintG = mc.g; tintB = mc.b;
          flatR = mc.r; flatG = mc.g; flatB = mc.b;
        }

        if (uvs) {
          const tex = seg.mat.albedoTexture ?? seg.mat.diffuseTexture
                   ?? seg.mat._albedoTexture ?? seg.mat._diffuseTexture;
          if (tex) {
            // GPU readPixels
            try {
              if (tex.isReady?.()) {
                const sz = tex.getSize();
                texW = sz.width; texH = sz.height;
                if (texW > 0 && texH > 0) {
                  const raw = await tex.readPixels();
                  if (raw) {
                    texPx = raw instanceof Float32Array
                      ? uint8FromFloat(raw)
                      : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
                  }
                }
              }
            } catch { /* ignore */ }
            // Canvas fallback
            if (!texPx) {
              try {
                const url: string | undefined = tex.url ?? tex._texture?.url;
                if (url) {
                  const img = new Image(); img.crossOrigin = 'anonymous';
                  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); img.src = url; });
                  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
                  const ctx = c.getContext('2d');
                  if (ctx) { ctx.drawImage(img, 0, 0); const id = ctx.getImageData(0, 0, c.width, c.height); texPx = new Uint8Array(id.data.buffer); texW = c.width; texH = c.height; }
                }
              } catch { /* ignore */ }
            }
          }
        }
      }

      // ---- Rasterize triangles in this segment ----
      for (let ti = seg.idxStart; ti < seg.idxEnd; ti += 3) {
        // World-space vertices
        const p0 = xformVert(positions, indices[ti],     wm);
        const p1 = xformVert(positions, indices[ti + 1], wm);
        const p2 = xformVert(positions, indices[ti + 2], wm);

        // UV coords (if available)
        const hasUV = uvs && texPx;
        const uv0 = uvs ? [uvs[indices[ti]     * 2], uvs[indices[ti]     * 2 + 1]] : [0, 0];
        const uv1 = uvs ? [uvs[indices[ti + 1] * 2], uvs[indices[ti + 1] * 2 + 1]] : [0, 0];
        const uv2 = uvs ? [uvs[indices[ti + 2] * 2], uvs[indices[ti + 2] * 2 + 1]] : [0, 0];

        // Vertex colors (if available)
        const hasVC = !!vcolors;
        const vc0 = vcolors ? [vcolors[indices[ti]     * 4], vcolors[indices[ti]     * 4 + 1], vcolors[indices[ti]     * 4 + 2]] : [0, 0, 0];
        const vc1 = vcolors ? [vcolors[indices[ti + 1] * 4], vcolors[indices[ti + 1] * 4 + 1], vcolors[indices[ti + 1] * 4 + 2]] : [0, 0, 0];
        const vc2 = vcolors ? [vcolors[indices[ti + 2] * 4], vcolors[indices[ti + 2] * 4 + 1], vcolors[indices[ti + 2] * 4 + 2]] : [0, 0, 0];

        // Adaptive step count
        const e0 = Math.sqrt((p1[0]-p0[0])**2 + (p1[1]-p0[1])**2 + (p1[2]-p0[2])**2);
        const e1 = Math.sqrt((p2[0]-p1[0])**2 + (p2[1]-p1[1])**2 + (p2[2]-p1[2])**2);
        const e2 = Math.sqrt((p0[0]-p2[0])**2 + (p0[1]-p2[1])**2 + (p0[2]-p2[2])**2);
        const steps = Math.max(1, Math.ceil(Math.max(e0, e1, e2) / sampleStep));

        for (let si = 0; si <= steps; si++) {
          for (let sj = 0; sj <= steps - si; sj++) {
            const a = si / steps, b = sj / steps, c = 1 - a - b;

            // Interpolated world position
            const wx = p0[0] * c + p1[0] * a + p2[0] * b;
            const wy = p0[1] * c + p1[1] * a + p2[1] * b;  // height
            const wz = p0[2] * c + p1[2] * a + p2[2] * b;  // depth

            // ---- Color ----
            let cr: number, cg: number, cb: number;
            if (hasUV && texPx) {
              const su = uv0[0] * c + uv1[0] * a + uv2[0] * b;
              const sv = uv0[1] * c + uv1[1] * a + uv2[1] * b;
              const tu = ((su % 1) + 1) % 1;
              const tv = ((sv % 1) + 1) % 1;
              const px = Math.min(Math.floor(tu * texW), texW - 1);
              const py = Math.min(Math.floor((1 - tv) * texH), texH - 1);
              const pi = (py * texW + px) * 4;
              // Texture color x material tint (PBR albedoColor)
              cr = ((texPx[pi]     ?? 128) / 255) * tintR;
              cg = ((texPx[pi + 1] ?? 128) / 255) * tintG;
              cb = ((texPx[pi + 2] ?? 128) / 255) * tintB;
            } else if (hasVC) {
              cr = vc0[0] * c + vc1[0] * a + vc2[0] * b;
              cg = vc0[1] * c + vc1[1] * a + vc2[1] * b;
              cb = vc0[2] * c + vc1[2] * a + vc2[2] * b;
            } else {
              cr = flatR; cg = flatG; cb = flatB;
            }

            // ---- Map world position to chibi voxel grid ----
            const normH = (wy - footY) / bH;
            const vz = piecewiseLinear(normH, srcH, tgtH);
            const zoneMul = piecewiseLinear(normH, srcWD, tgtWD);
            const vx = (BODY_SIZE.x - 1) / 2 + (wx - centerX) * baseScale * zoneMul;
            const vy = (BODY_SIZE.y - 1) / 2 - (wz - centerZ) * baseScale * zoneMul;

            // ---- Quantize + bounds check ----
            const ix = Math.round(vx), iy = Math.round(vy), iz = Math.round(vz);
            if (ix < 0 || iy < 0 || iz < 0 || ix >= BODY_SIZE.x || iy >= BODY_SIZE.y || iz >= BODY_SIZE.z) continue;

            const key = `${ix},${iy},${iz}`;
            if (!voxelSet.has(key)) {
              voxelSet.set(key, { x: ix, y: iy, z: iz,
                r: clamp01(cr), g: clamp01(cg), b: clamp01(cb) });
            }
          }
        }
      }
    } // end segment loop
  }

  const deformParams: DeformParams = { srcH, tgtH, srcWD, tgtWD, baseScale, centerX, centerZ, footY, bH };
  return { voxels: Array.from(voxelSet.values()), deformParams };
}

// ---- helpers used only by voxelization ----
function uint8FromFloat(f: Float32Array): Uint8Array {
  const out = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) out[i] = Math.round(clamp01(f[i]) * 255);
  return out;
}

/** Transform a vertex by world matrix, return [x,y,z] */
function xformVert(pos: FloatArray, idx: number, wm: import('@babylonjs/core').Matrix): [number, number, number] {
  const v = Vector3.TransformCoordinates(
    new Vector3(pos[idx * 3], pos[idx * 3 + 1], pos[idx * 3 + 2]), wm);
  return [v.x, v.y, v.z];
}

type FloatArray = { readonly length: number; readonly [n: number]: number };

// ============================================================
// Calculate Target Bones (from world markers + deform params -> 41 bone positions)
// ============================================================
export function calculateTargetBones(
  worldMarkers: Record<string, { x: number; y: number; z: number }>,
  params: DeformParams,
): Record<string, Vec3> {
  function w2v(name: string): Vec3 {
    const m = worldMarkers[name];
    if (!m) return { x: BODY_SIZE.x / 2, y: BODY_SIZE.y / 2, z: BODY_SIZE.z / 2 };
    return worldToVoxel(m.x, m.y, m.z, params);
  }

  const chin = w2v('Chin');
  const groin = w2v('Groin');
  const lElbow = w2v('LeftElbow');
  const lWrist = w2v('LeftWrist');
  const rElbow = w2v('RightElbow');
  const rWrist = w2v('RightWrist');
  const lKnee = w2v('LeftKnee');
  const rKnee = w2v('RightKnee');

  const hips: Vec3 = { ...groin };
  const neck: Vec3 = { x: chin.x, y: chin.y, z: chin.z - 4 };
  const head: Vec3 = { x: chin.x, y: chin.y, z: Math.min(chin.z + 8, BODY_SIZE.z) };
  const spine = lerp3(hips, neck, 0.25);
  const spine1 = lerp3(hips, neck, 0.50);
  const spine2 = lerp3(hips, neck, 0.75);

  // Left arm
  const lSh: Vec3 = { x: spine2.x + (lElbow.x - spine2.x) * 0.15, y: spine2.y, z: spine2.z + 1 };
  const lArm: Vec3 = { x: spine2.x + (lElbow.x - spine2.x) * 0.4, y: spine2.y, z: spine2.z };
  const lFA: Vec3 = { ...lElbow };
  const lHand: Vec3 = { ...lWrist };
  const lFD = normDir(lHand, lFA);
  const lT1 = offsetV(lHand, lFD, 1), lT2 = offsetV(lT1, lFD, 0.8), lT3 = offsetV(lT2, lFD, 0.7), lT4 = offsetV(lT3, lFD, 0.5);
  const lI1 = offsetV(lHand, lFD, 1.5), lI2 = offsetV(lI1, lFD, 1), lI3 = offsetV(lI2, lFD, 0.8), lI4 = offsetV(lI3, lFD, 0.7);

  // Right arm
  const rSh: Vec3 = { x: spine2.x + (rElbow.x - spine2.x) * 0.15, y: spine2.y, z: spine2.z + 1 };
  const rArm: Vec3 = { x: spine2.x + (rElbow.x - spine2.x) * 0.4, y: spine2.y, z: spine2.z };
  const rFA: Vec3 = { ...rElbow };
  const rHand: Vec3 = { ...rWrist };
  const rFD = normDir(rHand, rFA);
  const rT1 = offsetV(rHand, rFD, 1), rT2 = offsetV(rT1, rFD, 0.8), rT3 = offsetV(rT2, rFD, 0.7), rT4 = offsetV(rT3, rFD, 0.5);
  const rI1 = offsetV(rHand, rFD, 1.5), rI2 = offsetV(rI1, rFD, 1), rI3 = offsetV(rI2, rFD, 0.8), rI4 = offsetV(rI3, rFD, 0.7);

  // Left leg
  const lUL: Vec3 = { x: hips.x + (lKnee.x - hips.x) * 0.8, y: hips.y, z: hips.z };
  const lLeg: Vec3 = { ...lKnee };
  const lFt: Vec3 = { x: lKnee.x, y: Math.max(lKnee.y - 4, 0), z: 2 };
  const lTB: Vec3 = { x: lFt.x, y: Math.max(lFt.y - 3, 0), z: 1 };
  const lTE: Vec3 = { x: lTB.x, y: Math.max(lTB.y - 2, 0), z: 0 };

  // Right leg
  const rUL: Vec3 = { x: hips.x + (rKnee.x - hips.x) * 0.8, y: hips.y, z: hips.z };
  const rLeg: Vec3 = { ...rKnee };
  const rFt: Vec3 = { x: rKnee.x, y: Math.max(rKnee.y - 4, 0), z: 2 };
  const rTB: Vec3 = { x: rFt.x, y: Math.max(rFt.y - 3, 0), z: 1 };
  const rTE: Vec3 = { x: rTB.x, y: Math.max(rTB.y - 2, 0), z: 0 };

  return {
    Hips: hips, Spine: spine, Spine1: spine1, Spine2: spine2, Neck: neck, Head: head,
    LeftShoulder: lSh, LeftArm: lArm, LeftForeArm: lFA, LeftHand: lHand,
    LeftHandThumb1: lT1, LeftHandThumb2: lT2, LeftHandThumb3: lT3, LeftHandThumb4: lT4,
    LeftHandIndex1: lI1, LeftHandIndex2: lI2, LeftHandIndex3: lI3, LeftHandIndex4: lI4,
    RightShoulder: rSh, RightArm: rArm, RightForeArm: rFA, RightHand: rHand,
    RightHandThumb1: rT1, RightHandThumb2: rT2, RightHandThumb3: rT3, RightHandThumb4: rT4,
    RightHandIndex1: rI1, RightHandIndex2: rI2, RightHandIndex3: rI3, RightHandIndex4: rI4,
    LeftUpLeg: lUL, LeftLeg: lLeg, LeftFoot: lFt, LeftToeBase: lTB, LeftToe_End: lTE,
    RightUpLeg: rUL, RightLeg: rLeg, RightFoot: rFt, RightToeBase: rTB, RightToe_End: rTE,
  };
}
