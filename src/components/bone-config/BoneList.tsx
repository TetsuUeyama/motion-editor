'use client';

import { BONE_DEFS, getBoneDepth } from '@/utils/voxelize/skeleton';
import type { Vec3 } from '@/utils/voxelize/skeleton';
import type { Mesh } from '@babylonjs/core';
import { r1 } from '@/utils/bone-config/constants';

interface BoneListEditProps {
  mode: 'edit';
  calculatedBones: Record<string, Vec3>;
}

interface BoneListPreviewProps {
  mode: 'preview';
  previewMeshes: Map<string, Mesh>;
}

type BoneListProps = BoneListEditProps | BoneListPreviewProps;

export function BoneList(props: BoneListProps) {
  if (props.mode === 'edit') {
    return (
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ padding: '6px 12px', fontSize: 11, color: '#888', borderBottom: '1px solid #222' }}>
          自動計算されたボーン (読み取り専用)
        </div>
        {BONE_DEFS.map(bone => {
          const pos = props.calculatedBones[bone.name];
          const depth = getBoneDepth(bone.name);
          return (
            <div
              key={bone.name}
              style={{
                padding: '4px 12px', paddingLeft: 12 + depth * 14,
                fontSize: 11, color: '#999',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <span style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: bone.color, display: 'inline-block',
              }} />
              <span style={{ flex: 1 }}>{bone.label}</span>
              {pos && (
                <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace' }}>
                  {r1(pos.x)}, {r1(pos.y)}, {r1(pos.z)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // preview mode
  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      <div style={{ padding: '6px 12px', fontSize: 11, color: '#666', borderBottom: '1px solid #222' }}>
        ボーン分割一覧 (41ボーン)
      </div>
      {BONE_DEFS.map(bone => {
        const hasMesh = props.previewMeshes.has(bone.name);
        const depth = getBoneDepth(bone.name);
        return (
          <div
            key={bone.name}
            style={{
              padding: '3px 12px', paddingLeft: 12 + depth * 12,
              fontSize: 10, color: hasMesh ? '#aaa' : '#555',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: bone.color, display: 'inline-block',
              opacity: hasMesh ? 1 : 0.3,
            }} />
            <span>{bone.label}</span>
          </div>
        );
      })}
    </div>
  );
}
