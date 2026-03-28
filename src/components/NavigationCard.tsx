'use client';

import Link from 'next/link';
import type { NavPage } from '@/utils/navigation';

export function NavigationCard({ href, title, desc }: NavPage) {
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div
        style={{
          background: '#252540', borderRadius: 12, padding: '24px 20px',
          border: '1px solid #333', cursor: 'pointer',
          transition: 'border-color 0.2s, background 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#5566ff'; e.currentTarget.style.background = '#2a2a50'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.background = '#252540'; }}
      >
        <div style={{ fontSize: 18, fontWeight: 'bold', color: '#7788ff', marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: '#aaa', lineHeight: 1.5 }}>{desc}</div>
      </div>
    </Link>
  );
}
