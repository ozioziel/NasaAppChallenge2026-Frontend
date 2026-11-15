# NasaAppChallenge2026-Frontend

**Vigía** — una estrella vigilante que observa la Tierra: observatorio 3D de actividad térmica terrestre para el reto **Harmonization of MODIS and VIIRS Hot Spots** (NASA Space Apps Challenge 2026).
Planeta interactivo con celdas **H3 auténticas**, capas **MODIS / VIIRS / Armonizado / Predicción experimental**, calendario histórico,
comparación de sensores, vista regional inmersiva y una estrella guardiana («Vigía») que representa al sistema de observación.

> ⚠️ Mientras no se conecte el backend, **todos los valores son datos de demostración** (generador determinista) y así se indica en la interfaz.
> Una detección térmica no es un incendio confirmado y la predicción no es una alerta operativa.

## Requisitos

- Node.js ≥ 20.9 (probado con Node 24)
- npm

## Ejecutar

```bash
npm install
npm run dev        # http://localhost:3000
```

Otros scripts:

```bash
npm run build      # build de producción
npm run start      # servir el build
npm run lint       # ESLint
npm run typecheck  # TypeScript sin emitir
```

## Configuración (`.env.local`)

Copia `.env.example` a `.env.local`:

| Variable | Valor por defecto | Uso |
|---|---|---|
| `NEXT_PUBLIC_DATA_MODE` | `mock` | `mock` = datos de demostración; `api` = backend FastAPI |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | URL del backend |
| `NEXT_PUBLIC_API_TIMEOUT_MS` | `15000` | Tiempo máximo por petición |
| `NEXT_PUBLIC_ENABLE_GIBS` | `true` | Mapa base satelital (NASA GIBS, sin credenciales) en la vista regional |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | vacío | Integración futura de Google Maps (adaptador pendiente) |

## Cambiar el nombre del proyecto

El producto se llama **Vigía**, como la estrella guardiana (sin cara; su rasgo es el visor de vigía). Todo el branding sale de
**`src/config/brand.ts`** (`name`, `fullName`, `mascotName`, alternativas en `nameProposals`).
El favicon (`src/app/icon.svg`) usa la misma silueta que la mascota; se regenera con `node scripts/generate-icon.mjs`.
Parámetros de la experiencia (fecha inicial, vista inicial, umbrales de zoom, duración de la intro) en **`src/config/app.ts`**.

## Conectar FastAPI

1. `NEXT_PUBLIC_DATA_MODE=api` y `NEXT_PUBLIC_API_BASE_URL=<url>` en `.env.local`.
2. El backend debe exponer como mínimo (contratos del plan científico):
   - `GET /activity?date=YYYY-MM-DD&granularity=day|month&region=a,b&confidence=all|nominal|high`
     → `{ "date": "...", "records": [HarmonizedDaily] }` con `h3_id, date, modis_detected, viirs_detected, activity_index, availability_flag` (res 6).
   - `GET /predictions?date=YYYY-MM-DD&region=a,b` → `[ { h3_id, forecast_date, probability, model_version } ]`.
3. Endpoints opcionales (si faltan, la interfaz degrada sin inventar datos): `/meta`, `/regions`, `/regions/{id}/cells`,
   `/activity/series`, `/detections`, `/predictions/detail`, `/model`, `/weather`, `/news`.
   Contrato completo y comentado en `src/lib/data/api/endpoints.ts`; mapeo de respuestas en `src/lib/data/api/adapters.ts`.
4. Los componentes no cambian: consumen `DataService` (`src/lib/data/service.ts`) a través de los hooks de `src/hooks/data.ts`.
   La agregación espacial a res 5/4 se hace en el cliente con la misma lógica en ambos modos (`src/lib/geo/aggregate.ts`).

## Arquitectura

```
src/
  app/                    layout, página, estilos globales, fuentes locales
  config/                 marca (brand.ts), parámetros (app.ts), entorno (env.ts)
  lib/
    types/domain.ts       contratos de datos (Detection, HarmonizedDaily, Prediction…)
    data/service.ts       interfaz DataService + selección mock/api
    data/mock/            generador determinista (regiones, universo H3, servicio)
    data/api/             cliente HTTP, endpoints y adaptadores de respuesta
    geo/                  utilidades H3 (polígonos GeoJSON) y agregación
    science/categories.ts sistema de categorías (color + símbolo + comportamiento)
    time/dates.ts         fechas UTC
  state/                  estado global (zustand) y mensajes de la estrella
  hooks/                  datos (React Query), entorno, viewport
  scene/                  Three.js/GLSL: material terrestre, nubes, espacio, onda de escaneo,
                          marcadores SDF, retícula H3, estrella guardiana, intro, motor del observatorio
  components/
    globe/                react-globe.gl + capas H3
    intro/                introducción cinematográfica
    observatory/          HUD: barra superior, línea temporal, leyenda, cámara, cajones
    dashboard/            panel holográfico con módulos (Resumen, Calendario, Sensores, Predicción, Avanzado)
    regional/             vista regional (Leaflet + NASA GIBS), transición de nubes
    charts/               gráficos SVG
    ui/                   primitivas (panel holográfico, pestañas, segmentados, símbolos)
```

## Interacción

| Gesto / tecla | Acción |
|---|---|
| Arrastrar · rueda/pellizco | Girar · acercar |
| Clic en celda | Inspeccionar (paneles holográficos) |
| Doble clic / botón «Explorar zona» | Vista regional inmersiva |
| Espacio · ← → | Reproducir/pausar · día anterior/siguiente (Mayús ±30) |
| 1 2 3 4 | MODIS · VIIRS · Armonizado · Predicción |
| M · R · S | Diario/mensual · rotación · escaneo |
| Esc · ? | Cerrar/volver · ayuda |

## Créditos de datos y recursos

- Texturas terrestres: NASA Blue Marble / Black Marble (vía ejemplos de three-globe).
- Mapa regional: NASA EOSDIS GIBS (imágenes VIIRS del día; las celdas superpuestas son de demostración).
- Fuentes: Instrument Sans e IBM Plex Mono (SIL Open Font License, en `src/app/fonts`).
- Librerías: Next.js, React, react-globe.gl / three-globe, Three.js, GSAP, h3-js, Leaflet, zustand, TanStack Query.
