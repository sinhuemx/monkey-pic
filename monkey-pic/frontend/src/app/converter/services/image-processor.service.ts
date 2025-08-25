import { HeightmapData, ImageDimensions, ConversionParameters } from '../types/converter.types';

/**
 * High-performance image processor for STL conversion
 * Implements advanced algorithms for optimal quality and compression
 */
export class ImageProcessor {
  private static readonly SOBEL_X = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  private static readonly SOBEL_Y = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  private static readonly GAUSSIAN_3X3 = [1, 2, 1, 2, 4, 2, 1, 2, 1];

  /**
   * Extract luminance heightmap with edge-preserving smoothing
   */
  static extractHeightmap(
    imgBitmap: ImageBitmap, 
    targetWidth: number, 
    targetHeight: number,
    params: ConversionParameters
  ): HeightmapData {
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d')!;
    
    // High-quality resampling
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // Draw with contain scaling to preserve aspect ratio
    const dimensions = this.calculateContainDimensions(
      imgBitmap, 
      targetWidth, 
      targetHeight
    );
    
    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(
      imgBitmap,
      dimensions.x,
      dimensions.y,
      dimensions.width,
      dimensions.height
    );

    const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const heightData = new Float32Array(targetWidth * targetHeight);
    
    // Extract luminance with sRGB gamma correction
    for (let i = 0; i < imageData.data.length; i += 4) {
      const r = this.srgbToLinear(imageData.data[i] / 255);
      const g = this.srgbToLinear(imageData.data[i + 1] / 255);
      const b = this.srgbToLinear(imageData.data[i + 2] / 255);
      
      // Perceptual luminance (ITU-R BT.709)
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const pixelIndex = Math.floor(i / 4);
      
      heightData[pixelIndex] = params.invert ? (1 - luminance) : luminance;
    }

    // Apply edge-preserving bilateral filter for smoother results
    const filteredData = this.bilateralFilter(
      heightData, 
      targetWidth, 
      targetHeight,
      params.smoothingKernel || 2
    );

    const { min, max } = this.getMinMax(filteredData);
    
    return {
      data: filteredData,
      width: targetWidth,
      height: targetHeight,
      minHeight: min,
      maxHeight: max
    };
  }

  /**
   * Calculate contain dimensions maintaining aspect ratio
   */
  private static calculateContainDimensions(
    img: ImageBitmap,
    containerWidth: number,
    containerHeight: number
  ) {
    const imgRatio = img.width / img.height;
    const containerRatio = containerWidth / containerHeight;

    let width, height, x, y;

    if (imgRatio > containerRatio) {
      width = containerWidth;
      height = containerWidth / imgRatio;
      x = 0;
      y = (containerHeight - height) / 2;
    } else {
      height = containerHeight;
      width = containerHeight * imgRatio;
      x = (containerWidth - width) / 2;
      y = 0;
    }

    return { x, y, width, height };
  }

  /**
   * sRGB to linear color space conversion
   */
  private static srgbToLinear(value: number): number {
    return value <= 0.04045 
      ? value / 12.92 
      : Math.pow((value + 0.055) / 1.055, 2.4);
  }

  /**
   * Bilateral filter for edge-preserving smoothing
   */
  private static bilateralFilter(
    data: Float32Array,
    width: number,
    height: number,
    radius: number = 2
  ): Float32Array {
    const filtered = new Float32Array(data.length);
    const sigma_s = radius / 3; // Spatial sigma
    const sigma_r = 0.1; // Range sigma

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const centerIdx = y * width + x;
        const centerValue = data[centerIdx];
        
        let weightSum = 0;
        let valueSum = 0;

        // Sample within radius
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const idx = ny * width + nx;
              const value = data[idx];
              
              // Spatial weight (Gaussian)
              const spatialDist = Math.sqrt(dx * dx + dy * dy);
              const spatialWeight = Math.exp(-(spatialDist * spatialDist) / (2 * sigma_s * sigma_s));
              
              // Range weight (difference in intensity)
              const rangeDist = Math.abs(value - centerValue);
              const rangeWeight = Math.exp(-(rangeDist * rangeDist) / (2 * sigma_r * sigma_r));
              
              const weight = spatialWeight * rangeWeight;
              weightSum += weight;
              valueSum += weight * value;
            }
          }
        }
        
        filtered[centerIdx] = weightSum > 0 ? valueSum / weightSum : centerValue;
      }
    }

    return filtered;
  }

  /**
   * Edge enhancement using Sobel operator
   */
  static enhanceEdges(
    heightData: Float32Array,
    width: number,
    height: number,
    strength: number = 0.5
  ): Float32Array {
    const enhanced = new Float32Array(heightData.length);
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let gx = 0, gy = 0;
        
        // Apply Sobel kernels
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = (y + ky) * width + (x + kx);
            const kernelIdx = (ky + 1) * 3 + (kx + 1);
            
            gx += heightData[idx] * this.SOBEL_X[kernelIdx];
            gy += heightData[idx] * this.SOBEL_Y[kernelIdx];
          }
        }
        
        const gradient = Math.sqrt(gx * gx + gy * gy);
        const originalIdx = y * width + x;
        
        // Enhance edges while preserving smooth areas
        enhanced[originalIdx] = heightData[originalIdx] + gradient * strength;
      }
    }
    
    // Copy borders
    for (let x = 0; x < width; x++) {
      enhanced[x] = heightData[x]; // Top
      enhanced[(height - 1) * width + x] = heightData[(height - 1) * width + x]; // Bottom
    }
    
    for (let y = 0; y < height; y++) {
      enhanced[y * width] = heightData[y * width]; // Left
      enhanced[y * width + width - 1] = heightData[y * width + width - 1]; // Right
    }
    
    return enhanced;
  }

  /**
   * Find min and max values efficiently
   */
  private static getMinMax(data: Float32Array): { min: number; max: number } {
    let min = data[0];
    let max = data[0];
    
    for (let i = 1; i < data.length; i++) {
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }
    
    return { min, max };
  }

  /**
   * Normalize heightmap to specified range
   */
  static normalizeHeightmap(
    heightData: Float32Array,
    targetMin: number = 0,
    targetMax: number = 1
  ): Float32Array {
    const { min, max } = this.getMinMax(heightData);
    const range = max - min;
    const targetRange = targetMax - targetMin;
    
    if (range === 0) return heightData;
    
    const normalized = new Float32Array(heightData.length);
    for (let i = 0; i < heightData.length; i++) {
      normalized[i] = targetMin + ((heightData[i] - min) / range) * targetRange;
    }
    
    return normalized;
  }
}
