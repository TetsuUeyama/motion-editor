'use client';

import { useMemo } from 'react';
import { MODEL_REGISTRY, DEFAULT_MODEL_ID } from '@/utils/model-registry';
import type { ModelEntry } from '@/utils/model-registry';
import BoneConfigTemplate from '@/templates/BoneConfigTemplate';

/** ページレベルの関心事: URLパラメータからモデル選択を解決 */
export default function BoneConfigView() {
  const initialModel = useMemo<ModelEntry>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const modelId = params.get('model');
      if (modelId) {
        const m = MODEL_REGISTRY.find(e => e.id === modelId);
        if (m) return m;
      }
    }
    return MODEL_REGISTRY.find(m => m.id === DEFAULT_MODEL_ID) ?? MODEL_REGISTRY[0];
  }, []);

  return <BoneConfigTemplate initialModel={initialModel} />;
}
