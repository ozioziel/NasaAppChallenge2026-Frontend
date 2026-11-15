'use client';
/**
 * Estado global de la experiencia (zustand). Separa:
 *  - fase (intro / observatorio) y vista (global / regional)
 *  - consulta temporal (fecha, granularidad, capa, reproducción)
 *  - selección e interfaz de paneles
 *  - filtros científicos y configuración visual (persistida en localStorage)
 *  - órdenes puntuales para la escena 3D (volar a, escanear)
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { appConfig } from '@/config/app';
import { addDays, addMonths, clampDate, type ISODate } from '@/lib/time/dates';
import type { ConfidenceFilter, DataLayer, Granularity, LatLng } from '@/lib/types/domain';
import type { VisualKind } from '@/lib/science/categories';

export type Phase = 'intro' | 'observatory';
export type View = 'global' | 'regional';
export type Quality = 'high' | 'balanced' | 'low';
export type PanelTab = 'summary' | 'calendar' | 'sensors' | 'prediction' | 'advanced';
export type Drawer = null | 'regions' | 'filters' | 'settings' | 'about' | 'help';

export type Selection =
  | { kind: 'cell'; h3: string; regionId: string; resolution: number }
  | { kind: 'region'; regionId: string }
  | null;

export interface Settings {
  quality: Quality;
  scanWave: boolean;
  ambient: boolean;
  clouds: boolean;
  bloom: boolean;
  autoRotate: boolean;
  reducedMotion: 'auto' | 'on' | 'off';
  lighting: 'cinematic' | 'solar';
  showGrid: boolean;
  showLabels: boolean;
  qualityChosen: boolean;
}

export interface Filters {
  kinds: Record<VisualKind, boolean>;
  confidence: ConfidenceFilter;
  onlyAnomalies: boolean;
  highlightDiscrepancy: boolean;
  regionScope: 'all' | 'pilot';
}

export interface Compare {
  yearA: number;
  yearB: number;
  monthFrom: number;
  monthTo: number;
}

export interface FlyRequest extends LatLng {
  altitude: number;
  duration: number;
  nonce: number;
}

interface State {
  phase: Phase;
  introRun: number;
  view: View;
  regionalId: string | null;
  transition: null | 'entering' | 'leaving';
  dataRange: { start: ISODate; end: ISODate };
  date: ISODate;
  granularity: Granularity;
  layer: DataLayer;
  playing: boolean;
  speed: number;
  selection: Selection;
  panel: { open: boolean; minimized: boolean; expanded: boolean; tab: PanelTab };
  drawer: Drawer;
  settings: Settings;
  filters: Filters;
  compare: Compare;
  fly: FlyRequest | null;
  scanNonce: number;
  systemReducedMotion: boolean;
  camera: { altitude: number; lat: number; lng: number };
  webglFailed: boolean;

  finishIntro: () => void;
  replayIntro: () => void;
  setDataRange: (start: ISODate, end: ISODate) => void;
  setDate: (date: ISODate) => void;
  step: (delta: number) => void;
  setGranularity: (g: Granularity) => void;
  setLayer: (layer: DataLayer) => void;
  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  setSpeed: (speed: number) => void;
  select: (selection: Selection, options?: { openPanel?: boolean; tab?: PanelTab }) => void;
  clearSelection: () => void;
  setPanel: (patch: Partial<State['panel']>) => void;
  setDrawer: (drawer: Drawer) => void;
  toggleDrawer: (drawer: Exclude<Drawer, null>) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  updateFilters: (patch: Partial<Filters>) => void;
  toggleKind: (kind: VisualKind) => void;
  setCompare: (patch: Partial<Compare>) => void;
  flyTo: (target: LatLng & { altitude?: number; duration?: number }) => void;
  requestScan: () => void;
  setSystemReducedMotion: (value: boolean) => void;
  setCamera: (camera: State['camera']) => void;
  setTransition: (t: State['transition']) => void;
  enterRegional: (regionId: string) => void;
  exitRegional: () => void;
  setWebglFailed: (failed: boolean) => void;
}

export const defaultSettings: Settings = {
  quality: 'high',
  scanWave: true,
  ambient: true,
  clouds: true,
  bloom: true,
  // Gira lentamente por defecto (se detiene al seleccionar una celda o con la tecla R).
  autoRotate: true,
  reducedMotion: 'auto',
  lighting: 'cinematic',
  showGrid: true,
  showLabels: true,
  qualityChosen: false,
};

const allKinds: Record<VisualKind, boolean> = {
  none: true, low: true, medium: true, high: true, forecast: true, anomaly: true, unavailable: true,
};

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      phase: 'intro',
      introRun: 0,
      view: 'global',
      regionalId: null,
      transition: null,
      dataRange: { start: '2023-01-01', end: '2026-11-13' },
      date: appConfig.defaultDate,
      granularity: 'day',
      layer: appConfig.defaultLayer,
      playing: false,
      speed: 1,
      selection: null,
      panel: { open: false, minimized: false, expanded: false, tab: 'summary' },
      drawer: null,
      settings: defaultSettings,
      filters: { kinds: allKinds, confidence: 'all', onlyAnomalies: false, highlightDiscrepancy: false, regionScope: 'all' },
      compare: { yearA: 2026, yearB: 2025, monthFrom: 7, monthTo: 10 },
      fly: null,
      scanNonce: 0,
      systemReducedMotion: false,
      camera: { altitude: appConfig.initialView.altitude, lat: appConfig.initialView.lat, lng: appConfig.initialView.lng },
      webglFailed: false,

      finishIntro: () => set((s) => (s.phase === 'observatory' ? s : { phase: 'observatory', scanNonce: s.scanNonce + 1 })),
      replayIntro: () => set((s) => ({ phase: 'intro', introRun: s.introRun + 1, drawer: null, playing: false })),
      setDataRange: (start, end) =>
        set((s) => ({ dataRange: { start, end }, date: clampDate(s.date, start, end) })),
      setDate: (date) => {
        const { start, end } = get().dataRange;
        set({ date: clampDate(date, start, end) });
      },
      step: (delta) => {
        const s = get();
        const next = s.granularity === 'month' ? addMonths(s.date, delta) : addDays(s.date, delta);
        const clamped = clampDate(next, s.dataRange.start, s.dataRange.end);
        set({ date: clamped, playing: s.playing && clamped !== s.date });
      },
      setGranularity: (granularity) => set({ granularity }),
      setLayer: (layer) => set((s) => ({ layer, scanNonce: s.settings.scanWave ? s.scanNonce + 1 : s.scanNonce })),
      setPlaying: (playing) => set({ playing }),
      togglePlaying: () => {
        const s = get();
        if (!s.playing && s.date >= s.dataRange.end) set({ date: s.dataRange.start });
        set({ playing: !s.playing });
      },
      setSpeed: (speed) => set({ speed }),
      select: (selection, options) =>
        set((s) => ({
          selection,
          // Al inspeccionar algo, el planeta deja de girar para no perder la zona.
          settings: selection && s.settings.autoRotate ? { ...s.settings, autoRotate: false } : s.settings,
          panel: selection
            ? {
                ...s.panel,
                open: options?.openPanel ?? true,
                minimized: false,
                tab: options?.tab ?? s.panel.tab,
              }
            : { ...s.panel, open: false },
        })),
      clearSelection: () => set((s) => ({ selection: null, panel: { ...s.panel, open: false, expanded: false } })),
      setPanel: (patch) => set((s) => ({ panel: { ...s.panel, ...patch } })),
      setDrawer: (drawer) => set({ drawer }),
      toggleDrawer: (drawer) => set((s) => ({ drawer: s.drawer === drawer ? null : drawer })),
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      updateFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
      toggleKind: (kind) =>
        set((s) => ({ filters: { ...s.filters, kinds: { ...s.filters.kinds, [kind]: !s.filters.kinds[kind] } } })),
      setCompare: (patch) => set((s) => ({ compare: { ...s.compare, ...patch } })),
      flyTo: (target) =>
        set((s) => ({
          fly: {
            lat: target.lat,
            lng: target.lng,
            altitude: target.altitude ?? Math.min(s.camera.altitude, 1.1),
            duration: target.duration ?? 1400,
            nonce: (s.fly?.nonce ?? 0) + 1,
          },
        })),
      requestScan: () => set((s) => ({ scanNonce: s.scanNonce + 1 })),
      setSystemReducedMotion: (value) => set({ systemReducedMotion: value }),
      setCamera: (camera) => set({ camera }),
      setTransition: (transition) => set({ transition }),
      enterRegional: (regionId) => set({ view: 'regional', regionalId: regionId, playing: false, drawer: null }),
      exitRegional: () => set({ view: 'global' }),
      setWebglFailed: (webglFailed) => set({ webglFailed }),
    }),
    {
      name: 'vigia-settings-v2',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ settings: s.settings }),
      merge: (persisted, current) => {
        const p = persisted as Partial<State> | undefined;
        return { ...current, settings: { ...current.settings, ...(p?.settings ?? {}) } };
      },
    },
  ),
);

/** Movimiento reducido efectivo (preferencia del sistema + ajuste del usuario). */
export function useReducedMotion(): boolean {
  return useStore((s) => (s.settings.reducedMotion === 'auto' ? s.systemReducedMotion : s.settings.reducedMotion === 'on'));
}

export function isReducedMotion(): boolean {
  const s = useStore.getState();
  return s.settings.reducedMotion === 'auto' ? s.systemReducedMotion : s.settings.reducedMotion === 'on';
}
