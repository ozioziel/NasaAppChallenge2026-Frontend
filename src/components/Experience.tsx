'use client';
/**
 * Raíz de la experiencia (solo cliente): proveedores, hooks globales y composición
 * de escena 3D, interfaz, introducción, vista regional y transiciones.
 */
import dynamic from 'next/dynamic';
import { Component, useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import gsap from 'gsap';
import { useDataRange } from '@/hooks/data';
import { useKeyboardShortcuts, usePlayback, useSystemPreferences, useUrlSync } from '@/hooks/environment';
import { useStore } from '@/state/store';
import { ObservatoryHUD } from './observatory/ObservatoryHUD';
import { RegionalTransition } from './regional/RegionalTransition';
import { BrandMark } from './observatory/BrandMark';
import { brand } from '@/config/brand';
import { getDataService } from '@/lib/data/service';
import { globeBridge } from '@/scene/bridge';

// Las coreografías siguen el tiempo real aunque haya pocos fotogramas (equipos modestos o
// pestañas ralentizadas): así terminan a tiempo en lugar de estirarse indefinidamente.
gsap.ticker.lagSmoothing(0);

const ObservatoryGlobe = dynamic(() => import('./globe/ObservatoryGlobe'), { ssr: false, loading: () => null });
const IntroSequence = dynamic(() => import('./intro/IntroSequence'), { ssr: false, loading: () => null });
const loadRegionalView = () => import('./regional/RegionalView');
const RegionalView = dynamic(() => loadRegionalView().then((m) => m.RegionalView), {
  ssr: false,
  loading: () => <div className="regional regional--loading">Cargando vista regional…</div>,
});

class SceneBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('Escena 3D no disponible:', error);
    this.props.onError();
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="scene-fallback" role="alert">
          <BrandMark size={40} />
          <strong>No se pudo iniciar el planeta 3D</strong>
          <span>Tu navegador o dispositivo no permite WebGL. Los paneles, el calendario y los datos siguen disponibles desde «Regiones».</span>
        </div>
      );
    }
    return this.props.children;
  }
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function Runtime() {
  useSystemPreferences();
  usePlayback();
  useKeyboardShortcuts();
  useUrlSync();
  const { data: range } = useDataRange();
  const setDataRange = useStore((s) => s.setDataRange);
  useEffect(() => {
    if (range) setDataRange(range.start, range.end);
  }, [range, setDataRange]);

  // Herramienta de inspección solo en desarrollo.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    (window as unknown as Record<string, unknown>).__observatorio = { store: useStore, getDataService, globeBridge };
  }, []);
  return null;
}

function Stage() {
  const quality = useStore((s) => s.settings.quality);
  const view = useStore((s) => s.view);
  const webglFailed = useStore((s) => s.webglFailed);
  const setWebglFailed = useStore((s) => s.setWebglFailed);
  const [webgl] = useState(() => hasWebGL());

  useEffect(() => {
    if (!webgl) {
      setWebglFailed(true);
      useStore.getState().finishIntro();
    }
  }, [webgl, setWebglFailed]);

  // Precarga la vista regional (Leaflet incluido) en segundo plano tras la intro, para que
  // esté lista cuando la cámara atraviese las nubes.
  const phase = useStore((s) => s.phase);
  useEffect(() => {
    if (phase !== 'observatory') return;
    const id = window.setTimeout(() => {
      void loadRegionalView();
      void import('leaflet');
    }, 2500);
    return () => window.clearTimeout(id);
  }, [phase]);

  return (
    <>
      <div className="space-backdrop" aria-hidden="true" />
      {webgl && !webglFailed && (
        <SceneBoundary onError={() => { setWebglFailed(true); useStore.getState().finishIntro(); }}>
          <ObservatoryGlobe key={quality} />
        </SceneBoundary>
      )}
      {(!webgl || webglFailed) && (
        <div className="scene-fallback" role="alert">
          <BrandMark size={40} />
          <strong>Planeta 3D no disponible</strong>
          <span>WebGL no está disponible. Puedes explorar los datos desde «Regiones» y los paneles.</span>
        </div>
      )}
      <ObservatoryHUD />
      {view === 'regional' && <RegionalView />}
      <RegionalTransition />
      {webgl && !webglFailed && <IntroSequence />}
      <noscript>{brand.fullName} requiere JavaScript.</noscript>
    </>
  );
}

export default function Experience() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 60_000 } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Runtime />
      <Stage />
    </QueryClientProvider>
  );
}
