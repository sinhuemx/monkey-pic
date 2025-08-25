import { Injectable } from '@angular/core';

// Lazy import to keep bundle smaller; dynamic import when used
@Injectable({ providedIn: 'root' })
export class DepthRuntimeService {
  private _session: any | null = null;
  private _inputName: string | null = null;
  static readonly MODEL_URL = '/assets/models/midas_small.onnx';

  async ensureSession(): Promise<void> {
    if (this._session) return;
    const ort = await import('onnxruntime-web');
    // Try WebGPU first, fallback to WASM
    const providers = ['webgpu', 'wasm'];
    const modelUrl = DepthRuntimeService.MODEL_URL;
    this._session = await ort.InferenceSession.create(modelUrl, { executionProviders: providers as any });
    this._inputName = this._session.inputNames?.[0] ?? 'input';
  }

  async isAvailable(): Promise<boolean> {
    try { await this.ensureSession(); return true; } catch { return false; }
  }

  // Minimal preprocessing to 256x256 and normalize to [0,1]
  private toTensor(img: HTMLImageElement | ImageBitmap, size = 256) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const cx = c.getContext('2d', { willReadFrequently: true })!;
    cx.drawImage(img as any, 0, 0, size, size);
    const data = cx.getImageData(0, 0, size, size).data;
    const float = new Float32Array(size * size * 3);
    // Use ImageNet normalization (common for DPT/MiDaS ONNX exports)
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];
    for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      float[p] = (r - mean[0]) / std[0];
      float[p + 1] = (g - mean[1]) / std[1];
      float[p + 2] = (b - mean[2]) / std[2];
    }
    // NCHW
    const nchw = new Float32Array(1 * 3 * size * size);
    let o = 0; const ch = size * size;
    const R = 0, G = 1, B = 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 3;
        nchw[o + 0 * ch + (y * size + x)] = float[idx + R];
        nchw[o + 1 * ch + (y * size + x)] = float[idx + G];
        nchw[o + 2 * ch + (y * size + x)] = float[idx + B];
      }
    }
    return { tensor: nchw, size };
  }

  async estimateDepth(img: HTMLImageElement | ImageBitmap): Promise<{ depth: Float32Array; size: number }> {
    await this.ensureSession();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ort = await import('onnxruntime-web');
    const { tensor, size } = this.toTensor(img, 256);
    const input = new ort.Tensor('float32', tensor, [1, 3, size, size]);
    const feeds: Record<string, any> = {};
    feeds[this._inputName!] = input;
    const out = await this._session.run(feeds);
    const outName = this._session.outputNames?.[0] ?? Object.keys(out)[0];
  const depth = out[outName].data as Float32Array;
    // depth is 1x1xHxW; normalize to [0,1]
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < depth.length; i++) { const v = depth[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    const range = (mx - mn) || 1;
  const norm = new Float32Array(depth.length);
  for (let i = 0; i < depth.length; i++) norm[i] = (depth[i] - mn) / range;
  return { depth: norm, size };
  }
}
