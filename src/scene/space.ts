/**
 * Universo de fondo: estrellas con profundidad, vía láctea tenue, polvo con parallax y
 * cometas ocasionales que se fragmentan en partículas al hacer clic.
 * Todo es procedural (sin imágenes), con densidad según la calidad elegida.
 */
import * as THREE from 'three';
import type { Quality } from '@/state/store';

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomOnSphere(rand: () => number): THREE.Vector3 {
  const u = rand() * 2 - 1;
  const t = rand() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return new THREE.Vector3(s * Math.cos(t), u, s * Math.sin(t));
}

/* ------------------------------------------------------------------ */
/* Estrellas                                                          */
/* ------------------------------------------------------------------ */
const starVertex = /* glsl */ `
attribute float size;
attribute float phase;
attribute vec3 tint;
attribute float spike;
uniform float uTime;
uniform float uPixelRatio;
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;
varying float vSpike;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // Centelleo: las estrellas brillantes parpadean un poco más (efecto atmosférico estilizado).
  float tw = 0.72 + 0.28 * sin(uTime * (0.4 + phase * 1.6) + phase * 37.0);
  vColor = tint;
  vAlpha = mix(1.0, tw, 0.6 + spike * 0.4) * uOpacity;
  vSpike = spike;
  gl_PointSize = size * uPixelRatio * (0.9 + 0.1 * tw);
}`;

const starFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vSpike;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float core = exp(-d * d * 9.0);
  float halo = exp(-d * 3.0) * 0.3;
  // Destello en cruz para las estrellas más brillantes.
  float cross = (exp(-abs(c.y) * 60.0) * exp(-abs(c.x) * 5.0) + exp(-abs(c.x) * 60.0) * exp(-abs(c.y) * 5.0)) * vSpike;
  float a = (core + halo + cross * 0.85) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, a);
}`;

export interface Starfield {
  group: THREE.Group;
  material: THREE.ShaderMaterial;
  update: (t: number) => void;
  setOpacity: (o: number) => void;
  dispose: () => void;
}

export function createStarfield(quality: Quality, radius = 22_000, pixelRatio = 1): Starfield {
  const count = quality === 'high' ? 14000 : quality === 'balanced' ? 10000 : 5000;
  const rand = seeded(2026);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const tints = new Float32Array(count * 3);
  const spikes = new Float32Array(count);
  const palette = [
    new THREE.Color('#9fbfff'), new THREE.Color('#cfe0ff'), new THREE.Color('#ffffff'),
    new THREE.Color('#fff1d6'), new THREE.Color('#ffd2a1'),
  ];
  // Concentración de estrellas cerca de un plano galáctico inclinado.
  const galNormal = new THREE.Vector3(0.35, 0.82, -0.45).normalize();
  for (let i = 0; i < count; i++) {
    let dir = randomOnSphere(rand);
    if (rand() < 0.45) {
      const off = galNormal.clone().multiplyScalar((rand() - 0.5) * 0.35);
      dir = dir.sub(galNormal.clone().multiplyScalar(dir.dot(galNormal))).add(off).normalize();
    }
    const r = radius * (0.8 + rand() * 0.4);
    positions.set([dir.x * r, dir.y * r, dir.z * r], i * 3);
    const m = Math.pow(rand(), 4.2);
    const bright = rand() < 0.007;
    sizes[i] = bright ? 9 + rand() * 6 : 1.3 + m * 4.2;
    spikes[i] = bright ? 0.7 + rand() * 0.3 : 0;
    phases[i] = rand();
    const c = palette[Math.floor(Math.pow(rand(), 0.8) * palette.length)];
    const dim = bright ? 1 : 0.7 + 0.3 * rand();
    tints.set([c.r * dim, c.g * dim, c.b * dim], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('tint', new THREE.BufferAttribute(tints, 3));
  geometry.setAttribute('spike', new THREE.BufferAttribute(spikes, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio }, uOpacity: { value: 1 } },
    vertexShader: starVertex,
    fragmentShader: starFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -10;
  const group = new THREE.Group();
  group.add(points);

  // Vía láctea y nebulosas muy tenues (solo calidad alta/equilibrada). La textura se
  // pinta una vez en canvas: así el shader es trivial y compila al instante.
  let sky: THREE.Mesh | null = null;
  if (quality !== 'low') {
    const skyMat = new THREE.MeshBasicMaterial({
      map: getSkyTexture(),
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: SKY_OPACITY,
    });
    sky = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.5, 48, 32), skyMat);
    sky.rotation.set(0.6, 0.4, -0.35);
    sky.renderOrder = -20;
    sky.frustumCulled = false;
    group.add(sky);
  }

  return {
    group,
    material,
    update: (t) => {
      material.uniforms.uTime.value = t;
    },
    setOpacity: (o) => {
      material.uniforms.uOpacity.value = o;
      if (sky) (sky.material as THREE.MeshBasicMaterial).opacity = o * SKY_OPACITY;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
      if (sky) {
        sky.geometry.dispose();
        (sky.material as THREE.Material).dispose();
      }
    },
  };
}

/** Vía láctea visible pero suave: da profundidad sin competir con el planeta ni los datos. */
const SKY_OPACITY = 0.75;
let skyTexture: THREE.CanvasTexture | null = null;

/** Banda galáctica y nebulosas tenues pintadas en un canvas equirectangular (una sola vez). */
function getSkyTexture(): THREE.CanvasTexture {
  if (skyTexture) return skyTexture;
  const w = 1024;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const rand = seeded(77);
  const blob = (x: number, y: number, r: number, color: string, alpha: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color.replace('A', String(alpha)));
    g.addColorStop(1, color.replace('A', '0'));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  ctx.globalCompositeOperation = 'lighter';
  // Banda galáctica: sinusoide en proyección equirectangular.
  for (let i = 0; i < 520; i++) {
    const u = rand();
    const x = u * w;
    const y = h / 2 + Math.sin(u * Math.PI * 2) * h * 0.28 + (rand() - 0.5) * h * 0.09;
    const core = Math.exp(-Math.pow((u - 0.62) / 0.16, 2));
    blob(x, y, 10 + rand() * 30, 'rgba(160,172,220,A)', 0.008 + 0.016 * core + rand() * 0.005);
  }
  // Nebulosas violetas, magenta y verdeazuladas dispersas.
  const nebulae = ['rgba(105,60,170,A)', 'rgba(30,105,125,A)', 'rgba(150,55,110,A)'];
  for (let i = 0; i < 22; i++) {
    blob(rand() * w, rand() * h, 30 + rand() * 90, nebulae[Math.floor(rand() * nebulae.length)], 0.03 + rand() * 0.035);
  }
  // Carriles de polvo oscuro sobre la banda.
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 160; i++) {
    const u = rand();
    const x = u * w;
    const y = h / 2 + Math.sin(u * Math.PI * 2) * h * 0.28 + (rand() - 0.5) * h * 0.03;
    blob(x, y, 6 + rand() * 18, 'rgba(0,0,0,A)', 0.25);
  }
  skyTexture = new THREE.CanvasTexture(canvas);
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  return skyTexture;
}

/* ------------------------------------------------------------------ */
/* Polvo espacial (parallax)                                          */
/* ------------------------------------------------------------------ */
export interface Dust {
  points: THREE.Points;
  update: (t: number, dt: number) => void;
  setOpacity: (o: number) => void;
  dispose: () => void;
}

export function createDust(quality: Quality, inner = 160, outer = 1400, pixelRatio = 1, seed = 7): Dust {
  const count = quality === 'high' ? 900 : quality === 'balanced' ? 500 : 200;
  const rand = seeded(seed);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const tints = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const dir = randomOnSphere(rand);
    const r = inner + Math.pow(rand(), 0.7) * (outer - inner);
    positions.set([dir.x * r, dir.y * r, dir.z * r], i * 3);
    sizes[i] = 1 + rand() * 2.2;
    phases[i] = rand();
    const warm = rand() < 0.25;
    tints.set(warm ? [0.7, 0.6, 0.5] : [0.55, 0.68, 0.85], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('tint', new THREE.BufferAttribute(tints, 3));
  geometry.setAttribute('spike', new THREE.BufferAttribute(new Float32Array(count), 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio }, uOpacity: { value: 0.7 } },
    vertexShader: starVertex,
    fragmentShader: starFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return {
    points,
    update: (t, dt) => {
      material.uniforms.uTime.value = t;
      points.rotation.y += dt * 0.004;
      points.rotation.x += dt * 0.0012;
    },
    setOpacity: (o) => {
      material.uniforms.uOpacity.value = o;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Cometas                                                            */
/* ------------------------------------------------------------------ */
const TRAIL = 56;

const cometVertex = /* glsl */ `
attribute float size;
attribute float alpha;
attribute vec3 tint;
uniform float uPixelRatio;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vAlpha = alpha;
  vColor = tint;
  gl_PointSize = size * uPixelRatio;
}`;

const cometFragment = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-d * d * 4.0) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a, a);
}`;

interface Comet {
  points: THREE.Points;
  start: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  age: number;
  life: number;
  /** Separación de la cola (fracción de la velocidad por partícula). */
  spacing: number;
  fadeIn: number;
  /** Tiempo que la cola tarda en desaparecer tras el recorrido. */
  tailOut: number;
  tailAlpha: number;
}

type FlyerKind = 'comet' | 'meteor';

interface Burst {
  points: THREE.Points;
  velocities: Float32Array;
  age: number;
  life: number;
}

export interface CometSystem {
  group: THREE.Group;
  update: (dt: number, camera: THREE.Camera, enabled: boolean) => void;
  /** Devuelve true si el clic alcanzó un cometa (y lo fragmenta). */
  hitTest: (x: number, y: number, width: number, height: number, camera: THREE.Camera) => boolean;
  /** ¿Hay un cometa bajo el cursor? (para indicar que se puede tocar) */
  isNear: (x: number, y: number, width: number, height: number, camera: THREE.Camera) => boolean;
  spawnNow: (camera: THREE.Camera) => void;
  dispose: () => void;
}

export function createComets(pixelRatio = 1): CometSystem {
  const group = new THREE.Group();
  const comets: Comet[] = [];
  const bursts: Burst[] = [];
  const rand = seeded(Date.now() & 0xffff);
  // El primero llega pronto para que se note que el espacio está vivo.
  let nextSpawn = 4 + rand() * 3;
  // Estrellas fugaces: breves y frecuentes.
  let nextMeteor = 1.5 + rand() * 2;
  const material = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: pixelRatio } },
    vertexShader: cometVertex,
    fragmentShader: cometFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const tmp = new THREE.Vector3();

  function makeGeometry(n: number) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    return g;
  }

  const COMET_TAIL = [new THREE.Color('#f4fbff'), new THREE.Color('#5fd7d2')];
  const METEOR_TAIL = [new THREE.Color('#ffffff'), new THREE.Color('#ffd9a0')];

  function spawn(camera: THREE.Camera, kind: FlyerKind = 'comet') {
    const meteor = kind === 'meteor';
    // Trayectoria en el plano de la vista, a gran distancia, cruzando el encuadre.
    const depth = meteor ? 3200 + rand() * 1600 : 5200 + rand() * 2600;
    // Se prefieren trayectorias que no crucen el centro (donde está el planeta), para que
    // el cometa o la estrella fugaz se vean en lugar de pasar ocultos detrás de la Tierra.
    const clearOfGlobe = (p: THREE.Vector3) => Math.hypot(p.x * 1.35, p.y) > 0.62;
    let a = new THREE.Vector3();
    let b = new THREE.Vector3();
    for (let attempt = 0; attempt < 10; attempt++) {
      if (meteor) {
        // Estrella fugaz: tramo corto en diagonal descendente.
        const x0 = (rand() * 2 - 1) * 1.05;
        const y0 = -0.2 + rand() * 1.15;
        const sx = rand() < 0.5 ? -1 : 1;
        const len = 0.4 + rand() * 0.4;
        a.set(x0, y0, 0.5);
        b.set(x0 + sx * len * 0.85, y0 - len * 0.6, 0.5);
      } else {
        // Cometa: cruza la parte alta del cielo de lado a lado.
        const fromLeft = rand() < 0.5;
        const y0 = 0.55 + rand() * 0.4;
        a.set(fromLeft ? -1.25 : 1.25, y0, 0.5);
        b.set(fromLeft ? 0.5 + rand() * 0.7 : -0.5 - rand() * 0.7, y0 - 0.15 - rand() * 0.3, 0.5);
      }
      const mid = a.clone().add(b).multiplyScalar(0.5);
      if (clearOfGlobe(a) && clearOfGlobe(b) && clearOfGlobe(mid)) break;
    }
    a = a.clone();
    b = b.clone();
    a.unproject(camera);
    b.unproject(camera);
    const camPos = camera.getWorldPosition(new THREE.Vector3());
    const start = a.sub(camPos).normalize().multiplyScalar(depth).add(camPos);
    const end = b.sub(camPos).normalize().multiplyScalar(depth).add(camPos);
    const dir = end.clone().sub(start);
    const dist = dir.length();
    dir.normalize();
    const geometry = makeGeometry(TRAIL);
    const sizes = geometry.getAttribute('size') as THREE.BufferAttribute;
    const alphas = geometry.getAttribute('alpha') as THREE.BufferAttribute;
    const tints = geometry.getAttribute('tint') as THREE.BufferAttribute;
    const [c0, c1] = meteor ? METEOR_TAIL : COMET_TAIL;
    const head = meteor ? 6.5 : 11;
    const body = meteor ? 3.2 : 6.5;
    for (let i = 0; i < TRAIL; i++) {
      const k = i / (TRAIL - 1);
      sizes.setX(i, i === 0 ? head : body * (1 - k) + 0.8);
      alphas.setX(i, 0);
      const c = new THREE.Color().lerpColors(c0, c1, Math.min(1, k * 1.4));
      tints.setXYZ(i, c.r, c.g, c.b);
    }
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    group.add(points);
    const life = meteor ? 0.55 + rand() * 0.5 : 3.2 + rand() * 1.8;
    const speed = dist / life;
    comets.push({
      points, start, dir, speed, age: 0, life,
      spacing: meteor ? (0.3 * life) / TRAIL : 0.012,
      fadeIn: meteor ? 0.08 : 0.6,
      tailOut: meteor ? 0.35 : 1.2,
      tailAlpha: meteor ? 0.8 : 0.7,
    });
  }

  function burst(c: Comet) {
    const n = 150;
    const geometry = makeGeometry(n);
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const sizes = geometry.getAttribute('size') as THREE.BufferAttribute;
    const tints = geometry.getAttribute('tint') as THREE.BufferAttribute;
    const head = c.start.clone().addScaledVector(c.dir, c.speed * Math.min(c.age, c.life));
    const velocities = new Float32Array(n * 3);
    const palette = ['#ffffff', '#bdf4ff', '#5fd7d2', '#a68bff'].map((h) => new THREE.Color(h));
    for (let i = 0; i < n; i++) {
      pos.setXYZ(i, head.x, head.y, head.z);
      const d = randomOnSphere(rand).multiplyScalar(120 + rand() * 420);
      d.addScaledVector(c.dir, c.speed * 0.25);
      velocities.set([d.x, d.y, d.z], i * 3);
      sizes.setX(i, 2 + rand() * 4.5);
      const col = palette[Math.floor(rand() * palette.length)];
      tints.setXYZ(i, col.r, col.g, col.b);
    }
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    group.add(points);
    bursts.push({ points, velocities, age: 0, life: 1.7 });
  }

  /** Índice del cometa cuya cabeza está a menos de ~36 px del punto, o -1. */
  function findNear(x: number, y: number, width: number, height: number, camera: THREE.Camera): number {
    for (let i = comets.length - 1; i >= 0; i--) {
      const c = comets[i];
      if (c.age > c.life) continue;
      const head = c.start.clone().addScaledVector(c.dir, c.speed * Math.min(c.age, c.life)).project(camera);
      if (head.z > 1) continue;
      const sx = ((head.x + 1) / 2) * width;
      const sy = ((1 - head.y) / 2) * height;
      if (Math.hypot(sx - x, sy - y) < 36) return i;
    }
    return -1;
  }

  function removeComet(i: number) {
    const c = comets[i];
    group.remove(c.points);
    c.points.geometry.dispose();
    comets.splice(i, 1);
  }

  return {
    group,
    spawnNow: (camera) => spawn(camera, 'comet'),
    update: (dt, camera, enabled) => {
      if (enabled) {
        nextSpawn -= dt;
        nextMeteor -= dt;
        const active = (kind: FlyerKind) => comets.filter((c) => (kind === 'meteor' ? c.life < 2 : c.life >= 2)).length;
        if (nextSpawn <= 0 && active('comet') < 2) {
          spawn(camera, 'comet');
          nextSpawn = 11 + rand() * 11;
        }
        if (nextMeteor <= 0 && active('meteor') < 3) {
          spawn(camera, 'meteor');
          nextMeteor = 2.5 + rand() * 4;
        }
      }
      for (let i = comets.length - 1; i >= 0; i--) {
        const c = comets[i];
        c.age += dt;
        if (c.age > c.life + c.tailOut) {
          removeComet(i);
          continue;
        }
        const pos = c.points.geometry.getAttribute('position') as THREE.BufferAttribute;
        // La cabeza se detiene al final del recorrido y la cola se recoge mientras se apaga.
        const headDist = c.speed * Math.min(c.age, c.life);
        const fade = Math.min(1, c.age / c.fadeIn) * Math.min(1, (c.life + c.tailOut - c.age) / c.tailOut);
        const alphas = c.points.geometry.getAttribute('alpha') as THREE.BufferAttribute;
        for (let k = 0; k < TRAIL; k++) {
          const back = Math.min(headDist, k * c.speed * c.spacing);
          tmp.copy(c.start).addScaledVector(c.dir, headDist - back);
          pos.setXYZ(k, tmp.x, tmp.y, tmp.z);
          const base = k === 0 ? 1 : Math.pow(1 - k / (TRAIL - 1), 1.5) * c.tailAlpha;
          alphas.setX(k, base * fade);
        }
        pos.needsUpdate = true;
        alphas.needsUpdate = true;
      }
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        b.age += dt;
        const g = b.points.geometry;
        const pos = g.getAttribute('position') as THREE.BufferAttribute;
        const alphas = g.getAttribute('alpha') as THREE.BufferAttribute;
        const k = b.age / b.life;
        for (let j = 0; j < pos.count; j++) {
          pos.setXYZ(
            j,
            pos.getX(j) + b.velocities[j * 3] * dt * (1 - k * 0.6),
            pos.getY(j) + b.velocities[j * 3 + 1] * dt * (1 - k * 0.6),
            pos.getZ(j) + b.velocities[j * 3 + 2] * dt * (1 - k * 0.6),
          );
          alphas.setX(j, Math.max(0, 1 - k) ** 1.4);
        }
        pos.needsUpdate = true;
        alphas.needsUpdate = true;
        if (b.age >= b.life) {
          group.remove(b.points);
          g.dispose();
          bursts.splice(i, 1);
        }
      }
    },
    hitTest: (x, y, width, height, camera) => {
      const i = findNear(x, y, width, height, camera);
      if (i < 0) return false;
      burst(comets[i]);
      removeComet(i);
      return true;
    },
    isNear: (x, y, width, height, camera) => findNear(x, y, width, height, camera) >= 0,
    dispose: () => {
      comets.forEach((c) => c.points.geometry.dispose());
      bursts.forEach((b) => b.points.geometry.dispose());
      material.dispose();
    },
  };
}
