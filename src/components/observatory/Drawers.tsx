'use client';
/**
 * Cajones flotantes (izquierda): Regiones, Filtros, Configuración, Metodología, Ayuda.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import gsap from 'gsap';
import { ExternalLink, Navigation, Orbit, RotateCcw, Search, X } from 'lucide-react';
import { brand, nameProposals } from '@/config/brand';
import { env } from '@/config/env';
import { useGlobeSnapshot, useMetadata, useRegions } from '@/hooks/data';
import { CATEGORY, LEGEND_ORDER } from '@/lib/science/categories';
import { regionGlances } from '@/scene/globeModel';
import { isReducedMotion, useStore, type Drawer, type Quality } from '@/state/store';
import { DemoBadge, Note, SectionTitle, Segmented, Toggle } from '@/components/ui/primitives';
import { SymbolIcon } from '@/components/ui/SymbolIcon';

const TITLES: Record<Exclude<Drawer, null>, string> = {
  regions: 'Regiones de observación',
  filters: 'Filtros científicos',
  settings: 'Configuración visual',
  about: 'Metodología y fuentes',
  help: 'Ayuda y atajos',
};

export function DrawerHost() {
  const drawer = useStore((s) => s.drawer);
  const setDrawer = useStore((s) => s.setDrawer);
  const [shown, setShown] = useState<Exclude<Drawer, null> | null>(drawer);
  const [lastDrawer, setLastDrawer] = useState(drawer);
  if (drawer !== lastDrawer) {
    setLastDrawer(drawer);
    if (drawer) setShown(drawer);
  }
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !drawer) return;
    if (isReducedMotion()) {
      gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.15 });
      return;
    }
    const tl = gsap.timeline();
    tl.fromTo(el, { opacity: 0, x: -24, clipPath: 'inset(0% 100% 0% 0%)' }, { opacity: 1, x: 0, clipPath: 'inset(0% 0% 0% 0%)', duration: 0.5, ease: 'expo.out' });
    tl.fromTo(el.querySelectorAll('[data-drawer-item]'), { opacity: 0, y: 6 }, { opacity: 1, y: 0, stagger: 0.03, duration: 0.3 }, 0.12);
    return () => {
      tl.kill();
    };
  }, [drawer]);

  useEffect(() => {
    const el = ref.current;
    if (drawer || !shown || !el) return;
    const tween = gsap.to(el, { opacity: 0, x: -16, duration: isReducedMotion() ? 0.1 : 0.22, ease: 'power2.in', onComplete: () => setShown(null) });
    return () => {
      tween.kill();
    };
  }, [drawer, shown]);

  if (!shown) return null;
  return (
    <div ref={ref} className="drawer glass-crystal" role="dialog" aria-modal="false" aria-label={TITLES[shown]}>
      <header className="drawer__head">
        <h2>{TITLES[shown]}</h2>
        <button type="button" className="icon-btn icon-btn--ghost" onClick={() => setDrawer(null)} aria-label="Cerrar">
          <X size={16} />
        </button>
      </header>
      <div className="drawer__body">
        {shown === 'regions' && <RegionsDrawer />}
        {shown === 'filters' && <FiltersDrawer />}
        {shown === 'settings' && <SettingsDrawer />}
        {shown === 'about' && <AboutDrawer />}
        {shown === 'help' && <HelpDrawer />}
      </div>
    </div>
  );
}

function Item({ children }: { children: ReactNode }) {
  return <div data-drawer-item>{children}</div>;
}

/* ------------------------------------------------------------------ */
function RegionsDrawer() {
  const { data: regions } = useRegions();
  const { data: snap } = useGlobeSnapshot();
  const layer = useStore((s) => s.layer);
  const granularity = useStore((s) => s.granularity);
  const select = useStore((s) => s.select);
  const flyTo = useStore((s) => s.flyTo);
  const setTransition = useStore((s) => s.setTransition);
  const selection = useStore((s) => s.selection);
  const [q, setQ] = useState('');
  const glances = useMemo(() => (snap ? regionGlances(snap.records, layer, granularity) : {}), [snap, layer, granularity]);
  const list = (regions ?? []).filter((r) => `${r.name} ${r.country} ${r.admin} ${r.biome}`.toLowerCase().includes(q.toLowerCase()));
  const sorted = [...list].sort((a, b) => Number(b.isPilot) - Number(a.isPilot) || (glances[b.id]?.active ?? 0) - (glances[a.id]?.active ?? 0));

  return (
    <>
      <Item>
        <label className="search">
          <Search size={14} aria-hidden="true" />
          <input type="search" placeholder="Buscar región, país o bioma" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar región" />
        </label>
      </Item>
      <Item>
        <p className="muted small">Toda la Tierra es explorable; estas regiones tienen datos de demostración. La zona piloto científica es la Chiquitanía.</p>
      </Item>
      <ul className="region-list">
        {sorted.map((r) => {
          const g = glances[r.id];
          const kind = g?.worst ?? 'none';
          const isSel = selection?.regionId === r.id;
          return (
            <li key={r.id} data-drawer-item className={isSel ? 'is-selected' : ''}>
              <button
                type="button"
                className="region-list__main"
                onClick={() => {
                  select({ kind: 'region', regionId: r.id });
                  flyTo({ ...r.center, altitude: 0.95 });
                }}
              >
                <SymbolIcon kind={kind} size={15} />
                <span className="region-list__text">
                  <span className="region-list__name">
                    {r.name} {r.isPilot && <span className="badge badge--pilot">piloto</span>}
                  </span>
                  <span className="region-list__meta">{r.admin}, {r.country} · {r.biome}</span>
                  <span className="region-list__meta">
                    {g ? `${g.active} celdas activas · ${g.anomalies} anomalías · ${Math.round(g.unavailableShare * 100)} % sin obs.` : '—'} · temporada {r.seasonLabel}
                  </span>
                </span>
              </button>
              <div className="region-list__actions">
                <button type="button" className="icon-btn icon-btn--small" title="Volar a la región" aria-label={`Volar a ${r.name}`} onClick={() => flyTo({ ...r.center, altitude: 0.95 })}>
                  <Navigation size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--small"
                  title="Explorar zona"
                  aria-label={`Explorar ${r.name}`}
                  onClick={() => {
                    select({ kind: 'region', regionId: r.id }, { openPanel: false });
                    setTransition('entering');
                  }}
                >
                  <Orbit size={14} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ */
function FiltersDrawer() {
  const filters = useStore((s) => s.filters);
  const update = useStore((s) => s.updateFilters);
  const toggleKind = useStore((s) => s.toggleKind);
  const granularity = useStore((s) => s.granularity);
  const setGranularity = useStore((s) => s.setGranularity);
  const reset = () =>
    update({
      kinds: { none: true, low: true, medium: true, high: true, forecast: true, anomaly: true, unavailable: true },
      confidence: 'all',
      onlyAnomalies: false,
      regionScope: 'all',
    });
  return (
    <>
      <Item>
        <SectionTitle>Categorías visibles</SectionTitle>
        <div className="chip-grid">
          {LEGEND_ORDER.map((k) => (
            <button key={k} type="button" className={`chip ${filters.kinds[k] ? 'is-on' : ''}`} onClick={() => toggleKind(k)} aria-pressed={filters.kinds[k]}>
              <SymbolIcon kind={k} size={13} /> {CATEGORY[k].short}
            </button>
          ))}
        </div>
      </Item>
      <Item>
        <SectionTitle>Confianza mínima de detección</SectionTitle>
        <Segmented
          label="Confianza mínima"
          value={filters.confidence}
          onChange={(confidence) => update({ confidence })}
          options={[
            { value: 'all', label: 'Todas' },
            { value: 'nominal', label: 'Nominal + alta' },
            { value: 'high', label: 'Solo alta' },
          ]}
        />
        <p className="muted small">VIIRS: l / n / h · MODIS: &lt;30 / 30–79 / ≥80. Recalcula recuentos e índice.</p>
      </Item>
      <Item>
        <Toggle label="Solo anomalías históricas" description="Oculta todo lo que esté dentro de lo habitual" checked={filters.onlyAnomalies} onChange={(onlyAnomalies) => update({ onlyAnomalies })} />
      </Item>
      <Item>
        <SectionTitle>Ámbito</SectionTitle>
        <Segmented
          label="Ámbito geográfico"
          value={filters.regionScope}
          onChange={(regionScope) => update({ regionScope })}
          options={[{ value: 'all', label: 'Todas las regiones' }, { value: 'pilot', label: 'Solo zona piloto' }]}
        />
      </Item>
      <Item>
        <SectionTitle>Agregación temporal</SectionTitle>
        <Segmented label="Agregación temporal" value={granularity} onChange={setGranularity} options={[{ value: 'day', label: 'Diaria' }, { value: 'month', label: 'Mensual' }]} />
      </Item>
      <Item>
        <button type="button" className="btn" onClick={reset}><RotateCcw size={14} /> Restablecer filtros</button>
      </Item>
    </>
  );
}

/* ------------------------------------------------------------------ */
function SettingsDrawer() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const replayIntro = useStore((s) => s.replayIntro);
  const system = useStore((s) => s.systemReducedMotion);
  return (
    <>
      <Item>
        <SectionTitle>Calidad gráfica</SectionTitle>
        <Segmented<Quality>
          label="Calidad gráfica"
          value={settings.quality}
          onChange={(quality) =>
            update({ quality, qualityChosen: true, bloom: quality === 'high' ? settings.bloom : false, clouds: quality === 'low' ? false : settings.clouds })
          }
          options={[{ value: 'high', label: 'Alta' }, { value: 'balanced', label: 'Equilibrada' }, { value: 'low', label: 'Ligera' }]}
        />
        <p className="muted small">Ajusta texturas (4K/2K), densidad de estrellas, resolución de render y relieve. Reinicia la escena 3D.</p>
      </Item>
      <Item>
        <SectionTitle>Efectos</SectionTitle>
        <Toggle label="Onda de escaneo planetario" checked={settings.scanWave} onChange={(scanWave) => update({ scanWave })} />
        <Toggle label="Ambiente espacial" description="Cometas, polvo y parallax" checked={settings.ambient} onChange={(ambient) => update({ ambient })} />
        <Toggle label="Nubes dinámicas" checked={settings.clouds} disabled={settings.quality === 'low'} onChange={(clouds) => update({ clouds })} />
        <Toggle label="Brillo cinematográfico (bloom)" checked={settings.bloom} disabled={settings.quality === 'low'} onChange={(bloom) => update({ bloom })} />
      </Item>
      <Item>
        <SectionTitle>Movimiento</SectionTitle>
        <Segmented
          label="Movimiento reducido"
          value={settings.reducedMotion}
          onChange={(reducedMotion) => update({ reducedMotion })}
          options={[{ value: 'auto', label: `Sistema (${system ? 'reducido' : 'normal'})` }, { value: 'on', label: 'Reducido' }, { value: 'off', label: 'Completo' }]}
        />
        <Toggle label="Rotación automática del planeta" checked={settings.autoRotate} onChange={(autoRotate) => update({ autoRotate })} />
      </Item>
      <Item>
        <SectionTitle>Planeta</SectionTitle>
        <Segmented
          label="Iluminación"
          value={settings.lighting}
          onChange={(lighting) => update({ lighting })}
          options={[{ value: 'cinematic', label: 'Cinemática' }, { value: 'solar', label: 'Solar (fecha, 16 h UTC)' }]}
        />
        <Toggle label="Retícula H3 al acercarse" checked={settings.showGrid} onChange={(showGrid) => update({ showGrid })} />
        <Toggle label="Etiquetas de regiones" checked={settings.showLabels} onChange={(showLabels) => update({ showLabels })} />
      </Item>
      <Item>
        <button type="button" className="btn" onClick={replayIntro}><RotateCcw size={14} /> Repetir introducción</button>
      </Item>
      <Item>
        <SectionTitle>Fuente de datos</SectionTitle>
        <dl className="kv kv--tight">
          <div><dt>Modo</dt><dd>{env.dataMode === 'mock' ? 'Demostración (sin backend)' : 'API FastAPI'}</dd></div>
          {env.dataMode === 'api' && <div><dt>URL</dt><dd className="mono">{env.apiBaseUrl}</dd></div>}
        </dl>
        <p className="muted small">Se configura con <code>NEXT_PUBLIC_DATA_MODE</code> y <code>NEXT_PUBLIC_API_BASE_URL</code> (ver README).</p>
      </Item>
    </>
  );
}

/* ------------------------------------------------------------------ */
function AboutDrawer() {
  const { data: meta } = useMetadata();
  return (
    <div className="prose">
      <Item><DemoBadge /></Item>
      <Item>
        <p>
          <strong>{brand.name}</strong> es una estrella vigilante: explora la actividad térmica histórica observada por los sensores MODIS y VIIRS,
          la armoniza en una serie comparable sobre una grilla hexagonal H3 y añade un pronóstico experimental para el día siguiente.
          Reto: <em>{brand.challenge}</em> ({brand.event}).
        </p>
      </Item>
      <Item>
        <h3>Qué se muestra</h3>
        <ul>
          <li><b>MODIS</b> y <b>VIIRS</b>: recuentos originales por celda y día (o mes), separados.</li>
          <li><b>Armonizado</b>: índice VIIRS-equivalente 0–1 que combina ambos sensores con un factor de calibración k{meta && Number.isFinite(meta.harmonization.modisCalibrationFactor) ? ` = ${meta.harmonization.modisCalibrationFactor}` : ''}.</li>
          <li><b>Anomalías</b>: actividad muy superior a la climatología de la celda para esa época del año.</li>
          <li><b>Predicción</b>: probabilidad experimental de actividad detectada al día siguiente.</li>
        </ul>
      </Item>
      <Item>
        <h3>Grilla H3</h3>
        <p>Celdas H3 auténticas (h3-js): resolución 6 en la zona piloto (~36,1 km² por celda) y resoluciones 5 y 4 al alejarse. Los polígonos dibujados son los límites reales de cada celda.</p>
      </Item>
      <Item>
        <h3>Reglas de honestidad</h3>
        <ul>
          <li>Un registro ausente no equivale a «no hubo incendio»; los días sin observación se muestran rayados.</li>
          <li>Una detección térmica no es un incendio confirmado ni superficie quemada.</li>
          <li>La predicción no es una alerta operativa de seguridad.</li>
          <li>Los focos satelitales tienen precisión limitada y no deben emplearse como único recurso para proteger vidas o bienes.</li>
        </ul>
      </Item>
      <Item>
        <Note tone="demo">{meta?.disclaimer ?? 'Datos de demostración.'} Las regiones y su estacionalidad son geográficamente plausibles, pero los valores son simulados de forma determinista.</Note>
      </Item>
      <Item>
        <h3>Fuentes previstas</h3>
        <ul className="link-list">
          <li><a href={brand.challengeUrl} target="_blank" rel="noreferrer">Reto oficial NASA Space Apps <ExternalLink size={12} /></a></li>
          <li><a href="https://firms.modaps.eosdis.nasa.gov/download/" target="_blank" rel="noreferrer">NASA FIRMS — archivo MODIS/VIIRS <ExternalLink size={12} /></a></li>
          <li><a href="https://power.larc.nasa.gov/docs/services/api/temporal/daily/" target="_blank" rel="noreferrer">NASA POWER — meteorología diaria <ExternalLink size={12} /></a></li>
          <li><a href="https://h3geo.org/docs/" target="_blank" rel="noreferrer">H3 — índice geoespacial hexagonal <ExternalLink size={12} /></a></li>
          <li><a href="https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api" target="_blank" rel="noreferrer">NASA GIBS — imágenes del mapa regional <ExternalLink size={12} /></a></li>
        </ul>
      </Item>
      <Item>
        <h3>Nombre del proyecto</h3>
        <p className="muted small">«{brand.name}»: el proyecto es una estrella vigilante que observa la Tierra. Alternativas con el mismo concepto: {nameProposals.slice(1).join(' · ')}. Se cambia en <code>src/config/brand.ts</code>.</p>
      </Item>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function HelpDrawer() {
  const rows: [string, string][] = [
    ['Arrastrar', 'Girar el planeta'],
    ['Rueda / pellizco', 'Acercar y alejar'],
    ['Clic en celda', 'Inspeccionar (paneles)'],
    ['Doble clic', 'Explorar zona (vista regional)'],
    ['Clic en un cometa', 'Fragmentarlo'],
    ['Clic en la estrella', 'Hablar con Vigía y escanear'],
    ['Espacio', 'Reproducir / pausar'],
    ['← →', 'Día anterior / siguiente (Mayús: ±30)'],
    ['1 2 3 4', 'MODIS · VIIRS · Armonizado · Predicción'],
    ['M', 'Alternar diario / mensual'],
    ['R', 'Rotación automática'],
    ['S', 'Lanzar escaneo'],
    ['Esc', 'Cerrar panel / volver'],
    ['?', 'Esta ayuda'],
  ];
  return (
    <>
      <Item>
        <table className="data-table shortcuts">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}><th><kbd>{k}</kbd></th><td>{v}</td></tr>
            ))}
          </tbody>
        </table>
      </Item>
      <Item>
        <p className="muted small">En pantallas táctiles, usa el botón «Explorar zona» del panel en lugar del doble toque.</p>
      </Item>
    </>
  );
}
