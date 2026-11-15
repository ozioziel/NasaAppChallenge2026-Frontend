/**
 * La Luna orbitando lentamente la Tierra, iluminada por el mismo sol que el planeta
 * (fases coherentes con la escena). Textura lunar de los ejemplos de react-globe.gl.
 *
 * Distancia y tamaño están comprimidos (no a escala real) para que sea visible desde el
 * encuadre del observatorio sin tapar nunca el planeta: su órbita es más amplia que la
 * distancia de la cámara, así que siempre queda detrás o a un lado.
 */
import * as THREE from 'three';
import { loadTexture } from './textures';

export interface Moon {
  mesh: THREE.Mesh;
  update: (dt: number, sunDir: THREE.Vector3) => void;
  dispose: () => void;
}

const vertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const fragment = /* glsl */ `
uniform sampler2D map;
uniform vec3 sunDir;
uniform float ready;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec3 N = normalize(vNormalW);
  float NdotL = dot(N, normalize(sunDir));
  float lit = smoothstep(-0.06, 0.35, NdotL);
  vec3 albedo = mix(vec3(0.55), texture2D(map, vUv).rgb, ready);
  vec3 V = normalize(cameraPosition - vPosW);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 color = albedo * (0.025 + 1.05 * lit) + vec3(0.5, 0.6, 0.8) * rim * 0.08;
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}`;

/**
 * @param viewDir dirección (desde el centro de la Tierra) hacia la cámara inicial, para
 *                que la Luna aparezca en el encuadre al entrar.
 */
export function createMoon(viewDir: THREE.Vector3, orbitRadius = 900, radius = 24): Moon {
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, sunDir: { value: new THREE.Vector3(1, 0, 0) }, ready: { value: 0 } },
    vertexShader: vertex,
    fragmentShader: fragment,
  });
  const geometry = new THREE.SphereGeometry(radius, 48, 32);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'moon';
  loadTexture('/textures/moon-1k.jpg')
    .then((tex) => {
      material.uniforms.map.value = tex;
      material.uniforms.ready.value = 1;
    })
    .catch(() => undefined);

  // Posición inicial: detrás de la Tierra, arriba a la derecha del encuadre de entrada.
  const away = viewDir.clone().normalize().negate();
  // Ejes de la cámara inicial (que mira desde viewDir hacia el centro).
  const right = new THREE.Vector3(0, 1, 0).cross(viewDir).normalize();
  const up = viewDir.clone().cross(right).normalize();
  const tilt = THREE.MathUtils.degToRad(34);
  const start = away
    .clone()
    .multiplyScalar(Math.cos(tilt))
    .add(up.clone().multiplyScalar(0.55 * Math.sin(tilt)))
    .add(right.clone().multiplyScalar(0.85 * Math.sin(tilt)))
    .normalize();
  // Órbita lenta alrededor de un eje inclinado (~15 min por vuelta).
  const axis = start.clone().cross(up).normalize();
  const period = 900;
  let angle = 0;
  const tmp = new THREE.Vector3();

  const place = () => {
    tmp.copy(start).applyAxisAngle(axis, angle).multiplyScalar(orbitRadius);
    mesh.position.copy(tmp);
  };
  place();
  // Cara visible orientada hacia la Tierra (acoplamiento de marea).
  mesh.lookAt(0, 0, 0);

  return {
    mesh,
    update: (dt, sunDir) => {
      angle += (dt / period) * Math.PI * 2;
      place();
      mesh.lookAt(0, 0, 0);
      material.uniforms.sunDir.value.copy(sunDir);
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
