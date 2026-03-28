'use client';

export function ScaleSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
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
