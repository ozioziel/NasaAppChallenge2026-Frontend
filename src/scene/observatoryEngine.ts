/**
 * Motor imperativo del observatorio. Se engancha a la escena de react-globe.gl y añade:
 * universo de fondo, nubes, iluminación solar/cinemática, onda de escaneo, marcadores por
 * símbolo, retícula H3, la estrella guardiana (anclada a la cámara), cometas
 * interactivos, desplazamiento de vista para paneles y post-procesado opcional (bloom).
 *
 * Todo se actualiza en `scene.onBeforeRender`, sincronizado con el render de globe.gl
 * (sin bucles requestAnimationFrame adicionales), y se libera en `dispose()`.
 */
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { GlobeMethods } from 'react-globe.gl';
import type { Quality } from '@/state/store';
import type { LatLng } from '@/lib/types/domain';
import { latLngToUnit } from '@/lib/geo/h3';
import { createClouds, type CloudLayer, type EarthMaterialHandle } from './earth';
import { createComets, createDust, createStarfield, type CometSystem, type Dust, type Starfield } from './space';
import {
  createGridLayer, createScan, createSymbolLayer, CapMaterials, GLOBE_RADIUS, polarToCartesian,
  type GridLayer, type ScanController, type SymbolDatum, type SymbolLayer,
} from './dataLayers';
import { createGuardianStar, type GuardianStar } from './guardianStar';
import { createMoon, type Moon } from './moon';
import { appConfig } from '@/config/app';

export interface EngineEffects {
  scanWave: boolean;
  ambient: boolean;
  clouds: boolean;
  bloom: boolean;
  reducedMotion: boolean;
  lighting: 'cinematic' | 'solar';
  showGrid: boolean;
}

export interface FrameInfo {
  width: number;
  height: number;
  altitude: number;
  /** Proyecta lat/lng/alt a píxeles; null si queda detrás del planeta. */
  project: (lat: number, lng: number, altitude?: number) => { x: number; y: number } | null;
  mascotScreen: { x: number; y: number; r: number } | null;
}

interface EngineOptions {
  quality: Quality;
  /** Se invoca cuando la cámara cambia (interacción o animación programática). */
  onCamera?: (pov: { lat: number; lng: number; altitude: number }) => void;
  onRegionPass?: (regionId: string) => void;
  onMascotPoke?: () => void;
  onCometBurst?: () => void;
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

/** Subsolar aproximado para una fecha (UTC) y hora decimal. */
export function subsolarPoint(isoDate: string, utcHours: number): LatLng {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const doy = (d.getTime() - start) / 86_400_000;
  const g = ((2 * Math.PI) / 365) * (doy - 1 + (utcHours - 12) / 24);
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const lng = -15 * (utcHours - 12 + eqTime / 60);
  return { lat: (decl * 180) / Math.PI, lng: ((lng + 540) % 360) - 180 };
}

export class ObservatoryEngine {
  readonly scan: ScanController;
  readonly capMaterials: CapMaterials;
  readonly mascot: GuardianStar;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private starfield: Starfield;
  private dust: Dust;
  private comets: CometSystem;
  private clouds: CloudLayer | null = null;
  private moon: Moon;
  private symbols: SymbolLayer;
  private grid: GridLayer;
  private earth: EarthMaterialHandle | null = null;
  private bloom: UnrealBloomPass | null = null;
  private output: OutputPass | null = null;
  private lastTime = performance.now();
  private elapsed = 0;
  private lastCamPos = new THREE.Vector3(Infinity, 0, 0);
  private effects: EngineEffects = {
    scanWave: true, ambient: true, clouds: true, bloom: false, reducedMotion: false, lighting: 'cinematic', showGrid: true,
  };
  private solarDate = '2026-09-08';
  private gridVisibleBelow = 0.45;
  private viewShift = 0;
  private viewShiftTarget = 0;
  private appliedShift = { x: NaN, w: 0, h: 0 };
  private focusWorld: THREE.Vector3 | null = null;
  private regions: { id: string; unit: THREE.Vector3 }[] = [];
  private lastScanAngle = 0;
  private frameListeners = new Set<(info: FrameInfo) => void>();
  private disposed = false;
  private mascotScreen: FrameInfo['mascotScreen'] = null;
  private perch = { x: 0.2, y: 0.25, scale: 0.055 };
  private pointerDown: { x: number; y: number; t: number } | null = null;
  private previousOnBeforeRender: THREE.Scene['onBeforeRender'];
  private canvas: HTMLCanvasElement;
  private pixelRatio = 1;
  private visible = true;

  constructor(
    private globe: GlobeMethods,
    private options: EngineOptions,
  ) {
    this.scene = globe.scene();
    this.camera = globe.camera() as THREE.PerspectiveCamera;
    this.renderer = globe.renderer() as THREE.WebGLRenderer;
    this.canvas = this.renderer.domElement;
    const quality = options.quality;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : quality === 'balanced' ? 1.5 : 1);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.globe.postProcessingComposer().setPixelRatio(this.pixelRatio);

    this.camera.far = 160_000;
    this.camera.updateProjectionMatrix();

    this.starfield = createStarfield(quality, 22_000, this.pixelRatio);
    this.scene.add(this.starfield.group);
    this.dust = createDust(quality, 140, 1500, this.pixelRatio);
    this.scene.add(this.dust.points);
    this.comets = createComets(this.pixelRatio);
    this.scene.add(this.comets.group);

    this.scan = createScan();
    this.scene.add(this.scan.mesh);
    this.capMaterials = new CapMaterials(this.scan.uniforms);
    this.symbols = createSymbolLayer(this.scan.uniforms, this.pixelRatio);
    this.scene.add(this.symbols.points);
    this.grid = createGridLayer(this.scan.uniforms);
    this.scene.add(this.grid.lines);

    if (quality !== 'low') {
      this.clouds = createClouds(GLOBE_RADIUS * 1.0016, quality);
      this.scene.add(this.clouds.mesh);
    }

    const v = appConfig.initialView;
    this.moon = createMoon(polarToCartesian(v.lat, v.lng, 0, new THREE.Vector3()).normalize());
    this.scene.add(this.moon.mesh);

    this.mascot = createGuardianStar({ quality });
    this.scene.add(this.camera);
    this.camera.add(this.mascot.root);

    this.previousOnBeforeRender = this.scene.onBeforeRender;
    this.scene.onBeforeRender = (...args) => {
      this.previousOnBeforeRender.apply(this.scene, args);
      this.tick();
    };

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointermove', this.onPointerMove);

    // Precompila shaders en paralelo (mientras corre la intro) para evitar tirones. Se
    // retrasa un poco para no competir con la compilación de la propia intro.
    for (const kind of ['low', 'medium', 'high', 'forecast', 'unavailable', 'none'] as const) this.capMaterials.get(kind, 'normal');
    this.compileTimer = window.setTimeout(() => {
      if (!this.disposed) this.renderer.compileAsync(this.scene, this.camera).catch(() => undefined);
    }, 1800);
  }

  private compileTimer: number | undefined;

  /* ---------------------------------------------------------------- */
  /* Configuración                                                    */
  /* ---------------------------------------------------------------- */
  setEarth(handle: EarthMaterialHandle) {
    this.earth = handle;
  }

  setEffects(effects: EngineEffects) {
    this.effects = effects;
    this.starfield.group.visible = true;
    this.dust.points.visible = effects.ambient;
    this.scan.setIntensity(effects.reducedMotion ? 0.55 : 1);
    this.setBloom(effects.bloom && this.options.quality !== 'low');
  }

  setSolarDate(date: string) {
    this.solarDate = date;
  }

  private setBloom(on: boolean) {
    const composer = this.globe.postProcessingComposer();
    if (on && !this.bloom) {
      const size = this.renderer.getSize(new THREE.Vector2());
      this.bloom = new UnrealBloomPass(size, 0.42, 0.55, 0.8);
      this.output = new OutputPass();
      composer.addPass(this.bloom);
      composer.addPass(this.output);
    } else if (this.bloom) {
      this.bloom.enabled = on;
      if (this.output) this.output.enabled = on;
    }
  }

  setRegions(regions: { id: string; center: LatLng }[]) {
    this.regions = regions.map((r) => {
      const [x, y, z] = latLngToUnit(r.center);
      return { id: r.id, unit: new THREE.Vector3(x, y, z) };
    });
  }

  setSymbols(data: SymbolDatum[], sizePx: number) {
    this.symbols.setData(data);
    this.symbols.setSize(sizePx);
  }

  setGrid(cells: string[], altitude: number, visibleBelowAltitude: number) {
    this.grid.setCells(cells, altitude);
    this.gridVisibleBelow = visibleBelowAltitude;
  }

  /** Punto que la estrella observa (celda/región seleccionada). */
  setFocus(point: LatLng | null) {
    this.focusWorld = point ? polarToCartesian(point.lat, point.lng, 0.01, new THREE.Vector3()) : null;
    this.mascot.lookAtWorld(this.focusWorld);
    if (point) this.mascot.react('select');
  }

  /** Desplaza el centro de proyección (px) para dejar sitio a los paneles. */
  setViewShift(px: number) {
    this.viewShiftTarget = px;
  }

  setPerch(perch: { x: number; y: number; scale: number }) {
    this.perch = perch;
  }

  setVisible(visible: boolean) {
    this.visible = visible;
  }

  addFrameListener(fn: (info: FrameInfo) => void) {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  /** Lanza la onda de escaneo desde la dirección de la estrella. */
  triggerScan(options: { hide?: boolean } = {}) {
    if (!this.effects.scanWave) return;
    this.mascot.root.getWorldPosition(tmpV);
    const origin = tmpV.lengthSq() > 1 ? tmpV.clone().normalize() : this.camera.position.clone().normalize();
    // Origen: punto de la superficie más cercano a la estrella, desplazado hacia el centro de la vista.
    origin.lerp(this.camera.position.clone().normalize(), 0.45).normalize();
    this.lastScanAngle = 0;
    this.scan.trigger(origin, { hide: options.hide, duration: this.effects.reducedMotion ? 3.2 : 4.8 });
    this.mascot.react('scan');
  }

  /* ---------------------------------------------------------------- */
  /* Bucle por fotograma                                              */
  /* ---------------------------------------------------------------- */
  private tick() {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.elapsed += dt;
    const t = this.elapsed;
    const camera = this.camera;
    const camDist = camera.position.length();
    const altitude = camDist / GLOBE_RADIUS - 1;
    if (this.options.onCamera && camera.position.distanceToSquared(this.lastCamPos) > 1e-4) {
      this.lastCamPos.copy(camera.position);
      const geo = this.globe.toGeoCoords(camera.position);
      this.options.onCamera({ lat: geo.lat, lng: geo.lng, altitude: geo.altitude });
    }
    const size = this.renderer.getSize(new THREE.Vector2());
    const width = size.x;
    const height = size.y;

    this.applyViewShift(dt, width, height);

    // Sol: cinemático (relativo a la cámara) o posición solar real.
    const sun = tmpV2;
    if (this.effects.lighting === 'solar') {
      const p = subsolarPoint(this.solarDate, 16);
      polarToCartesian(p.lat, p.lng, 0, sun).normalize();
    } else {
      const camDir = tmpV.copy(camera.position).normalize();
      const right = new THREE.Vector3(0, 1, 0).cross(camDir).normalize();
      const up = camDir.clone().cross(right).normalize();
      sun.copy(camDir).multiplyScalar(0.62).addScaledVector(right, -0.7).addScaledVector(up, 0.38).normalize();
    }
    this.earth?.setSun(sun);
    if (this.clouds) {
      this.clouds.setSun(sun);
      const cloudTarget = this.effects.clouds ? 0.62 * THREE.MathUtils.smoothstep(altitude, 0.35, 1.5) : 0;
      this.clouds.setOpacity(cloudTarget);
      this.clouds.update(this.effects.reducedMotion ? dt * 0.3 : dt);
      this.clouds.mesh.visible = cloudTarget > 0.001 || (this.clouds.mesh.material as THREE.ShaderMaterial).uniforms.opacity.value > 0.002;
    }

    this.moon.update(this.effects.reducedMotion ? 0 : dt, sun);
    this.starfield.update(t);
    if (this.effects.ambient) this.dust.update(t, this.effects.reducedMotion ? 0 : dt);
    this.comets.update(dt, camera, this.effects.ambient && !this.effects.reducedMotion && this.visible);

    // Escaneo + eventos de paso por región.
    const before = this.scan.angle();
    this.scan.update(dt);
    const after = this.scan.angle();
    if (this.scan.isActive() || after !== before) {
      const origin = this.scan.uniforms.uScanOrigin.value;
      for (const r of this.regions) {
        const a = Math.acos(THREE.MathUtils.clamp(r.unit.dot(origin), -1, 1));
        if (a > this.lastScanAngle && a <= after) this.options.onRegionPass?.(r.id);
      }
      this.lastScanAngle = after;
    }

    // Retícula H3: visible al acercarse.
    const gridOpacity = this.effects.showGrid ? 0.16 * (1 - THREE.MathUtils.smoothstep(altitude, this.gridVisibleBelow * 0.55, this.gridVisibleBelow)) : 0;
    this.grid.setOpacity(gridOpacity);
    this.grid.lines.visible = gridOpacity > 0.002 || this.scan.isActive();

    this.updateMascot(t, dt, width, height, altitude);

    if (this.frameListeners.size) {
      const info: FrameInfo = {
        width,
        height,
        altitude,
        mascotScreen: this.mascotScreen,
        project: (lat, lng, alt = 0) => {
          const p = polarToCartesian(lat, lng, alt, new THREE.Vector3());
          const toCam = camera.position.clone().sub(p).normalize();
          if (p.clone().normalize().dot(toCam) < 0.02) return null;
          p.project(camera);
          if (p.z > 1) return null;
          return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
        },
      };
      this.frameListeners.forEach((fn) => fn(info));
    }
  }

  private applyViewShift(dt: number, width: number, height: number) {
    this.viewShift += (this.viewShiftTarget - this.viewShift) * Math.min(1, dt * 4.5);
    if (Math.abs(this.viewShift - this.viewShiftTarget) < 0.25) this.viewShift = this.viewShiftTarget;
    const x = Math.round(this.viewShift);
    if (x === this.appliedShift.x && width === this.appliedShift.w && height === this.appliedShift.h) return;
    if (x === 0) this.camera.clearViewOffset();
    else this.camera.setViewOffset(width, height, x, 0, width, height);
    this.camera.updateProjectionMatrix();
    this.appliedShift = { x, w: width, h: height };
  }

  private updateMascot(t: number, dt: number, width: number, height: number, altitude: number) {
    const root = this.mascot.root;
    const surface = Math.max(0.05, (altitude) * GLOBE_RADIUS);
    const d = Math.min(30, surface * 0.42);
    // Dirección de la percha en espacio de cámara (respeta el desplazamiento de vista).
    const ndc = new THREE.Vector3(this.perch.x * 2 - 1, -(this.perch.y * 2 - 1), 0.5);
    const world = ndc.unproject(this.camera);
    const local = this.camera.worldToLocal(world.clone()).normalize();
    const k = d / Math.max(0.05, -local.z);
    root.position.copy(local).multiplyScalar(k);
    root.scale.setScalar(d * this.perch.scale);
    root.visible = altitude > 0.012;
    this.mascot.update(t, this.effects.reducedMotion ? dt * 0.4 : dt);

    // Posición en pantalla (para clics y textos de estado).
    root.getWorldPosition(tmpV);
    const p = tmpV.clone().project(this.camera);
    const edge = tmpV.clone().add(new THREE.Vector3(1.2 * d * this.perch.scale, 0, 0).applyQuaternion(this.camera.quaternion)).project(this.camera);
    const sx = ((p.x + 1) / 2) * width;
    const sy = ((1 - p.y) / 2) * height;
    const ex = ((edge.x + 1) / 2) * width;
    this.mascotScreen = { x: sx, y: sy, r: Math.abs(ex - sx) };
  }

  /* ---------------------------------------------------------------- */
  /* Puntero (cometas y estrella)                                     */
  /* ---------------------------------------------------------------- */
  private onPointerDown = (e: PointerEvent) => {
    this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private onPointerMove = (e: PointerEvent) => {
    const m = this.mascotScreen;
    if (!m) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const near = Math.hypot(x - m.x, y - m.y) < m.r * 2.2;
    if (near && !this.focusWorld) {
      // Curiosidad: mira hacia el cursor cuando se acerca.
      const yaw = THREE.MathUtils.clamp((x - m.x) / (m.r * 4), -0.8, 0.8);
      const pitch = THREE.MathUtils.clamp((y - m.y) / (m.r * 4), -0.6, 0.6);
      this.mascot.setLookAngles(yaw, pitch);
    } else if (!near && !this.focusWorld) {
      this.mascot.lookAtWorld(null);
    }
    const overMascot = Math.hypot(x - m.x, y - m.y) < m.r;
    const overComet = !overMascot && this.comets.isNear(x, y, rect.width, rect.height, this.camera) && !this.globe.toGlobeCoords(x, y);
    // Solo se fuerza el cursor sobre la estrella o un cometa; el resto lo gestiona globe.gl.
    if (overMascot || overComet) this.canvas.style.cursor = 'pointer';
    else if (this.canvas.style.cursor === 'pointer' && this.cursorForced) this.canvas.style.cursor = '';
    this.cursorForced = overMascot || overComet;
  };

  private cursorForced = false;

  private onPointerUp = (e: PointerEvent) => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const m = this.mascotScreen;
    if (m && Math.hypot(x - m.x, y - m.y) < m.r) {
      this.mascot.react('poke');
      this.options.onMascotPoke?.();
      return;
    }
    if (this.globe.toGlobeCoords(x, y)) return; // el planeta está delante
    if (this.comets.hitTest(x, y, rect.width, rect.height, this.camera)) this.options.onCometBurst?.();
  };

  /* ---------------------------------------------------------------- */
  dispose() {
    this.disposed = true;
    window.clearTimeout(this.compileTimer);
    this.scene.onBeforeRender = this.previousOnBeforeRender;
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.scene.remove(this.starfield.group, this.dust.points, this.comets.group, this.scan.mesh, this.symbols.points, this.grid.lines);
    if (this.clouds) this.scene.remove(this.clouds.mesh);
    this.scene.remove(this.moon.mesh);
    this.moon.dispose();
    this.camera.remove(this.mascot.root);
    this.starfield.dispose();
    this.dust.dispose();
    this.comets.dispose();
    this.scan.dispose();
    this.symbols.dispose();
    this.grid.dispose();
    this.clouds?.dispose();
    this.capMaterials.dispose();
    this.mascot.dispose();
    if (this.bloom) {
      const composer = this.globe.postProcessingComposer();
      composer.removePass(this.bloom);
      if (this.output) composer.removePass(this.output);
      this.bloom.dispose();
      this.output?.dispose();
    }
    this.frameListeners.clear();
  }
}
