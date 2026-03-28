'use client';

interface UploadStepProps {
  fileName: string | null;
  loading: boolean;
  error: string | null;
  onFileSelect: (file: File) => void;
}

export function UploadStep({ fileName, loading, error, onFileSelect }: UploadStepProps) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <label style={{ padding: '12px 24px', borderRadius: 6, background: '#1a2a44', color: '#6af', border: '1px solid #3a5a8a', cursor: 'pointer', fontSize: 14, fontWeight: 'bold' }}>
        Open 3D File
        <input type="file" accept=".glb,.gltf,.obj" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) onFileSelect(f); }} />
      </label>
      <div style={{ fontSize: 11, color: '#555', marginTop: 12 }}>GLB / GLTF / OBJ</div>
      {fileName && <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>{fileName}</div>}
      {loading && <div style={{ fontSize: 12, color: '#6af', marginTop: 12 }}>Loading...</div>}
      {error && <div style={{ fontSize: 11, color: '#f66', marginTop: 12 }}>{error}</div>}
    </div>
  );
}
