'use client';

import { useRef } from 'react';
import type { ScaleSettings, BodyCategory } from '@/utils/character-viewer/constants';
import { VOXEL_SIZE, CATEGORY_LABELS, DEFAULT_SCALES } from '@/utils/character-viewer/constants';
import { generateBoneColors } from '@/utils/character-viewer/voxelize';

// ============================================================
// ScaleSlider (inlined)
// ============================================================

function ScaleSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'#ccc', marginBottom:2 }}>
        <span>{label}</span>
        <span style={{ color:'#8af', fontFamily:'monospace' }}>{value.toFixed(2)}x</span>
      </div>
      <input type="range" min={0.2} max={3.0} step={0.05} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width:'100%', accentColor:'#5566ff' }} />
    </div>
  );
}

// ============================================================
// Sidebar
// ============================================================

interface SidebarProps {
  source: 'primitive' | 'model';
  modelFileName: string | null;
  loading: boolean;
  scales: ScaleSettings;
  colorMode: 'texture' | 'bone';
  detectedBones: { name: string; count: number }[];
  voxelCount: number;
  onFileLoad: (file: File) => void;
  onSwitchToPrimitive: () => void;
  onScaleChange: (key: keyof ScaleSettings, value: number) => void;
  onReset: () => void;
  onColorMode: (mode: 'texture' | 'bone') => void;
}

export function Sidebar({
  source, modelFileName, loading, scales, colorMode, detectedBones, voxelCount,
  onFileLoad, onSwitchToPrimitive, onScaleChange, onReset, onColorMode,
}: SidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const boneColors = generateBoneColors(detectedBones.length);

  return (
    <div style={{width:280,minWidth:280,background:'#1e1e35',borderRight:'1px solid #333',padding:'12px 14px',overflowY:'auto',display:'flex',flexDirection:'column',gap:4}}>

      <div style={{fontSize:11,color:source==='model'?'#8fc':'#8af',marginBottom:4,padding:'4px 8px',background:'#252545',borderRadius:4}}>
        Source: {source==='model'?`3D Model (${modelFileName})`:'Primitive'}
      </div>

      <input ref={fileInputRef} type="file" accept=".glb,.gltf" style={{display:'none'}}
        onChange={e=>{const f=e.target.files?.[0];if(f)onFileLoad(f);e.target.value='';}} />
      <button onClick={()=>fileInputRef.current?.click()} disabled={loading}
        style={{padding:'8px',fontSize:12,fontWeight:'bold',cursor:loading?'wait':'pointer',
          background:'#2a4a3a',color:'#8fc',border:'1px solid #4a8a6a',borderRadius:5}}>
        {loading?'Processing...':'Load 3D Model (GLB)'}
      </button>
      {source==='model'&&(
        <button onClick={onSwitchToPrimitive}
          style={{padding:'6px',fontSize:11,cursor:'pointer',background:'#333',color:'#aaa',border:'1px solid #555',borderRadius:4}}>
          Reset to Primitive
        </button>
      )}

      <div style={{borderTop:'1px solid #333',margin:'8px 0'}} />

      {source==='primitive'&&(
        <>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <span style={{color:'#fff',fontSize:14,fontWeight:'bold'}}>Body Scale</span>
            <button onClick={onReset} style={{background:'#333',color:'#aaa',border:'1px solid #555',borderRadius:4,padding:'2px 10px',fontSize:11,cursor:'pointer'}}>Reset</button>
          </div>
          <ScaleSlider label="Global (全体)" value={scales.global} onChange={v=>onScaleChange('global',v)} />
          <div style={{borderTop:'1px solid #333',margin:'6px 0'}} />
          {(Object.keys(CATEGORY_LABELS) as BodyCategory[]).map(cat=>(
            <ScaleSlider key={cat} label={CATEGORY_LABELS[cat]} value={scales[cat]} onChange={v=>onScaleChange(cat,v)} />
          ))}
        </>
      )}

      {source==='model'&&(
        <>
          {/* 色モード切替 */}
          <div style={{display:'flex',gap:4,marginBottom:8}}>
            {(['bone','texture'] as const).map(m=>(
              <button key={m} onClick={()=>onColorMode(m)}
                style={{flex:1,padding:'5px 0',fontSize:11,fontWeight:colorMode===m?'bold':'normal',
                  background:colorMode===m?'#3344aa':'#252545',color:colorMode===m?'#fff':'#888',
                  border:`1px solid ${colorMode===m?'#5566ff':'#444'}`,borderRadius:4,cursor:'pointer'}}>
                {m==='bone'?'Parts Color':'Texture Color'}
              </button>
            ))}
          </div>

          {/* 検出ボーン一覧 */}
          <div style={{color:'#fff',fontSize:13,fontWeight:'bold',marginBottom:4}}>
            Detected Parts ({detectedBones.length})
          </div>
          <div style={{maxHeight:300,overflowY:'auto',fontSize:11,lineHeight:1.8}}>
            {detectedBones.map((b,i)=>(
              <div key={b.name} style={{display:'flex',alignItems:'center',gap:6,color:'#ccc'}}>
                <span style={{
                  display:'inline-block',width:10,height:10,borderRadius:2,flexShrink:0,
                  background:`rgb(${Math.round(boneColors[i].r*255)},${Math.round(boneColors[i].g*255)},${Math.round(boneColors[i].b*255)})`,
                }} />
                <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.name}</span>
                <span style={{color:'#666',flexShrink:0}}>{b.count}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{marginTop:'auto',paddingTop:12,borderTop:'1px solid #333',fontSize:11,color:'#666'}}>
        <div>Voxel size: {VOXEL_SIZE}m</div>
        <div>Voxels: {voxelCount.toLocaleString()}</div>
      </div>
    </div>
  );
}
