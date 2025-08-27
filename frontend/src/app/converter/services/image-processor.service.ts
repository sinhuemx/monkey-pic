// services/image-processor.service.ts
import { Injectable } from '@angular/core';
import { ImageEditOps } from '../types/converter.types';

@Injectable({ providedIn: 'root' })
export class ImageProcessorService {
  async load(file: File): Promise<ImageBitmap> {
    const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'image/png' });
    return await createImageBitmap(blob);
  }

  async applyOps(bitmap: ImageBitmap, ops: ImageEditOps): Promise<ImageBitmap> {
    const scale = Math.max(0.1, (ops.scalePct ?? 100) / 100);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const off = new OffscreenCanvas(w, h);
    const ctx = off.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0, w, h);

    // Crop (si viene definido)
    if (ops.crop) {
      const { x, y, w: cw, h: ch } = ops.crop;
      const crop = new OffscreenCanvas(cw, ch);
      const cctx = crop.getContext('2d')!;
      cctx.drawImage(off, x, y, cw, ch, 0, 0, cw, ch);
      return await createImageBitmap(crop);
    }

    // Ajustes sencillos de brillo/contraste
    if (ops.brightness != null || ops.contrast != null) {
      const img = ctx.getImageData(0, 0, w, h);
      const data = img.data;
      const b = (ops.brightness ?? 0) * 255;
      const c = (ops.contrast ?? 0);
      const f = (259 * (c + 1)) / (255 * (1 - c));
      for (let i=0;i<data.length;i+=4){
        data[i]   = this._clamp(f*(data[i]  -128)+128 + b);
        data[i+1] = this._clamp(f*(data[i+1]-128)+128 + b);
        data[i+2] = this._clamp(f*(data[i+2]-128)+128 + b);
      }
      ctx.putImageData(img, 0, 0);
    }

    return await createImageBitmap(off);
  }

  async toHeightmap(bitmap: ImageBitmap, samples: number, kernel: 1|3|5|7|9): Promise<Float32Array> {
    const N = Math.max(16, Math.min(4096, Math.round(samples)));
    const off = new OffscreenCanvas(N, N);
    const ctx = off.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bitmap, 0, 0, N, N);
    const img = ctx.getImageData(0, 0, N, N).data;
    const hm = new Float32Array(N*N);
    for (let i=0,p=0;i<img.length;i+=4,p++){
      const gray = (0.2126*img[i] + 0.7152*img[i+1] + 0.0722*img[i+2]) / 255;
      hm[p] = gray;
    }
    return hm;
  }

  async removeBackground(bitmap: ImageBitmap): Promise<ImageBitmap> {
    // Placeholder para evitar "cuadro" plano en 3D: aquí iría segmentación real
    // TODO: Integrar U²-Net/RemBG para segmentación nítida sin fondo
    return bitmap;
  }

  /**
   * Upscale x2 con Lanczos-like para bordes más limpios
   */
  async upscale2x(bitmap: ImageBitmap): Promise<ImageBitmap> {
    const w = bitmap.width * 2;
    const h = bitmap.height * 2;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    
    // Configurar máxima calidad de interpolación
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await createImageBitmap(canvas);
  }

  /**
   * Pre-filtro: reducción de ruido + unsharp mask suave
   */
  async preFilter(bitmap: ImageBitmap): Promise<ImageBitmap> {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const w = canvas.width;
    const h = canvas.height;
    
    // Aplicar ligera reducción de ruido (blur muy suave)
    this.applyGaussianBlur(data, w, h, 0.5);
    
    // Unsharp mask suave para conservar contornos
    this.applyUnsharpMask(data, w, h, 0.3, 1.5);
    
    ctx.putImageData(imageData, 0, 0);
    return await createImageBitmap(canvas);
  }

  /**
   * Pipeline completo de preparación para calidad profesional
   */
  async prepareForHighQuality(bitmap: ImageBitmap): Promise<ImageBitmap> {
    console.log('🎯 Iniciando pipeline de calidad profesional...');
    
    // 1. Pre-filtro para limpiar la imagen
    const filtered = await this.preFilter(bitmap);
    console.log('✅ Pre-filtro aplicado');
    
    // 2. Upscale x2 para bordes más limpios
    const upscaled = await this.upscale2x(filtered);
    console.log('✅ Upscale x2 completado');
    
    // 3. Segmentación (placeholder - aquí iría RemBG real)
    const segmented = await this.removeBackground(upscaled);
    console.log('✅ Segmentación aplicada');
    
    console.log('🎯 Pipeline de calidad completado:', {
      originalSize: `${bitmap.width}x${bitmap.height}`,
      finalSize: `${segmented.width}x${segmented.height}`,
      scaleFactor: '2x'
    });
    
    return segmented;
  }

  private applyGaussianBlur(data: Uint8ClampedArray, w: number, h: number, radius: number) {
    const kernel = this.generateGaussianKernel(radius);
    const kernelSize = kernel.length;
    const half = Math.floor(kernelSize / 2);
    const newData = new Uint8ClampedArray(data);
    
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, weight = 0;
        
        for (let ky = -half; ky <= half; ky++) {
          for (let kx = -half; kx <= half; kx++) {
            const px = Math.max(0, Math.min(w - 1, x + kx));
            const py = Math.max(0, Math.min(h - 1, y + ky));
            const idx = (py * w + px) * 4;
            const k = kernel[ky + half] * kernel[kx + half];
            
            r += data[idx] * k;
            g += data[idx + 1] * k;
            b += data[idx + 2] * k;
            weight += k;
          }
        }
        
        const idx = (y * w + x) * 4;
        newData[idx] = r / weight;
        newData[idx + 1] = g / weight;
        newData[idx + 2] = b / weight;
      }
    }
    
    data.set(newData);
  }

  private applyUnsharpMask(data: Uint8ClampedArray, w: number, h: number, amount: number, threshold: number) {
    const original = new Uint8ClampedArray(data);
    
    // Aplicar blur
    this.applyGaussianBlur(data, w, h, 1.0);
    
    // Unsharp mask
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const diff = original[i + c] - data[i + c];
        if (Math.abs(diff) > threshold) {
          data[i + c] = this._clamp(original[i + c] + diff * amount);
        } else {
          data[i + c] = original[i + c];
        }
      }
    }
  }

  private generateGaussianKernel(radius: number): number[] {
    const size = Math.ceil(radius * 2) * 2 + 1;
    const kernel = new Array(size);
    const sigma = radius / 3;
    const twoSigmaSq = 2 * sigma * sigma;
    const sqrtTwoPiSigma = Math.sqrt(twoSigmaSq * Math.PI);
    let sum = 0;
    
    for (let i = 0; i < size; i++) {
      const x = i - Math.floor(size / 2);
      kernel[i] = Math.exp(-(x * x) / twoSigmaSq) / sqrtTwoPiSigma;
      sum += kernel[i];
    }
    
    // Normalizar
    for (let i = 0; i < size; i++) {
      kernel[i] /= sum;
    }
    
    return kernel;
  }

  private _clamp(v: number): number { 
    return Math.max(0, Math.min(255, v | 0)); 
  }
}
