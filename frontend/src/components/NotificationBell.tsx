'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  actionUrl?: string | null;
}

export function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  function load() {
    apiFetch<NotificationItem[]>('/notifications').then(setItems).catch(() => {});
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', onClickOutside);
    return () => document.removeEventListener('click', onClickOutside);
  }, []);

  const unread = items.filter((i) => !i.readAt).length;

  async function openAndMarkRead() {
    setOpen((v) => !v);
    if (unread > 0) {
      await apiFetch('/notifications/read-all', { method: 'POST' });
      load();
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button className="btn btn--ghost" onClick={openAndMarkRead} aria-label="Notifications">
        🔔{unread > 0 && <span style={{ marginLeft: '0.3rem' }} className="badge">{unread}</span>}
      </button>
      {open && (
        <div
          className="card"
          style={{
            position: 'absolute',
            right: 0,
            top: '2.5rem',
            width: '20rem',
            maxHeight: '24rem',
            overflowY: 'auto',
            zIndex: 20,
          }}
        >
          {items.length === 0 && <p className="muted">No notifications yet.</p>}
          {items.map((n) => {
            const body = (
              <>
                <strong>{n.title}</strong>
                <p className="muted" style={{ margin: '0.2rem 0' }}>{n.body}</p>
                <span className="muted" style={{ fontSize: '0.75rem' }}>{new Date(n.createdAt).toLocaleString()}</span>
              </>
            );
            return (
              <div key={n.id} style={{ marginBottom: '0.75rem' }}>
                {n.actionUrl ? (
                  <Link href={n.actionUrl} onClick={() => setOpen(false)} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
