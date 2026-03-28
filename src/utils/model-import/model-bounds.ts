import { Vector3, Mesh, AbstractMesh } from '@babylonjs/core';

// 複数メッシュのバウンディングボックス（最小/最大座標と中心）を計算する
export function computeModelBounds(meshes: AbstractMesh[]): { min: Vector3; max: Vector3; center: Vector3 } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const m of meshes) {
    if (!(m instanceof Mesh)) continue;
    const pos = m.getVerticesData('position');
    if (!pos) continue;
    const wm = m.getWorldMatrix();
    for (let i = 0; i < pos.length; i += 3) {
      const wp = Vector3.TransformCoordinates(new Vector3(pos[i], pos[i + 1], pos[i + 2]), wm);
      minX = Math.min(minX, wp.x); maxX = Math.max(maxX, wp.x);
      minY = Math.min(minY, wp.y); maxY = Math.max(maxY, wp.y);
      minZ = Math.min(minZ, wp.z); maxZ = Math.max(maxZ, wp.z);
    }
  }
  if (!isFinite(minX)) return { min: Vector3.Zero(), max: Vector3.Zero(), center: Vector3.Zero() };
  return {
    min: new Vector3(minX, minY, minZ),
    max: new Vector3(maxX, maxY, maxZ),
    center: new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2),
  };
}
