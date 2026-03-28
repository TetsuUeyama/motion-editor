'use client';

import { NAV_PAGES, NavigationCard } from '@/components/NavigationCard';

export default function Home() {
  return (
    <div style={{
      minHeight: '100vh', background: '#1a1a2e', color: '#fff',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '60px 20px',
    }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Motion Editor</h1>
      <p style={{ color: '#888', marginBottom: 40 }}>Select a module</p>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 20, width: '100%', maxWidth: 700,
      }}>
        {NAV_PAGES.map(p => <NavigationCard key={p.href} {...p} />)}
      </div>
    </div>
  );
}
