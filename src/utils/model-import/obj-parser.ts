import {
  Scene, Mesh, AbstractMesh, StandardMaterial, Color3, VertexData,
} from '@babylonjs/core';

// ============================================================
// OBJパーサー（SceneLoaderのblob URL問題を回避するための独自実装）
// OBJテキストを解析してBabylon.jsのメッシュ配列を生成する
// ============================================================
export function parseObjToMeshes(objText: string, scene: Scene): AbstractMesh[] {
  const allPositions: number[][] = [];
  const allNormals: number[][] = [];
  const allUVs: number[][] = [];

  interface ObjGroup { name: string; positions: number[]; normals: number[]; uvs: number[]; indices: number[]; vertMap: Map<string, number>; }
  let current: ObjGroup = { name: 'default', positions: [], normals: [], uvs: [], indices: [], vertMap: new Map() };
  const groups: ObjGroup[] = [current];

  for (const raw of objText.split('\n')) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const parts = line.split(/\s+/);
    const cmd = parts[0];

    if (cmd === 'v') {
      allPositions.push([parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0, parseFloat(parts[3]) || 0]);
    } else if (cmd === 'vn') {
      allNormals.push([parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0, parseFloat(parts[3]) || 0]);
    } else if (cmd === 'vt') {
      allUVs.push([parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0]);
    } else if (cmd === 'o' || cmd === 'g') {
      const name = parts.slice(1).join(' ') || 'default';
      current = { name, positions: [], normals: [], uvs: [], indices: [], vertMap: new Map() };
      groups.push(current);
    } else if (cmd === 'f') {
      const faceVerts: number[] = [];
      for (let i = 1; i < parts.length; i++) {
        const key = parts[i];
        if (current.vertMap.has(key)) {
          faceVerts.push(current.vertMap.get(key)!);
          continue;
        }
        const segs = key.split('/');
        const vi = parseInt(segs[0]) - 1;
        const ti = segs[1] ? parseInt(segs[1]) - 1 : -1;
        const ni = segs[2] ? parseInt(segs[2]) - 1 : -1;
        const idx = current.positions.length / 3;
        const p = allPositions[vi] ?? [0, 0, 0];
        current.positions.push(p[0], p[1], p[2]);
        if (ni >= 0 && allNormals[ni]) { current.normals.push(allNormals[ni][0], allNormals[ni][1], allNormals[ni][2]); }
        else { current.normals.push(0, 1, 0); }
        if (ti >= 0 && allUVs[ti]) { current.uvs.push(allUVs[ti][0], allUVs[ti][1]); }
        else { current.uvs.push(0, 0); }
        current.vertMap.set(key, idx);
        faceVerts.push(idx);
      }
      // Triangulate (fan from first vertex)
      for (let i = 1; i < faceVerts.length - 1; i++) {
        current.indices.push(faceVerts[0], faceVerts[i], faceVerts[i + 1]);
      }
    }
  }

  const meshes: AbstractMesh[] = [];
  for (const g of groups) {
    if (g.positions.length === 0) continue;
    const mesh = new Mesh(g.name, scene);
    const vd = new VertexData();
    vd.positions = g.positions;
    vd.normals = g.normals;
    vd.uvs = g.uvs;
    vd.indices = g.indices;
    vd.applyToMesh(mesh);
    const mat = new StandardMaterial(g.name + '_mat', scene);
    mat.diffuseColor = new Color3(0.7, 0.7, 0.7);
    mat.backFaceCulling = false;
    mesh.material = mat;
    meshes.push(mesh);
  }
  return meshes;
}
