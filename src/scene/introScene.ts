/**
 * Escena de introducción (renderizador propio, independiente del globo).
 *
 * Historia sin texto: espacio en calma → una luz revela a la estrella → despierta →
 * se coloca el visor → mira alrededor y descubre la Tierra → se orienta y viaja con la
 * cámara → el planeta crece con su atmósfera → primer pulso de observación → relevo
 * al observatorio con el mismo encuadre (transición continua).
 */
import * as THREE from 'three';
import gsap from 'gsap';
import { appConfig } from '@/config/app';
import { createAtmosphere, createClouds, createEarthMaterial, type CloudLayer, type EarthMaterialHandle } from './earth';
import { createDust, createStarfield, type Dust, type Starfield } from './space';
import { createGuardianStar, type GuardianStar } from './guardianStar';
import { createScan, GLOBE_RADIUS, polarToCartesian, type ScanController } from './dataLayers';
import { perchFor } from './perch';
import { createMoon, type Moon } from './moon';

export interface IntroCallbacks {
  /** Momento de reanudar el render del observatorio (antes del relevo). */
  onPrepare: () => void;
  /** Relevo: el observatorio pasa a primer plano. */
  onHandoff: () => void;
  /** La capa de intro terminó de desvanecerse. */
  onDone: () => void;
  /** Opacidad de la marca (texto DOM). */
  onWordmark?: (opacity: number) => void;
}

export class IntroScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private starfield: Starfield;
  private dust: Dust;
  private earth: EarthMaterialHandle;
  private earthMesh: THREE.Mesh;
  private atmosphere: THREE.Mesh;
  private clouds: CloudLayer;
  private scan: ScanController;
  private moon: Moon;
  private star: GuardianStar;
  private timeline: gsap.core.Timeline | null = null;
  private frame = 0;
  private lastTime = 0;
  private elapsed = 0;
  private canvas: HTMLCanvasElement;
  private handedOff = false;
  private finished = false;
  private watchdog: number | undefined;
  private params = { stars: 0, travel: 0, lookMix: 0, starPos: 0, fade: 1, earth: 0 };
  private path: THREE.CatmullRomCurve3;
  private finalPos: THREE.Vector3;
  private startLook: THREE.Vector3;
  private heroPos = new THREE.Vector3(0, -0.15, -9);

  constructor(
    container: HTMLElement,
    private options: { reduced: boolean; quality: 'high' | 'balanced' | 'low'; callbacks: IntroCallbacks },
  ) {
    const lowPower = options.quality === 'low';
    // Canvas propio por ejecución: un contexto WebGL liberado nunca se reutiliza.
    const canvas = document.createElement('canvas');
    canvas.className = 'intro__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.prepend(canvas);
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1 : 1.75));
    this.renderer.setClearColor('#010309', 1);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 160_000);
    this.scene.add(this.camera);

    const q = lowPower ? 'low' : 'balanced';
    const pr = this.renderer.getPixelRatio();
    this.starfield = createStarfield(q, 22_000, pr);
    this.scene.add(this.starfield.group);
    this.dust = createDust(q, 120, 5200, pr, 19);
    this.scene.add(this.dust.points);

    this.earth = createEarthMaterial(q);
    this.earthMesh = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_RADIUS, 128, 96), this.earth.material);
    this.earthMesh.rotation.y = -Math.PI / 2;
    this.scene.add(this.earthMesh);
    this.atmosphere = createAtmosphere(GLOBE_RADIUS);
    this.scene.add(this.atmosphere);
    this.clouds = createClouds(GLOBE_RADIUS * 1.0016, q);
    this.clouds.setOpacity(0.62);
    this.scene.add(this.clouds.mesh);
    this.scan = createScan();
    this.scene.add(this.scan.mesh);
    const v0 = appConfig.initialView;
    this.moon = createMoon(polarToCartesian(v0.lat, v0.lng, 0, new THREE.Vector3()).normalize());
    this.scene.add(this.moon.mesh);

    this.scene.add(new THREE.AmbientLight(0xcccccc, Math.PI * 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.6 * Math.PI);
    key.position.set(-1, 1, 1);
    this.scene.add(key);

    this.star = createGuardianStar({ quality: q });
    Object.assign(this.star.state, { presence: 0, awake: 0, visor: 0, hud: 0 });
    this.camera.add(this.star.root);

    // Trayectoria de cámara: lejos → aproximación → encuadre final del observatorio.
    const v = appConfig.initialView;
    this.finalPos = polarToCartesian(v.lat, v.lng, v.altitude);
    const f = this.finalPos.clone().normalize();
    const r = new THREE.Vector3(0, 1, 0).cross(f).normalize();
    const u = f.clone().cross(r).normalize();
    const start = f.clone().multiplyScalar(5600).addScaledVector(r, -1100).addScaledVector(u, 320);
    const mid = f.clone().multiplyScalar(1500).addScaledVector(r, -420).addScaledVector(u, 140);
    this.path = new THREE.CatmullRomCurve3([start, mid, this.finalPos.clone()], false, 'centripetal');
    // Al principio mira hacia otro lado (la Tierra queda fuera de cuadro, a la derecha).
    const toEarth = start.clone().negate().normalize();
    this.startLook = toEarth.applyAxisAngle(u, 0.62).multiplyScalar(1000).add(start);

    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  };

  private perchPosition(): { pos: THREE.Vector3; scale: number } {
    const perch = perchFor(window.innerWidth, window.innerHeight);
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const nx = perch.x * 2 - 1;
    const ny = -(perch.y * 2 - 1);
    const dir = new THREE.Vector3(nx * tanH * this.camera.aspect, ny * tanH, -1).normalize();
    const surface = appConfig.initialView.altitude * GLOBE_RADIUS;
    const d = Math.min(30, surface * 0.42);
    return { pos: dir.multiplyScalar(d / -dir.z), scale: d * perch.scale };
  }

  /**
   * Compila los shaders en paralelo (KHR_parallel_shader_compile) antes de empezar,
   * para que la coreografía no se congele; con un tope de espera por seguridad.
   */
  start() {
    let begun = false;
    const begin = () => {
      if (begun || this.finished) return;
      begun = true;
      this.compiled = true;
      this.lastTime = performance.now();
      this.begin();
      this.loop();
    };
    window.setTimeout(begin, 5000);
    this.renderer.compileAsync(this.scene, this.camera).then(begin, begin);
  }

  private compiled = false;

  private begin() {
    const p = this.params;
    const s = this.star.state;
    const cb = this.options.callbacks;
    const tl = gsap.timeline();
    this.timeline = tl;
    const handoff = () => this.handoff();

    if (this.options.reduced || this.options.quality === 'low') {
      // Versión simplificada: sin viaje de cámara ni movimientos amplios.
      Object.assign(p, { travel: 1, lookMix: 1, starPos: 1, earth: 1 });
      Object.assign(s, { presence: 0, awake: 1, visor: 1, hud: 1, flex: 0.2 });
      this.star.lookAtWorld(new THREE.Vector3());
      tl.call(() => cb.onPrepare(), [], 0.1);
      tl.to(p, { stars: 1, duration: 0.8, ease: 'power1.out' }, 0);
      tl.to(s, { presence: 1, duration: 0.9, ease: 'power2.out' }, 0.3);
      tl.call(() => cb.onWordmark?.(1), [], 0.6);
      tl.call(() => this.star.react('scan'), [], 1.5);
      tl.call(() => cb.onWordmark?.(0), [], 2.1);
      tl.call(handoff, [], 2.2);
    } else {
      Object.assign(s, { presence: 0, awake: 0, visor: 0, hud: 0, flex: 0.15 });
      this.star.setLookAngles(-0.15, 0.12);
      // 1 · Espacio en calma.
      tl.to(p, { stars: 1, duration: 1.8, ease: 'power1.out' }, 0);
      // 2 · Una luz revela a la estrella (dormida).
      tl.to(s, { presence: 1, awake: 0.14, duration: 1.5, ease: 'power2.out' }, 0.9);
      // 3 · Despierta: calor, estiramiento, puntas activas.
      tl.to(s, { awake: 1, flex: 0.55, duration: 1.3, ease: 'power2.inOut' }, 2.35);
      tl.to(s, { presence: 1.09, duration: 0.32, yoyo: true, repeat: 1, ease: 'sine.inOut' }, 2.85);
      tl.call(() => this.star.setLookAngles(0, 0), [], 2.6);
      // 4 · Se coloca el visor de vigía.
      tl.to(s, { visor: 1, duration: 0.85, ease: 'back.out(1.7)' }, 3.55);
      tl.to(s, { hud: 1, duration: 0.55, ease: 'steps(5)' }, 4.2);
      // 5 · Mira alrededor y descubre la Tierra (con una segunda mirada).
      tl.call(() => this.star.setLookAngles(-0.5, 0.08), [], 4.55);
      tl.call(() => this.star.setLookAngles(0.6, -0.02), [], 5.0);
      tl.to(p, { lookMix: 1, earth: 1, duration: 1.5, ease: 'power2.inOut' }, 5.0);
      tl.call(() => { this.star.setLookAngles(0.25, 0.05); this.star.react('curious'); }, [], 5.5);
      tl.call(() => this.star.setLookAngles(0.7, 0.0), [], 5.78);
      // 6-7 · Se orienta y viaja; la cámara acompaña.
      tl.call(() => this.star.lookAtWorld(new THREE.Vector3()), [], 6.1);
      tl.to(p, { travel: 1, duration: 2.55, ease: 'power2.inOut' }, 6.0);
      tl.to(p, { starPos: 1, duration: 2.25, ease: 'power2.inOut' }, 6.25);
      tl.to(s, { flex: 0.35, duration: 1.5 }, 6.4);
      tl.call(() => cb.onPrepare(), [], 6.7);
      tl.call(() => cb.onWordmark?.(1), [], 6.9);
      // 9 · Primer pulso de observación.
      tl.call(() => {
        this.star.react('scan');
        const origin = this.camera.position.clone().normalize();
        this.scan.trigger(origin, { duration: 4.2 });
      }, [], 8.2);
      tl.call(() => cb.onWordmark?.(0), [], 8.45);
      // 10 · Relevo al observatorio.
      tl.call(handoff, [], 8.6);
    }

    this.watchdog = window.setTimeout(() => this.skip(), (appConfig.introDuration + 4) * 1000);
  }

  private handoff() {
    if (this.handedOff) return;
    this.handedOff = true;
    // Encuadre final garantizado (aunque la línea de tiempo se haya retrasado).
    this.timeline?.kill();
    gsap.to(this.params, { travel: 1, lookMix: 1, starPos: 1, earth: 1, duration: 0.25, ease: 'power1.out' });
    Object.assign(this.star.state, { presence: 1, awake: 1, visor: 1, hud: 1 });
    this.options.callbacks.onPrepare();
    this.options.callbacks.onHandoff();
    gsap.to(this.params, {
      fade: 0,
      duration: this.options.reduced ? 0.5 : 0.85,
      ease: 'power1.inOut',
      onComplete: () => this.finish(),
    });
  }

  /** Omitir: llega de inmediato a un estado estable del observatorio. */
  skip() {
    if (this.finished) return;
    this.timeline?.kill();
    this.options.callbacks.onWordmark?.(0);
    if (!this.handedOff) {
      this.handedOff = true;
      this.options.callbacks.onPrepare();
      this.options.callbacks.onHandoff();
    }
    gsap.killTweensOf(this.params);
    Object.assign(this.params, { travel: 1, lookMix: 1, starPos: 1, earth: 1 });
    gsap.to(this.params, { fade: 0, duration: 0.3, ease: 'power1.out', onComplete: () => this.finish() });
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    window.clearTimeout(this.watchdog);
    this.options.callbacks.onDone();
  }

  private loop = () => {
    if (this.finished) return;
    this.frame = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.elapsed += dt;
    const p = this.params;

    // Cámara.
    const pos = this.path.getPoint(Math.min(1, Math.max(0, p.travel)));
    this.camera.position.copy(pos);
    const look = new THREE.Vector3().lerpVectors(this.startLook, new THREE.Vector3(0, 0, 0), p.lookMix);
    if (p.travel > 0) look.lerp(new THREE.Vector3(0, 0, 0), Math.min(1, p.travel * 1.5));
    this.camera.lookAt(look);

    // Estrella: de "héroe" centrada a la percha del observatorio.
    const perch = this.perchPosition();
    const k = p.starPos;
    // En pantallas estrechas la estrella "héroe" se aleja para no ocupar todo el ancho.
    this.heroPos.z = -9 * Math.max(1, 1.2 / this.camera.aspect);
    this.star.root.position.lerpVectors(this.heroPos, perch.pos, k);
    this.star.root.scale.setScalar(THREE.MathUtils.lerp(1, perch.scale, k));
    this.star.update(this.elapsed, dt);

    // Sol cinemático relativo a la cámara (igual que en el observatorio).
    const camDir = this.camera.position.clone().normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(camDir).normalize();
    const up = camDir.clone().cross(right).normalize();
    const sun = camDir.multiplyScalar(0.62).addScaledVector(right, -0.7).addScaledVector(up, 0.38).normalize();
    this.earth.setSun(sun);
    this.clouds.setSun(sun);
    this.clouds.update(dt);
    this.moon.update(0, sun);
    (this.earth.material.uniforms.exposure as THREE.IUniform<number>).value = p.earth;
    (this.atmosphere.material as THREE.ShaderMaterial).uniforms.intensity.value = p.earth;
    this.starfield.setOpacity(p.stars);
    this.starfield.update(this.elapsed);
    this.dust.setOpacity(0.6 * p.stars);
    this.dust.update(this.elapsed, dt);
    this.scan.update(dt);

    this.canvas.style.opacity = String(p.fade);
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    // Una instancia liberada nunca vuelve a invocar callbacks (p. ej. tras compileAsync).
    this.finished = true;
    this.handedOff = true;
    cancelAnimationFrame(this.frame);
    window.clearTimeout(this.watchdog);
    window.removeEventListener('resize', this.onResize);
    this.timeline?.kill();
    gsap.killTweensOf(this.params);
    this.starfield.dispose();
    this.dust.dispose();
    this.earth.dispose();
    this.earthMesh.geometry.dispose();
    this.atmosphere.geometry.dispose();
    (this.atmosphere.material as THREE.Material).dispose();
    this.clouds.dispose();
    this.scan.dispose();
    this.moon.dispose();
    this.star.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
