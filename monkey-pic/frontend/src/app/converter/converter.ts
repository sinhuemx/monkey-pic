import {
  Component,
  ChangeDetectionStrategy,
  ViewChild,
  ElementRef,
  inject,
  signal,
  computed,
  effect,
  WritableSignal,
  OnDestroy,
  NgZone,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SliderModule, ToggleModule } from 'carbon-components-angular';
import { ConversionEngineService } from './services/conversion-engine.service';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { TooltipModule } from 'carbon-components-angular/tooltip';
import { DepthRuntimeService } from './services/depth-runtime.service';

type PreviewMode = 'image' | 'relief' | '3d';

interface ReliefOptions {
  invert: boolean;
  enhanceEdges: boolean;
  surfaceSmoothing: number; // 0..1
  smoothingKernel: 1|3|5|7|9; // map to blur radius
  depthMultiplier: number;   // 0.5..3.0
  qualityThreshold: number;  // 0..1 (edge threshold influence)
  preserveDetails: boolean;  // reduce smoothing if true
  subdivisionLevel: 1|2|3|4; // boosts detail
  adaptiveSubdivision: boolean; // boosts detail slightly
  sampleMax: number;         // target resolution width
  maxHeightMM: number;       // additional intensity scale
}

@Component({
  selector: 'app-converter',
  standalone: true,
  imports: [CommonModule, FormsModule, SliderModule, ToggleModule, TooltipModule],
  templateUrl: './converter.html',
  styleUrls: ['./converter.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConverterComponent implements OnDestroy {
  private readonly engine = inject(ConversionEngineService);
  private readonly zone = inject(NgZone);
  private readonly depthRt = inject(DepthRuntimeService);

  readonly file = signal<File | null>(null);
  readonly isDragging = signal(false);
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);

  readonly previewMode = signal<PreviewMode>('image');

  readonly is3ds = computed(() => !!this.file() && /\.3ds$/i.test(this.file()!.name));

  readonly downloadUrl = signal<string | null>(null);
  // Track last conversion type and filename/label
  readonly lastConversion = signal<null | 'relief' | '3d'>(null);
  readonly lastExt = signal<'stl' | 'obj' | 'glb'>('stl');
  readonly downloadName = computed(() => {
    const f = this.file();
    const ext = this.lastExt();
    const base = f ? f.name.replace(/\.[^.]+$/, '') : 'model';
    return `${base}.${ext}`;
  });
  readonly downloadLabel = computed(() => {
    if (!this.downloadUrl()) return '';
    return this.lastConversion() === '3d' ? 'Descargar 3D' : 'Descargar STL';
  });

  // Controles
  readonly widthMM: WritableSignal<number> = signal(100);
  readonly baseMM: WritableSignal<number> = signal(1);
  readonly maxHeightMM: WritableSignal<number> = signal(5);
  readonly sampleMax: WritableSignal<number> = signal(300);
  readonly smoothingKernel: WritableSignal<1 | 3 | 5 | 7 | 9> = signal(1);

  readonly subdivisionLevel: WritableSignal<1 | 2 | 3 | 4> = signal(1);
  readonly depthMultiplier: WritableSignal<number> = signal(1.0);
  readonly surfaceSmoothing: WritableSignal<number> = signal(0.0);
  readonly qualityThreshold: WritableSignal<number> = signal(0.3);

  readonly invert = signal(false);
  readonly enhanceEdges = signal(false);
  readonly preserveDetails = signal(true);
  readonly adaptiveSubdivision = signal(true);
  // Prefer depth model (ONNX) when available for 3D preview
  readonly useDepth = signal(true);
  readonly depthAvailable: WritableSignal<boolean | null> = signal<boolean | null>(null);

  readonly compressionLevel: WritableSignal<0 | 1 | 2 | 3> = signal(1);
  readonly format: WritableSignal<'binary' | 'ascii'> = signal('binary');

  readonly trianglesEstimate = computed(() => {
    const s = this.sampleMax();
    const adapt = this.adaptiveSubdivision() ? 0.8 : 1.0;
    const smooth = 1 - this.surfaceSmoothing() * 0.3;
    const subdiv = 1 + (this.subdivisionLevel() - 1) * 0.5;
    return Math.round((s * s * 2) * adapt * smooth * subdiv);
  });

  @ViewChild('previewCanvas', { static: false })
  private previewCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('threeContainer', { static: false })
  private threeContainer?: ElementRef<HTMLDivElement>;

  private objectUrlForPreview: string | null = null;
  // three.js scene state
  private three?: {
    renderer: any;
    scene: any;
    camera: any;
    controls: OrbitControls;
    mesh?: any;
    animId?: number;
    currentDims?: { w: number; h: number };
  };
  private lastDepthData: { d: Float32Array; tw: number; th: number; opts: ReliefOptions } | null = null;

  constructor() {
    // Initialize the UI with default values, as if 'Restablecer' was pressed
    this.resetControls();

    effect(() => {
      const f = this.file();
      const mode = this.previewMode();
  // Read controls so preview updates when these change
  const _invert = this.invert();
  const _enhance = this.enhanceEdges();
  const _smooth = this.surfaceSmoothing();
  const _smoothingKernel = this.smoothingKernel();
  const _depthMult = this.depthMultiplier();
  const _qualityTh = this.qualityThreshold();
  const _preserve = this.preserveDetails();
  const _subdiv = this.subdivisionLevel();
  const _adaptive = this.adaptiveSubdivision();
  const _sampleMax = this.sampleMax();
  const _maxH = this.maxHeightMM();
      this.zone.runOutsideAngular(() => {
        if (f && !this.is3ds() && mode !== '3d') {
          this.renderPreview(f, mode).catch((e) =>
            this.zone.run(() => this.setError(e))
          );
        }
      });
    });
    // Effect: when switching to 3d or changing relevant params, update 3d preview
    effect(() => {
      if (this.previewMode() !== '3d') return;
      const f = this.file(); if (!f) return;
      if (!this.threeContainer?.nativeElement) return;
      // read params to trigger updates
      const _smpl = this.sampleMax();
      const _invert3d = this.invert();
      const _depth = this.depthMultiplier();
      const _maxH = this.maxHeightMM();
      const _smooth = this.surfaceSmoothing();
      const _kernel = this.smoothingKernel();
      this.zone.runOutsideAngular(() => {
        this.ensureThree(this.threeContainer!.nativeElement).then(() => this.render3DPreview(f)).catch(() => {});
      });
    });

    // Effect: pause/resume three.js render loop when switching tabs
    effect(() => {
      const mode = this.previewMode();
      if (mode === '3d') {
        this.zone.runOutsideAngular(() => this.startThreeLoop());
      } else {
        if (this.three?.animId) { cancelAnimationFrame(this.three.animId); this.three.animId = undefined; }
      }
    });

    // Effect: probe ONNX model availability when Depth is enabled in 3D tab
    effect(() => {
      const wantDepth = this.useDepth();
      const mode = this.previewMode();
      if (wantDepth && mode === '3d') {
        this.depthAvailable.set(null);
        this.depthRt.isAvailable().then(ok => this.depthAvailable.set(ok)).catch(() => this.depthAvailable.set(false));
      } else {
        this.depthAvailable.set(null);
      }
    });

  effect(() => {
      if (this.file() && this.is3ds()) {
        this.zone.run(() => this.upload());
      }
    });

  }

  setPreviewMode(mode: PreviewMode) {
    this.previewMode.set(mode);
    const f = this.file();
    if (f && !this.is3ds()) {
      // Force immediate re-render when changing tabs
      if (mode === '3d') {
        // Prepare three with the current container and render
        if (this.threeContainer?.nativeElement) {
          this.ensureThree(this.threeContainer.nativeElement).then(() => {
            this.startThreeLoop();
            this.render3DPreview(f).catch((e) => this.setError(e));
          });
        } else {
          this.render3DPreview(f).catch((e) => this.setError(e));
        }
      } else {
        this.renderPreview(f, mode).catch((e) => this.setError(e));
      }
    }
  }
  private setError(e: unknown) {
    console.error(e);
    const msg = e instanceof Error ? e.message : 'Ocurrió un error inesperado.';
    this.error.set(msg);
    this.isLoading.set(false);
  }
  private resetError() { this.error.set(null); }

  // sliders/toggles DRY
  private setNumber<T extends number>(setter: WritableSignal<T>, value: number) { setter.set(value as T); }
  private num(v: number | number[]): number { return Array.isArray(v) ? v[0] : v; }
  onWidthSliderChange(v: number | number[])          { this.setNumber(this.widthMM, this.num(v)); }
  onBaseSliderChange(v: number | number[])           { this.setNumber(this.baseMM, this.num(v)); }
  onHeightSliderChange(v: number | number[])         { this.setNumber(this.maxHeightMM, this.num(v)); }
  onQualitySliderChange(v: number | number[])        { this.setNumber(this.sampleMax, this.num(v)); }
  onSmoothingChange(v: number | number[])            { this.setNumber(this.smoothingKernel, this.num(v) as 1|3|5|7|9); }
  onSubdivisionChange(v: number | number[])          { this.setNumber(this.subdivisionLevel, this.num(v) as 1|2|3|4); }
  onDepthMultiplierChange(v: number | number[])      { this.setNumber(this.depthMultiplier, this.num(v)); }
  onSurfaceSmoothingChange(v: number | number[])     { this.setNumber(this.surfaceSmoothing, this.num(v)); }
  onQualityThresholdChange(v: number | number[])     { this.setNumber(this.qualityThreshold, this.num(v)); }
  onCompressionChange(v: number | number[])          { this.setNumber(this.compressionLevel, this.num(v) as 0|1|2|3); }

  onInvertChange(v: boolean)              { this.invert.set(v); }
  onEnhanceEdgesChange(v: boolean)        { this.enhanceEdges.set(v); }
  onPreserveDetailsChange(v: boolean)     { this.preserveDetails.set(v); }
  onAdaptiveSubdivisionChange(v: boolean) { this.adaptiveSubdivision.set(v); }

  onDragOver(ev: DragEvent) { ev.preventDefault(); this.isDragging.set(true); }
  onDragLeave(_ev: DragEvent) { this.isDragging.set(false); }
  onDrop(ev: DragEvent) { ev.preventDefault(); this.isDragging.set(false); const f = ev.dataTransfer?.files?.[0]; if (f) this.acceptFile(f); }
  onFileChange(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    if (f) this.acceptFile(f);
    input.value = '';
  }
  private acceptFile(f: File) {
    this.resetError();
    this.revokeObjectUrl();
    this.file.set(f);
    this.downloadUrl.set(null);
    // Render immediately for current tab after file selection
    if (!this.is3ds()) {
      const mode = this.previewMode();
      if (mode === '3d') {
        this.render3DPreview(f).catch((e) => this.setError(e));
      } else {
        this.renderPreview(f, mode).catch((e) => this.setError(e));
      }
    }
  }

  private async renderPreview(file: File, mode: PreviewMode): Promise<void> {
    if (!this.previewCanvas?.nativeElement) {
      // The canvas might not be in the DOM yet (structural *ngIf). Retry on next frame.
      requestAnimationFrame(() => {
        // Fire and forget; errors handled in caller effect's catch
        this.renderPreview(file, mode);
      });
      return;
    }
    if (!file.type.startsWith('image/')) {
      const ctx = this.previewCanvas?.nativeElement?.getContext?.('2d');
      if (ctx && this.previewCanvas?.nativeElement) {
        ctx.clearRect(0, 0, this.previewCanvas.nativeElement.width, this.previewCanvas.nativeElement.height);
      }
      return;
    }
    this.revokeObjectUrl();
    this.objectUrlForPreview = URL.createObjectURL(file);
    const img = await this.loadImage(this.objectUrlForPreview);
    const canvas = this.previewCanvas.nativeElement;

    const maxW = canvas.clientWidth || 600;
    const scale = maxW / img.width;
    canvas.width = Math.floor(img.width * scale);
    canvas.height = Math.floor(img.height * scale);

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    if (mode === 'relief') {
      try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const opts: ReliefOptions = {
          invert: this.invert(),
          enhanceEdges: this.enhanceEdges(),
          surfaceSmoothing: this.surfaceSmoothing(),
          smoothingKernel: this.smoothingKernel(),
          depthMultiplier: this.depthMultiplier(),
          qualityThreshold: this.qualityThreshold(),
          preserveDetails: this.preserveDetails(),
          subdivisionLevel: this.subdivisionLevel(),
          adaptiveSubdivision: this.adaptiveSubdivision(),
          sampleMax: this.sampleMax(),
          maxHeightMM: this.maxHeightMM(),
        };
        const smallCanvas = this.generateReliefPreview(imageData, opts);
        // Draw scaled to fit the preview canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(smallCanvas, 0, 0, canvas.width, canvas.height);
      } catch {
        // Fallback to grayscale if ImageData processing fails
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const gray = this.toGrayscale(imageData, this.invert());
        ctx.putImageData(gray, 0, 0);
      }
    }
  }

  // Convert to grayscale, optionally inverted
  private toGrayscale(src: ImageData, invert: boolean): ImageData {
    const out = new ImageData(src.width, src.height);
    const s = src.data, d = out.data;
    for (let i = 0; i < s.length; i += 4) {
      const r = s[i], g = s[i+1], b = s[i+2];
      let y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      if (invert) y = 255 - y;
      d[i] = d[i+1] = d[i+2] = y; d[i+3] = 255;
    }
    return out;
  }

  // Relief via Sobel shading considering UI controls
  private generateReliefPreview(src: ImageData, opts: ReliefOptions): HTMLCanvasElement {
    const w = src.width, h = src.height;
    const invert = opts.invert;
    const edgeBoost = opts.enhanceEdges ? 1.5 : 1.0;
    const surfaceSmooth = Math.min(Math.max(opts.surfaceSmoothing, 0), 1);
    const kernelMap = new Map<number, number>([[1,0],[3,1],[5,2],[7,3],[9,4]]);
    const kernelRadius = kernelMap.get(opts.smoothingKernel) ?? 0;
    const preserve = opts.preserveDetails;
    const detailBoost = (opts.subdivisionLevel - 1) * 0.15 + (opts.adaptiveSubdivision ? 0.2 : 0);
    const depthScale = (opts.depthMultiplier || 1) * (opts.maxHeightMM > 0 ? (opts.maxHeightMM/5) : 1);
    const edgeThreshold = Math.min(Math.max(opts.qualityThreshold || 0, 0), 1) * 0.6; // 0..0.6

    // Compute target processing resolution based on sampleMax
    const targetW = Math.max(32, Math.min(w, Math.floor(opts.sampleMax || w)));
    const targetH = Math.max(32, Math.floor(targetW * (h / w)));

    // Create small canvas for processing and output
    const outCanvas = document.createElement('canvas');
    outCanvas.width = targetW;
    outCanvas.height = targetH;
    const outCtx = outCanvas.getContext('2d', { willReadFrequently: true })!;

    // 1) Downsample to target with high quality
    const tmpDown = document.createElement('canvas');
    tmpDown.width = targetW;
    tmpDown.height = targetH;
    const tmpCtx = tmpDown.getContext('2d')!;
    tmpCtx.imageSmoothingEnabled = true;
    tmpCtx.imageSmoothingQuality = 'high';
    // Put source into an intermediate canvas to use drawImage scaling
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = w; srcCanvas.height = h;
    srcCanvas.getContext('2d')!.putImageData(src, 0, 0);
    tmpCtx.drawImage(srcCanvas, 0, 0, targetW, targetH);
    const small = tmpCtx.getImageData(0, 0, targetW, targetH);

    // 1) Grayscale
    const gray = new Float32Array(targetW * targetH);
    const s = small.data;
    for (let y = 0; y < targetH; y++) {
      for (let x = 0; x < targetW; x++) {
        const idx = (y * targetW + x) * 4;
        const r = s[idx], g = s[idx+1], b = s[idx+2];
        let Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (invert) Y = 255 - Y;
        gray[y * targetW + x] = Y / 255;
      }
    }

    // Optional small box blur based on surfaceSmooth
    if (surfaceSmooth > 0 || kernelRadius > 0) {
      // combine both radii; preserveDetails reduces smoothing
      let radius = surfaceSmooth < 0.34 ? 1 : surfaceSmooth < 0.67 ? 2 : 3;
      radius = Math.max(radius, kernelRadius);
      if (preserve) radius = Math.max(0, radius - 1);
      if (radius > 0) {
        const tmp = new Float32Array(gray.length);
        const kernelSize = (radius * 2 + 1) ** 2;
        for (let y = 0; y < targetH; y++) {
          for (let x = 0; x < targetW; x++) {
            let acc = 0, count = 0;
            for (let dy = -radius; dy <= radius; dy++) {
              for (let dx = -radius; dx <= radius; dx++) {
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && nx < targetW && ny >= 0 && ny < targetH) {
                  acc += gray[ny * targetW + nx];
                  count++;
                }
              }
            }
            tmp[y * targetW + x] = acc / (count || kernelSize);
          }
        }
        gray.set(tmp);
      }
    }

    // 2) Sobel gradients
    const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    const gx = new Float32Array(targetW * targetH);
    const gy = new Float32Array(targetW * targetH);
    for (let y = 1; y < targetH - 1; y++) {
      for (let x = 1; x < targetW - 1; x++) {
        let sx = 0, sy = 0, k = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let lx = -1; lx <= 1; lx++) {
            const nx = x + lx;
            const ny = y + ky;
            const v = gray[ny * targetW + nx];
            sx += v * sobelX[k];
            sy += v * sobelY[k];
            k++;
          }
        }
        gx[y * targetW + x] = sx;
        gy[y * targetW + x] = sy;
      }
    }

    // 3) Shade using pseudo normals
    const out = outCtx.createImageData(targetW, targetH);
    const d = out.data;
    // Light vector slightly from top-left
    const Lx = -0.5, Ly = -0.5, Lz = 1.0;
    const Llen = Math.hypot(Lx, Ly, Lz) || 1;
    const lnx = Lx / Llen, lny = Ly / Llen, lnz = Lz / Llen;
    const strength = (2.0 + detailBoost) * edgeBoost * depthScale; // gradient scaling
    for (let y = 0; y < targetH; y++) {
      for (let x = 0; x < targetW; x++) {
        const i = y * targetW + x;
        // normal ~ (-gx, -gy, 1)
        let nx = -gx[i] * strength;
        let ny = -gy[i] * strength;
        let nz = 1.0;
        const nlen = Math.hypot(nx, ny, nz) || 1;
        nx /= nlen; ny /= nlen; nz /= nlen;
        // Lambert shading
        let shade = nx * lnx + ny * lny + nz * lnz; // -1..1
        shade = Math.max(0, shade);
        // Apply quality threshold by lifting dark floor
        if (shade < edgeThreshold) {
          shade *= 0.6; // compress very darks
        }
        const val = Math.min(255, Math.max(0, Math.round(shade * 255)));
        const idx = i * 4;
        d[idx] = d[idx+1] = d[idx+2] = val; d[idx+3] = 255;
      }
    }
    outCtx.putImageData(out, 0, 0);
    return outCanvas;
  }
  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error('No se pudo cargar la imagen.'));
      img.src = url;
    });
  }
  private revokeObjectUrl() { if (this.objectUrlForPreview) { URL.revokeObjectURL(this.objectUrlForPreview); this.objectUrlForPreview = null; } }

  // ============== THREE.JS 3D PREVIEW =================
  private async ensureThree(container: HTMLDivElement) {
    if (this.three) {
      // Ensure renderer canvas is attached to the current container
      const canvas = this.three.renderer.domElement as HTMLElement;
      if (canvas.parentElement !== container) {
        container.innerHTML = '';
        container.appendChild(canvas);
        // Recreate controls bound to the new DOM element
        this.three.controls.dispose();
        this.three.controls = new OrbitControls(this.three.camera, this.three.renderer.domElement);
        this.three.controls.enableDamping = true;
        this.three.controls.dampingFactor = 0.08;
        this.three.controls.enablePan = false;
        this.three.controls.target.set(0, 0, 0);
      }
      this.resizeThree();
      return;
    }
    const width = container.clientWidth || 600;
    const height = Math.max(300, Math.floor(width * 0.66));
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = null;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 0.4, 1.2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
    controls.target.set(0, 0, 0);
    // lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
    hemi.position.set(0, 1, 0);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(1, 1, 1);
    scene.add(dir);
    this.three = { renderer, scene, camera, controls };
    this.startThreeLoop();
    window.addEventListener('resize', this.resizeThree);
  }

  private startThreeLoop() {
    if (!this.three) return;
    if (this.three.animId) return; // already running
    const animate = () => {
      if (!this.three) return;
      this.three.controls.update();
      this.three.renderer.render(this.three.scene, this.three.camera);
      this.three.animId = requestAnimationFrame(animate);
    };
    animate();
  }

  private resizeThree = () => {
    if (!this.three || !this.threeContainer?.nativeElement) return;
    const el = this.threeContainer.nativeElement;
    const w = el.clientWidth || 600;
    const h = Math.max(300, Math.floor(w * 0.66));
    this.three.renderer.setSize(w, h);
    this.three.camera.aspect = w / h;
    this.three.camera.updateProjectionMatrix();
  };

  private buildHeightMeshFromImage(img: HTMLImageElement, opts: ReliefOptions) {
    // Build a heightfield based on grayscale refined with edge-guided unsharp + normalization
    // Choose processing resolution with a small boost if adaptive/subdivision are enabled (visual only)
    const boost = (opts.adaptiveSubdivision ? 40 : 0) + ((opts.subdivisionLevel - 1) * 20);
    const sample = Math.max(32, Math.min(opts.sampleMax + boost, 512));
    const ar = img.height / img.width;
    const tw = sample;
    const th = Math.max(16, Math.floor(sample * ar));
    const c = document.createElement('canvas'); c.width = tw; c.height = th;
    const cx = c.getContext('2d', { willReadFrequently: true })!;
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, tw, th);
  const rgba = cx.getImageData(0, 0, tw, th).data;
    // 1) grayscale in [0,1]
    const g = new Float32Array(tw * th);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
      const y = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
      g[p] = (opts.invert ? (255 - y) : y) / 255;
    }
    // small helpers
    const clamp01 = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v;
    const boxBlur = (src: Float32Array, w: number, h: number, r: number) => {
      if (r <= 0) return src;
      const out = new Float32Array(src.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let acc = 0, count = 0;
          for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) { acc += src[ny * w + nx]; count++; }
          }
          out[y * w + x] = count ? acc / count : src[y * w + x];
        }
      }
      return out;
    };
    const sobelMag = (src: Float32Array, w: number, h: number) => {
      const out = new Float32Array(src.length);
      const kx = [-1,0,1,-2,0,2,-1,0,1];
      const ky = [-1,-2,-1,0,0,0,1,2,1];
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          let sx = 0, sy = 0, k = 0;
          for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
            const v = src[(y + j) * w + (x + i)];
            sx += v * kx[k]; sy += v * ky[k]; k++;
          }
          out[y * w + x] = Math.hypot(sx, sy);
        }
      }
      return out;
    };
    const minMax = (src: Float32Array) => {
      let mn = src[0], mx = src[0];
      for (let i = 1; i < src.length; i++) { const v = src[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      return { mn, mx };
    };
    // 2) edge-guided unsharp: blur -> high = g - blur -> sharpen = g + alpha(high * edgeWeight)
    const kernelMap = new Map<number, number>([[1,0],[3,1],[5,2],[7,3],[9,4]]);
    let baseRadius = kernelMap.get(opts.smoothingKernel) ?? 0;
    // UI surfaceSmoothing augments blur a bit; preserveDetails reduces it
    if (opts.surfaceSmoothing > 0.33) baseRadius = Math.max(baseRadius, 1);
    if (opts.surfaceSmoothing > 0.66) baseRadius = Math.max(baseRadius, 2);
    if (opts.preserveDetails) baseRadius = Math.max(0, baseRadius - 1);
    const blur = boxBlur(g, tw, th, baseRadius);
    const edges = sobelMag(g, tw, th);
    // normalize edges to [0,1]
    const { mn: emin, mx: emax } = minMax(edges);
    const eRange = emax - emin || 1;
    for (let i = 0; i < edges.length; i++) edges[i] = (edges[i] - emin) / eRange;
    const sharpenStrength = (opts.enhanceEdges ? 0.6 : 0.25) + (opts.qualityThreshold * 0.2);
    const refined = new Float32Array(g.length);
    for (let i = 0; i < g.length; i++) {
      const high = g[i] - blur[i];
      const w = 0.5 + 0.5 * edges[i]; // weight more on strong edges
      refined[i] = clamp01(g[i] + sharpenStrength * high * w);
    }
    // 3) soft smoothing pass to remove ringing
    let finalH = refined;
    const smoothPass = opts.surfaceSmoothing > 0 ? (opts.surfaceSmoothing < 0.5 ? 1 : 2) : 0;
    if (smoothPass > 0) finalH = boxBlur(finalH, tw, th, smoothPass);
    // 4) normalize heights to [0,1] and apply slight gamma to enhance mid-tones
    const { mn, mx } = minMax(finalH);
    const invR = 1 / (mx - mn || 1);
    const gamma = 1.0 / Math.max(0.8, Math.min(1.4, 1.0 + (opts.depthMultiplier - 1.0) * 0.2));
    for (let i = 0; i < finalH.length; i++) {
      let v = (finalH[i] - mn) * invR;
      // optional floor lift using qualityThreshold
      if (opts.qualityThreshold > 0) v = Math.max(v, opts.qualityThreshold * 0.05);
      finalH[i] = Math.pow(clamp01(v), gamma);
    }
    // Build plane geometry subdivided as tw x th
    const geo = new THREE.PlaneGeometry(1, ar, tw - 1, th - 1);
    // Displace vertices by height
  const verts = geo.attributes.position as any;
    const maxHeight = (opts.maxHeightMM / 25) * opts.depthMultiplier; // ~0..0.2 scene units
    for (let i = 0; i < verts.count; i++) {
      const ix = i % tw;
      const iy = Math.floor(i / tw);
      const h = finalH[iy * tw + ix];
      // Add a small base offset to keep non-zero depth consistent with STL preview
      const baseOffset = Math.min(0.05, Math.max(0, this.baseMM() / 50));
      // PlaneGeometry is centered; z is up for us after rotation
      verts.setZ(i, baseOffset + h * maxHeight);
    }
    verts.needsUpdate = true;
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.0, roughness: 0.9, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    // Rotate to put Z as height and Y up in view (plane initially faces +z)
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  // Build a watertight printable mesh (top surface + bottom + side walls) from a depth map in [0,1]
  private buildWatertightFromDepth(depth: Float32Array, tw: number, th: number, opts: ReliefOptions) {
    const widthMM = Math.max(10, this.widthMM());
    const heightMM = Math.max(10, Math.floor(widthMM * (th / tw)));
    const segX = tw - 1, segY = th - 1;
    const vxCount = tw * th;
    const baseMM = Math.max(0, this.baseMM());
    const maxHeight = (opts.maxHeightMM || this.maxHeightMM());
    const depthScale = Math.max(0.1, opts.depthMultiplier || 1.0);

    const positions: number[] = [];
    const indices: number[] = [];

    const pushVertex = (x: number, y: number, z: number) => { positions.push(x, y, z); };
    // Generate grid positions (X,Y) and Z for top and bottom
    const xs = new Array(tw).fill(0).map((_, i) => -widthMM / 2 + (i / (tw - 1)) * widthMM);
    const ys = new Array(th).fill(0).map((_, j) => -heightMM / 2 + (j / (th - 1)) * heightMM);

    // Top vertices
    for (let j = 0; j < th; j++) {
      for (let i = 0; i < tw; i++) {
        const h = depth[j * tw + i]; // 0..1
        const z = baseMM + h * maxHeight * depthScale;
        pushVertex(xs[i], ys[j], z);
      }
    }
    // Bottom vertices (z=0)
    for (let j = 0; j < th; j++) {
      for (let i = 0; i < tw; i++) {
        pushVertex(xs[i], ys[j], 0);
      }
    }

    const idxTop = (i: number, j: number) => j * tw + i;
    const idxBot = (i: number, j: number) => vxCount + j * tw + i;

    // Top faces
    for (let j = 0; j < segY; j++) {
      for (let i = 0; i < segX; i++) {
        const a = idxTop(i, j);
        const b = idxTop(i + 1, j);
        const c = idxTop(i, j + 1);
        const d = idxTop(i + 1, j + 1);
        // two triangles: (a,b,d) and (a,d,c)
        indices.push(a, b, d, a, d, c);
      }
    }
    // Bottom faces (reverse winding)
    for (let j = 0; j < segY; j++) {
      for (let i = 0; i < segX; i++) {
        const a = idxBot(i, j);
        const b = idxBot(i + 1, j);
        const c = idxBot(i, j + 1);
        const d = idxBot(i + 1, j + 1);
        indices.push(a, d, b, a, c, d);
      }
    }
    // Side walls: four edges
    // Top edge (j=0)
    for (let i = 0; i < segX; i++) {
      const tA = idxTop(i, 0), tB = idxTop(i + 1, 0);
      const bA = idxBot(i, 0), bB = idxBot(i + 1, 0);
      indices.push(tA, bA, bB, tA, bB, tB);
    }
    // Bottom edge (j=th-1)
    for (let i = 0; i < segX; i++) {
      const tA = idxTop(i, th - 1), tB = idxTop(i + 1, th - 1);
      const bA = idxBot(i, th - 1), bB = idxBot(i + 1, th - 1);
      // opposite winding
      indices.push(tB, bB, bA, tB, bA, tA);
    }
    // Left edge (i=0)
    for (let j = 0; j < segY; j++) {
      const tA = idxTop(0, j), tB = idxTop(0, j + 1);
      const bA = idxBot(0, j), bB = idxBot(0, j + 1);
      indices.push(tA, bB, bA, tA, tB, bB);
    }
    // Right edge (i=tw-1)
    for (let j = 0; j < segY; j++) {
      const tA = idxTop(tw - 1, j), tB = idxTop(tw - 1, j + 1);
      const bA = idxBot(tw - 1, j), bB = idxBot(tw - 1, j + 1);
      indices.push(tA, bA, bB, tA, bB, tB);
    }

    const geo = new THREE.BufferGeometry();
    const posArr = new Float32Array(positions);
    const idxArr = new Uint32Array(indices);
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geo.setIndex(new THREE.BufferAttribute(idxArr, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.0, roughness: 0.9, side: THREE.DoubleSide });
    const mesh = new (THREE as any).Mesh(geo, mat);
    // Keep orientation consistent with previous preview (XZ ground, Y up)
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  private sampleGrayDepth(img: HTMLImageElement, tw: number, th: number, invert: boolean): Float32Array {
    const c = document.createElement('canvas'); c.width = tw; c.height = th;
    const cx = c.getContext('2d', { willReadFrequently: true })!;
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, tw, th);
    const rgba = cx.getImageData(0, 0, tw, th).data;
    const out = new Float32Array(tw * th);
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const i = (y * tw + x) * 4;
        const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
        let Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (invert) Y = 255 - Y;
        out[y * tw + x] = Y / 255;
      }
    }
    return out;
  }

  private async render3DPreview(file: File) {
    if (!file.type.startsWith('image/')) return;
    if (!this.threeContainer?.nativeElement) {
      // Container not yet in DOM due to *ngSwitch timing; retry next frame
      requestAnimationFrame(() => this.render3DPreview(file));
      return;
    }
    await this.ensureThree(this.threeContainer.nativeElement);
    // Load image
    this.revokeObjectUrl();
    this.objectUrlForPreview = URL.createObjectURL(file);
    const img = await this.loadImage(this.objectUrlForPreview);
  // Try client-side depth if enabled and available (model must exist in assets); otherwise continue with grayscale-based relief
    let useOnnx = false;
    if (this.useDepth()) {
      try {
        // Quick existence check for model path; if 404, this will throw in ensureSession.
    await this.depthRt.ensureSession();
    this.depthAvailable.set(true);
        useOnnx = true;
      } catch {
    this.depthAvailable.set(false);
        useOnnx = false;
      }
    }
    // Build/update mesh
    const opts: ReliefOptions = {
      invert: this.invert(),
      enhanceEdges: this.enhanceEdges(),
      surfaceSmoothing: this.surfaceSmoothing(),
      smoothingKernel: this.smoothingKernel(),
      depthMultiplier: this.depthMultiplier(),
      qualityThreshold: this.qualityThreshold(),
      preserveDetails: this.preserveDetails(),
      subdivisionLevel: this.subdivisionLevel(),
      adaptiveSubdivision: this.adaptiveSubdivision(),
      sampleMax: this.sampleMax(),
      maxHeightMM: this.maxHeightMM(),
    };
    let mesh: any;
    if (useOnnx) {
      try {
        const { depth, size } = await this.depthRt.estimateDepth(img);
        // Resample depth to target tw/th and apply same refinement/normalization path
        const ar = img.height / img.width;
        const sample = Math.max(32, Math.min(opts.sampleMax + ((opts.subdivisionLevel - 1) * 20), 512));
        const tw = sample;
        const th = Math.max(16, Math.floor(sample * ar));
        // Simple resize from square depth (size x size) to tw x th
        const d2 = new Float32Array(tw * th);
        const sx = size / tw; const sy = size / th;
        for (let y = 0; y < th; y++) {
          for (let x = 0; x < tw; x++) {
            const ix = Math.min(size - 1, Math.floor(x * sx));
            const iy = Math.min(size - 1, Math.floor(y * sy));
            d2[y * tw + x] = depth[iy * size + ix];
          }
        }
        // Normalize/invert if needed
        let mn = d2[0], mx = d2[0];
        for (let i = 1; i < d2.length; i++) { const v = d2[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
        const invR = 1 / ((mx - mn) || 1);
        for (let i = 0; i < d2.length; i++) {
          let v = (d2[i] - mn) * invR;
          if (opts.invert) v = 1 - v;
          d2[i] = v;
        }
  // Build watertight printable mesh from depth map
  mesh = this.buildWatertightFromDepth(d2, tw, th, opts);
  this.lastDepthData = { d: d2, tw, th, opts };
      } catch {
        mesh = this.buildHeightMeshFromImage(img, opts);
      }
    } else {
      // Grayscale-based depth as fallback
      const ar = img.height / img.width;
      const sample = Math.max(32, Math.min(opts.sampleMax + ((opts.subdivisionLevel - 1) * 20), 512));
      const tw = sample;
      const th = Math.max(16, Math.floor(sample * ar));
  const d2 = this.sampleGrayDepth(img, tw, th, opts.invert);
  mesh = this.buildWatertightFromDepth(d2, tw, th, opts);
  this.lastDepthData = { d: d2, tw, th, opts };
    }
    // Insert/replace in scene
    if (this.three!.mesh) {
      this.three!.scene.remove(this.three!.mesh);
      this.three!.mesh.geometry.dispose();
      // keep material reused
    }
    this.three!.mesh = mesh;
    this.three!.scene.add(mesh);
  // frame the object based on bbox
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  this.three!.controls.target.copy(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  const dist = maxDim * 1.8;
  this.three!.camera.position.set(center.x + dist * 0.5, center.y + dist * 0.6, center.z + dist);
  this.three!.camera.near = Math.max(0.01, maxDim / 500);
  this.three!.camera.far = dist * 10;
  this.three!.camera.updateProjectionMatrix();
    this.resizeThree();
  }

  async upload() {
    const f = this.file();
    if (!f || this.isLoading()) return;
    this.resetError();
    this.isLoading.set(true);
    this.downloadUrl.set(null);
    try {
      const blob = await this.engine.convert(f, {
        widthMM: this.widthMM(),
        baseMM: this.baseMM(),
        maxHeightMM: this.maxHeightMM(),
        sampleMax: this.sampleMax(),

        subdivisionLevel: this.subdivisionLevel(),
        depthMultiplier: this.depthMultiplier(),
        surfaceSmoothing: this.surfaceSmoothing(),
        qualityThreshold: this.qualityThreshold(),

        invert: this.invert(),
        enhanceEdges: this.enhanceEdges(),
        preserveDetails: this.preserveDetails(),
        adaptiveSubdivision: this.adaptiveSubdivision(),

        compressionLevel: this.compressionLevel(),
        format: this.format(),
      });
  const url = URL.createObjectURL(blob);
      this.downloadUrl.set(url);
  this.lastConversion.set('relief');
  this.lastExt.set('stl');
    } catch (e) {
      this.setError(e);
    } finally {
      this.isLoading.set(false);
    }
  }

  async uploadHQ() {
  // Kept for backend HQ pipeline (not used by UI button now). Consider exposing via advanced toggle.
    const f = this.file();
    if (!f || this.isLoading()) return;
    this.resetError();
    this.isLoading.set(true);
    this.downloadUrl.set(null);
    try {
      const blob = await this.engine.convertHQ(f, {
        widthMM: this.widthMM(),
        baseMM: this.baseMM(),
        maxHeightMM: this.maxHeightMM(),
        sampleMax: this.sampleMax(),
        subdivisionLevel: this.subdivisionLevel(),
        depthMultiplier: this.depthMultiplier(),
        surfaceSmoothing: this.surfaceSmoothing(),
        qualityThreshold: this.qualityThreshold(),
        invert: this.invert(),
        enhanceEdges: this.enhanceEdges(),
        preserveDetails: this.preserveDetails(),
        adaptiveSubdivision: this.adaptiveSubdivision(),
        compressionLevel: this.compressionLevel(),
        format: this.format(),
        hqFormat: 'stl',
      } as any);
  const url = URL.createObjectURL(blob);
  this.downloadUrl.set(url);
  this.lastConversion.set('3d');
  this.lastExt.set('stl'); // update if allowing obj/glb later
    } catch (e) {
      this.setError(e);
    } finally {
      this.isLoading.set(false);
    }
  }

  // Export the current 3D preview as STL (matches what's shown in the 3D tab)
  async convert3D() {
    const f = this.file();
    if (!f || this.isLoading()) return;
    this.resetError();
    this.isLoading.set(true);
    this.downloadUrl.set(null);
    try {
      // Ensure three scene and mesh are ready
      if (!this.threeContainer?.nativeElement) {
        // If 3D container not rendered yet, force 3D mode to create it
        this.setPreviewMode('3d');
      }
      await this.ensureThree(this.threeContainer!.nativeElement);
      if (!this.lastDepthData) {
        // Ensure we have fresh depth matching preview
        await this.render3DPreview(f);
      }
      const { d, tw, th, opts } = this.lastDepthData!;
      const expMesh = this.buildWatertightFromDepth(d, tw, th, opts);
      const exporter = new STLExporter();
      const arrayBuffer = exporter.parse(expMesh, { binary: true }) as ArrayBuffer;
      const blob = new Blob([arrayBuffer], { type: 'model/stl' });
      const url = URL.createObjectURL(blob);
      this.downloadUrl.set(url);
      this.lastConversion.set('3d');
      this.lastExt.set('stl');
    } catch (e) {
      this.setError(e);
    } finally {
      this.isLoading.set(false);
    }
  }

  resetControls() {
    this.widthMM.set(100);
    this.baseMM.set(1);
    this.maxHeightMM.set(5);
    this.sampleMax.set(300);
    this.smoothingKernel.set(1);

    this.subdivisionLevel.set(1);
    this.depthMultiplier.set(1.0);
    this.surfaceSmoothing.set(0.0);
    this.qualityThreshold.set(0.3);

    this.invert.set(false);
    this.enhanceEdges.set(false);
    this.preserveDetails.set(true);
    this.adaptiveSubdivision.set(true);

    this.compressionLevel.set(1);
    this.format.set('binary');
    this.previewMode.set('image');

  this.error.set(null);
  // Clear any previous download so the "Descargar" button disappears
  const dl = this.downloadUrl();
  if (dl) { URL.revokeObjectURL(dl); }
  this.downloadUrl.set(null);
  this.lastConversion.set(null);
  }

  ngOnDestroy() {
    this.revokeObjectUrl();
    const dl = this.downloadUrl();
    if (dl) URL.revokeObjectURL(dl);
    if (this.three) {
      if (this.three.animId) cancelAnimationFrame(this.three.animId);
      this.three.controls.dispose();
      this.three.renderer.dispose();
      this.three = undefined;
      window.removeEventListener('resize', this.resizeThree);
    }
  }
}
