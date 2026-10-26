import * as THREE from 'three';
import {
  BloomEffect,
  ChromaticAberrationEffect,
  DepthOfFieldEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ShockWaveEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { calmMotion } from './comfort';

export const isTouchDevice = matchMedia('(pointer: coarse)').matches;

export interface Quality {
  high: boolean;
}

/** Owns the WebGL renderer, the main camera and the post-processing chain. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly bloom: BloomEffect;
  readonly shock: ShockWaveEffect;
  readonly dof: DepthOfFieldEffect | null = null;
  readonly chroma: ChromaticAberrationEffect | null = null;
  private renderPass: RenderPass;
  private baseBloom = 1.0;
  private bloomBoost = 0;
  private chromaKick = 0;
  private dofTarget = new THREE.Vector3(0, 3, 0);
  private dofFocus = new THREE.Vector3(0, 3, 0);

  constructor(
    container: HTMLElement,
    scene: THREE.Scene,
    readonly quality: Quality,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    const maxRatio = quality.high ? 2 : 1.25;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);

    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: quality.high ? 4 : 0,
    });
    this.renderPass = new RenderPass(scene, this.camera);
    this.composer.addPass(this.renderPass);

    if (quality.high) {
      this.dof = new DepthOfFieldEffect(this.camera, { focusDistance: 8, focusRange: 16, bokehScale: 1.4 });
      this.dof.target = this.dofFocus;
      this.composer.addPass(new EffectPass(this.camera, this.dof));
    }

    this.shock = new ShockWaveEffect(this.camera, new THREE.Vector3(), {
      speed: 1.6,
      maxRadius: 0.9,
      waveSize: 0.25,
      amplitude: 0.06,
    });
    this.composer.addPass(new EffectPass(this.camera, this.shock));

    this.bloom = new BloomEffect({
      intensity: this.baseBloom,
      luminanceThreshold: 0.72,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
      radius: 0.78,
    });
    const vignette = new VignetteEffect({ darkness: 0.55, offset: 0.28 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    if (quality.high) {
      this.chroma = new ChromaticAberrationEffect({
        offset: new THREE.Vector2(0, 0),
        radialModulation: true,
        modulationOffset: 0.2,
      });
      this.composer.addPass(new EffectPass(this.camera, this.bloom, this.chroma, vignette, tone));
    } else {
      this.composer.addPass(new EffectPass(this.camera, this.bloom, vignette, tone));
    }

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    // Widen the view on portrait phones so the hoop and ball both stay in frame.
    this.camera.fov = this.camera.aspect < 1 ? 50 + (1 - this.camera.aspect) * 30 : 52;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  setBaseBloom(v: number): void {
    this.baseBloom = v;
  }

  /** Extra bloom from the player's streak, 0..1. */
  setGlow(v: number): void {
    this.bloomBoost = v;
  }

  setFocus(p: THREE.Vector3): void {
    this.dofTarget.copy(p);
  }

  pulse(world: THREE.Vector3, strength = 1): void {
    if (calmMotion) return;
    this.shock.position.copy(world);
    this.shock.amplitude = 0.04 + 0.05 * strength;
    this.shock.explode();
    this.chromaKick = Math.max(this.chromaKick, 0.6 * strength);
  }

  render(dt: number): void {
    this.chromaKick = Math.max(0, this.chromaKick - dt * 1.8);
    if (this.chroma) {
      const k = this.chromaKick * this.chromaKick * 0.012;
      this.chroma.offset.set(k, k * 0.6);
    }
    // Refocus slowly: a fast focus change turns the sun into a bright disc that pops like a camera flash.
    this.dofFocus.lerp(this.dofTarget, 1 - Math.exp(-dt * 0.8));
    this.bloom.intensity = this.baseBloom * (1 + this.bloomBoost * 0.9);
    this.composer.render(dt);
  }
}
