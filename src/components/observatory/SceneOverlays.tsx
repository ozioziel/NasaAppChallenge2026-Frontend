'use client';
/**
 * Superposiciones sincronizadas con cada fotograma del globo (sin re-render de React):
 *  - Haz holográfico entre la celda seleccionada y el panel.
 *  - Mensajes de estado de la estrella guardiana junto a ella.
 */
import { useEffect, useRef } from 'react';
import { brand } from '@/config/brand';
import { cellCenter } from '@/lib/geo/h3';
import { globeBridge, type GlobeBridge } from '@/scene/bridge';
import { useRegionMap } from '@/hooks/data';
import { useStore } from '@/state/store';
import { useNarrator } from '@/state/narrator';
import type { FrameInfo } from '@/scene/observatoryEngine';

function useFrame(fn: (info: FrameInfo) => void) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    let off: (() => void) | undefined;
    const attach = (b: GlobeBridge | null) => {
      off?.();
      off = b ? (() => {
        const remove = b.engine.addFrameListener((info) => ref.current(info));
        return () => {
          remove();
        };
      })() : undefined;
    };
    attach(globeBridge.get());
    const unsub = globeBridge.subscribe(attach);
    return () => {
      off?.();
      unsub();
    };
  }, []);
}

export function SelectionTether() {
  const pathRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const selection = useStore((s) => s.selection);
  const panelOpen = useStore((s) => s.panel.open && !s.panel.minimized);
  const view = useStore((s) => s.view);
  const regions = useRegionMap();
  const center = selection ? (selection.kind === 'cell' ? cellCenter(selection.h3) : regions[selection.regionId]?.center) : null;
  const active = Boolean(center && panelOpen && view === 'global');
  const centerRef = useRef(center);
  const activeRef = useRef(active);
  useEffect(() => {
    centerRef.current = center;
    activeRef.current = active;
  });

  useFrame((info) => {
    const path = pathRef.current;
    const dot = dotRef.current;
    if (!path || !dot) return;
    const c = centerRef.current;
    const panel = document.querySelector('.inspector .holo__surface') as HTMLElement | null;
    const p = c && activeRef.current ? info.project(c.lat, c.lng, 0.01) : null;
    if (!p || !panel || info.width < 900) {
      path.style.opacity = '0';
      dot.style.opacity = '0';
      return;
    }
    const r = panel.getBoundingClientRect();
    const tx = r.left - 2;
    const ty = Math.min(r.bottom - 40, Math.max(r.top + 40, p.y));
    const mx = (p.x + tx) / 2;
    path.setAttribute('d', `M${p.x.toFixed(1)} ${p.y.toFixed(1)} C${mx.toFixed(1)} ${p.y.toFixed(1)} ${mx.toFixed(1)} ${ty.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)}`);
    path.style.opacity = '1';
    dot.setAttribute('cx', p.x.toFixed(1));
    dot.setAttribute('cy', p.y.toFixed(1));
    dot.style.opacity = '1';
  });

  return (
    <svg className="tether" aria-hidden="true">
      <defs>
        <linearGradient id="tether-grad" x1="0" x2="1">
          <stop offset="0" stopColor="#bff4ff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#a68bff" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <path ref={pathRef} fill="none" stroke="url(#tether-grad)" strokeWidth="1" strokeDasharray="3 4" style={{ opacity: 0 }} />
      <circle ref={dotRef} r="3" fill="#e8fbff" style={{ opacity: 0 }} />
    </svg>
  );
}

export function MascotStatus() {
  const boxRef = useRef<HTMLDivElement>(null);
  const message = useNarrator((s) => s.message);
  const tone = useNarrator((s) => s.tone);
  const nonce = useNarrator((s) => s.nonce);
  const phase = useStore((s) => s.phase);
  const view = useStore((s) => s.view);

  useFrame((info) => {
    const el = boxRef.current;
    const m = info.mascotScreen;
    if (!el || !m) return;
    const right = m.x < info.width * 0.6;
    const x = right ? m.x + m.r * 1.35 : m.x - m.r * 1.35;
    el.style.transform = `translate(${x.toFixed(1)}px, ${(m.y - 10).toFixed(1)}px) translateX(${right ? '0' : '-100%'})`;
    el.dataset.side = right ? 'right' : 'left';
  });

  return (
    <div ref={boxRef} className="mascot-status" aria-live="polite">
      {message && phase === 'observatory' && view === 'global' && (
        <p key={nonce} className={`mascot-status__msg mascot-status__msg--${tone}`}>
          <span className="mascot-status__name">{brand.mascotName}</span>
          {message}
        </p>
      )}
    </div>
  );
}
