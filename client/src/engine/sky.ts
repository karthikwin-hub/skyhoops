import * as THREE from 'three';

export interface SkyParams {
  top: string;
  mid: string;
  bottom: string;
  sunDir: THREE.Vector3;
  sunColor: string;
  sunSize: number;
  stars: number;
  aurora?: number;
  cloudLight: string;
  cloudDark: string;
  cloudHeight?: number;
}

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFragment = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uBottom;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunSize;
uniform float uStars;
uniform float uAurora;
uniform float uTime;
uniform float uFlash;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uBottom, uMid, smoothstep(-0.35, 0.02, h));
  col = mix(col, uTop, smoothstep(0.02, 0.75, h));

  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * pow(sd, 6.0) * 0.35;
  col += uSunColor * pow(sd, 64.0) * 0.8;
  col += uSunColor * smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.6, sd) * 4.0;

  if (uStars > 0.0) {
    vec3 g = floor(d * 260.0);
    float s = hash(g);
    float tw = 0.6 + 0.4 * sin(uTime * (1.5 + s * 4.0) + s * 40.0);
    float star = step(0.9965, s) * tw * smoothstep(-0.05, 0.25, h);
    col += vec3(star) * uStars * 2.2;
  }

  if (uAurora > 0.0) {
    float band = sin(d.x * 6.0 + uTime * 0.15 + sin(d.z * 4.0 + uTime * 0.2) * 1.5);
    float a = smoothstep(0.15, 0.6, h) * smoothstep(0.85, 0.35, h) * (0.5 + 0.5 * band);
    col += mix(vec3(0.1, 1.0, 0.6), vec3(0.6, 0.2, 1.0), 0.5 + 0.5 * sin(d.z * 3.0 + uTime * 0.1)) * a * uAurora * 0.35;
  }

  col += vec3(0.75, 0.8, 1.0) * uFlash;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const cloudVertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const cloudFragment = /* glsl */ `
uniform vec3 uLight;
uniform vec3 uDark;
uniform vec3 uFog;
uniform float uTime;
uniform float uFlash;
varying vec3 vWorld;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

void main() {
  vec2 p = vWorld.xz * 0.018 + vec2(uTime * 0.012, uTime * 0.004);
  float n = fbm(p + fbm(p * 1.7 - uTime * 0.01));
  float puff = smoothstep(0.28, 0.85, n);
  vec3 col = mix(uDark, uLight, puff);
  col += uLight * uFlash * 0.6;
  float dist = length(vWorld.xz);
  float fade = smoothstep(520.0, 140.0, dist);
  col = mix(uFog, col, fade * 0.85 + 0.15 * puff * fade);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** Gradient sky dome with sun, twinkling stars and an optional aurora, plus a sea of clouds below the court. */
export class Sky {
  readonly group = new THREE.Group();
  private skyMat: THREE.ShaderMaterial;
  private cloudMat: THREE.ShaderMaterial;
  private cloudSea: THREE.Mesh;

  constructor() {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color() },
        uMid: { value: new THREE.Color() },
        uBottom: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color() },
        uSunSize: { value: 0.002 },
        uStars: { value: 0 },
        uAurora: { value: 0 },
        uTime: { value: 0 },
        uFlash: { value: 0 },
      },
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), this.skyMat);
    dome.frustumCulled = false;
    dome.renderOrder = -10;
    this.group.add(dome);

    this.cloudMat = new THREE.ShaderMaterial({
      vertexShader: cloudVertex,
      fragmentShader: cloudFragment,
      uniforms: {
        uLight: { value: new THREE.Color() },
        uDark: { value: new THREE.Color() },
        uFog: { value: new THREE.Color() },
        uTime: { value: 0 },
        uFlash: { value: 0 },
      },
      fog: false,
    });
    this.cloudSea = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400, 1, 1), this.cloudMat);
    this.cloudSea.rotation.x = -Math.PI / 2;
    this.cloudSea.position.y = -38;
    this.group.add(this.cloudSea);
  }

  apply(p: SkyParams): void {
    const u = this.skyMat.uniforms;
    (u.uTop.value as THREE.Color).set(p.top);
    (u.uMid.value as THREE.Color).set(p.mid);
    (u.uBottom.value as THREE.Color).set(p.bottom);
    (u.uSunDir.value as THREE.Vector3).copy(p.sunDir).normalize();
    (u.uSunColor.value as THREE.Color).set(p.sunColor);
    u.uSunSize.value = p.sunSize;
    u.uStars.value = p.stars;
    u.uAurora.value = p.aurora ?? 0;
    const c = this.cloudMat.uniforms;
    (c.uLight.value as THREE.Color).set(p.cloudLight);
    (c.uDark.value as THREE.Color).set(p.cloudDark);
    (c.uFog.value as THREE.Color).set(p.mid);
    this.cloudSea.position.y = p.cloudHeight ?? -38;
  }

  set flash(v: number) {
    this.skyMat.uniforms.uFlash.value = v;
    this.cloudMat.uniforms.uFlash.value = v;
  }

  update(t: number): void {
    this.skyMat.uniforms.uTime.value = t;
    this.cloudMat.uniforms.uTime.value = t;
  }
}
