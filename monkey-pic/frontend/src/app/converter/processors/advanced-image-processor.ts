import { 
  ImageAnalysisResult, 
  DepthEstimationConfig, 
  PhotogrammetryConfig,
  Point2D,
  TextureMetrics 
} from '../types/advanced-types';

export class AdvancedImageProcessor {
  private static readonly SOBEL_X = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
  private static readonly SOBEL_Y = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];
  private static readonly GAUSSIAN_KERNEL = [
    [1/16, 2/16, 1/16],
    [2/16, 4/16, 2/16],
    [1/16, 2/16, 1/16]
  ];

  /**
   * Advanced image analysis combining multiple computer vision techniques
   */
  public static analyzeImage(
    imageData: ImageData,
    depthConfig: DepthEstimationConfig,
    photoConfig: PhotogrammetryConfig
  ): ImageAnalysisResult {
    const { width, height, data } = imageData;
    const totalPixels = width * height;

    // 1. Convert to luminance with perceptual weighting
    const luminanceMap = this.computePerceptualLuminance(data, totalPixels);

    // 2. Multi-scale gradient analysis (inspired by SIFT)
    const gradientMap = this.computeMultiScaleGradients(luminanceMap, width, height);

    // 3. Edge detection with adaptive thresholding
    const edgeMap = this.detectAdaptiveEdges(gradientMap, width, height, depthConfig.edgeThreshold);

    // 4. AI-inspired depth estimation
    const depthMap = this.estimateDepthAI(luminanceMap, gradientMap, edgeMap, width, height, depthConfig);

    // 5. Surface normal estimation
    const normalMap = this.estimateNormals(depthMap, width, height);

    // 6. Feature point detection (SIFT/ORB-inspired)
    const featurePoints = this.detectFeaturePoints(luminanceMap, gradientMap, width, height, photoConfig);

    // 7. Texture analysis for quality metrics
    const textureMetrics = this.analyzeTexture(luminanceMap, width, height);

    return {
      luminanceMap,
      gradientMap,
      edgeMap,
      depthMap,
      normalMap,
      featurePoints,
      textureMetrics
    };
  }

  /**
   * Perceptual luminance with gamma correction
   */
  private static computePerceptualLuminance(data: Uint8ClampedArray, totalPixels: number): Float32Array {
    const luminance = new Float32Array(totalPixels);
    
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      const r = Math.pow(data[idx] / 255, 2.2);     // Gamma correction
      const g = Math.pow(data[idx + 1] / 255, 2.2);
      const b = Math.pow(data[idx + 2] / 255, 2.2);
      
      // ITU-R BT.709 perceptual weights
      luminance[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    
    return luminance;
  }

  /**
   * Multi-scale gradient computation inspired by SIFT
   */
  private static computeMultiScaleGradients(luminance: Float32Array, width: number, height: number): Float32Array {
    const gradients = new Float32Array(width * height);
    
    // Apply Gaussian blur at multiple scales
    const scales = [1, 1.6, 2.5, 4.0]; // Inspired by SIFT octaves
    const scaleResults: Float32Array[] = [];
    
    for (const scale of scales) {
      const blurred = this.applyGaussianBlur(luminance, width, height, scale);
      const scaleGradient = this.computeSobelGradients(blurred, width, height);
      scaleResults.push(scaleGradient);
    }
    
    // Combine multi-scale gradients with weighted average
    for (let i = 0; i < gradients.length; i++) {
      let weightedSum = 0;
      let totalWeight = 0;
      
      for (let s = 0; s < scales.length; s++) {
        const weight = Math.exp(-s * 0.5); // Exponential decay
        weightedSum += scaleResults[s][i] * weight;
        totalWeight += weight;
      }
      
      gradients[i] = weightedSum / totalWeight;
    }
    
    return gradients;
  }

  /**
   * Gaussian blur with configurable sigma
   */
  private static applyGaussianBlur(data: Float32Array, width: number, height: number, sigma: number): Float32Array {
    const result = new Float32Array(data.length);
    const kernelSize = Math.ceil(sigma * 3) * 2 + 1;
    const kernel = this.generateGaussianKernel(kernelSize, sigma);
    const half = Math.floor(kernelSize / 2);
    
    // Horizontal pass
    const temp = new Float32Array(data.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let weightSum = 0;
        
        for (let k = 0; k < kernelSize; k++) {
          const sx = x + k - half;
          if (sx >= 0 && sx < width) {
            const weight = kernel[k];
            sum += data[y * width + sx] * weight;
            weightSum += weight;
          }
        }
        
        temp[y * width + x] = sum / weightSum;
      }
    }
    
    // Vertical pass
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let weightSum = 0;
        
        for (let k = 0; k < kernelSize; k++) {
          const sy = y + k - half;
          if (sy >= 0 && sy < height) {
            const weight = kernel[k];
            sum += temp[sy * width + x] * weight;
            weightSum += weight;
          }
        }
        
        result[y * width + x] = sum / weightSum;
      }
    }
    
    return result;
  }

  /**
   * Generate Gaussian kernel
   */
  private static generateGaussianKernel(size: number, sigma: number): Float32Array {
    const kernel = new Float32Array(size);
    const half = Math.floor(size / 2);
    const twoSigmaSq = 2 * sigma * sigma;
    
    for (let i = 0; i < size; i++) {
      const x = i - half;
      kernel[i] = Math.exp(-(x * x) / twoSigmaSq);
    }
    
    // Normalize
    const sum = kernel.reduce((a, b) => a + b, 0);
    for (let i = 0; i < size; i++) {
      kernel[i] /= sum;
    }
    
    return kernel;
  }

  /**
   * Sobel gradient computation
   */
  private static computeSobelGradients(data: Float32Array, width: number, height: number): Float32Array {
    const gradients = new Float32Array(width * height);
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let gx = 0, gy = 0;
        
        // Apply Sobel operators
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const pixel = data[(y + ky) * width + (x + kx)];
            gx += pixel * this.SOBEL_X[ky + 1][kx + 1];
            gy += pixel * this.SOBEL_Y[ky + 1][kx + 1];
          }
        }
        
        gradients[y * width + x] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    
    return gradients;
  }

  /**
   * Adaptive edge detection with local thresholding
   */
  private static detectAdaptiveEdges(gradients: Float32Array, width: number, height: number, baseThreshold: number): Float32Array {
    const edges = new Float32Array(width * height);
    const windowSize = 9;
    const half = Math.floor(windowSize / 2);
    
    for (let y = half; y < height - half; y++) {
      for (let x = half; x < width - half; x++) {
        // Compute local statistics
        let sum = 0, sumSq = 0, count = 0;
        
        for (let dy = -half; dy <= half; dy++) {
          for (let dx = -half; dx <= half; dx++) {
            const value = gradients[(y + dy) * width + (x + dx)];
            sum += value;
            sumSq += value * value;
            count++;
          }
        }
        
        const mean = sum / count;
        const variance = (sumSq / count) - (mean * mean);
        const stdDev = Math.sqrt(variance);
        
        // Adaptive threshold based on local statistics
        const adaptiveThreshold = mean + baseThreshold * stdDev;
        const currentGradient = gradients[y * width + x];
        
        edges[y * width + x] = currentGradient > adaptiveThreshold ? 1.0 : 0.0;
      }
    }
    
    return edges;
  }

  /**
   * AI-inspired depth estimation combining multiple cues
   */
  private static estimateDepthAI(
    luminance: Float32Array,
    gradients: Float32Array,
    edges: Float32Array,
    width: number,
    height: number,
    config: DepthEstimationConfig
  ): Float32Array {
    const depth = new Float32Array(width * height);
    
    // 1. Luminance-based depth (darker = further, like atmospheric perspective)
    const luminanceDepth = this.computeLuminanceDepth(luminance);
    
    // 2. Gradient-based depth (sharp gradients = surface discontinuities)
    const gradientDepth = this.computeGradientDepth(gradients, width, height);
    
    // 3. Edge-based depth (edges often indicate depth boundaries)
    const edgeDepth = this.computeEdgeDepth(edges, width, height);
    
    // 4. Texture-based depth (fine texture = close, coarse = far)
    const textureDepth = this.computeTextureDepth(luminance, width, height);
    
    // Combine all depth cues with learned weights (inspired by neural networks)
    const weights = {
      luminance: 0.3,
      gradient: 0.35,
      edge: 0.2,
      texture: 0.15
    };
    
    for (let i = 0; i < depth.length; i++) {
      depth[i] = 
        weights.luminance * luminanceDepth[i] +
        weights.gradient * gradientDepth[i] +
        weights.edge * edgeDepth[i] +
        weights.texture * textureDepth[i];
    }
    
    // Apply smart smoothing to reduce noise while preserving edges
    return this.applyEdgePreservingSmoothing(depth, edges, width, height, config.smoothingKernel);
  }

  private static computeLuminanceDepth(luminance: Float32Array): Float32Array {
    const depth = new Float32Array(luminance.length);
    for (let i = 0; i < luminance.length; i++) {
      // Invert luminance and apply gamma for more realistic depth
      depth[i] = Math.pow(1.0 - luminance[i], 1.5);
    }
    return depth;
  }

  private static computeGradientDepth(gradients: Float32Array, width: number, height: number): Float32Array {
    const depth = new Float32Array(gradients.length);
    
    // High gradients often indicate surface boundaries or depth discontinuities
    for (let i = 0; i < gradients.length; i++) {
      depth[i] = Math.tanh(gradients[i] * 3.0); // Sigmoid-like response
    }
    
    return depth;
  }

  private static computeEdgeDepth(edges: Float32Array, width: number, height: number): Float32Array {
    const depth = new Float32Array(edges.length);
    const maxDistance = Math.min(width, height) * 0.1;
    
    // Distance transform from edges
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        
        if (edges[idx] > 0.5) {
          depth[idx] = 1.0;
        } else {
          // Find distance to nearest edge
          let minDist = maxDistance;
          
          for (let dy = -maxDistance; dy <= maxDistance; dy++) {
            for (let dx = -maxDistance; dx <= maxDistance; dx++) {
              const ny = y + dy;
              const nx = x + dx;
              
              if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
                const nidx = ny * width + nx;
                if (edges[nidx] > 0.5) {
                  const dist = Math.sqrt(dx * dx + dy * dy);
                  minDist = Math.min(minDist, dist);
                }
              }
            }
          }
          
          depth[idx] = Math.exp(-minDist / (maxDistance * 0.3));
        }
      }
    }
    
    return depth;
  }

  private static computeTextureDepth(luminance: Float32Array, width: number, height: number): Float32Array {
    const depth = new Float32Array(luminance.length);
    const windowSize = 7;
    const half = Math.floor(windowSize / 2);
    
    for (let y = half; y < height - half; y++) {
      for (let x = half; x < width - half; x++) {
        // Compute local texture variance
        let sum = 0, sumSq = 0, count = 0;
        
        for (let dy = -half; dy <= half; dy++) {
          for (let dx = -half; dx <= half; dx++) {
            const value = luminance[(y + dy) * width + (x + dx)];
            sum += value;
            sumSq += value * value;
            count++;
          }
        }
        
        const mean = sum / count;
        const variance = (sumSq / count) - (mean * mean);
        
        // High variance = fine texture = closer
        depth[y * width + x] = Math.tanh(variance * 10.0);
      }
    }
    
    return depth;
  }

  /**
   * Edge-preserving smoothing (bilateral filter inspired)
   */
  private static applyEdgePreservingSmoothing(
    depth: Float32Array,
    edges: Float32Array,
    width: number,
    height: number,
    kernelSize: number
  ): Float32Array {
    const result = new Float32Array(depth.length);
    const half = Math.floor(kernelSize / 2);
    const spatialSigma = kernelSize / 3.0;
    const intensitySigma = 0.1;
    
    for (let y = half; y < height - half; y++) {
      for (let x = half; x < width - half; x++) {
        const centerIdx = y * width + x;
        const centerValue = depth[centerIdx];
        let weightedSum = 0;
        let totalWeight = 0;
        
        for (let dy = -half; dy <= half; dy++) {
          for (let dx = -half; dx <= half; dx++) {
            const nidx = (y + dy) * width + (x + dx);
            const neighborValue = depth[nidx];
            
            // Spatial weight (Gaussian)
            const spatialDist = Math.sqrt(dx * dx + dy * dy);
            const spatialWeight = Math.exp(-(spatialDist * spatialDist) / (2 * spatialSigma * spatialSigma));
            
            // Intensity weight (preserve edges)
            const intensityDiff = Math.abs(centerValue - neighborValue);
            const intensityWeight = Math.exp(-(intensityDiff * intensityDiff) / (2 * intensitySigma * intensitySigma));
            
            // Edge preservation (reduce smoothing across edges)
            const edgeWeight = edges[nidx] > 0.5 ? 0.1 : 1.0;
            
            const totalWeightForPixel = spatialWeight * intensityWeight * edgeWeight;
            weightedSum += neighborValue * totalWeightForPixel;
            totalWeight += totalWeightForPixel;
          }
        }
        
        result[centerIdx] = totalWeight > 0 ? weightedSum / totalWeight : centerValue;
      }
    }
    
    return result;
  }

  /**
   * Surface normal estimation from depth map
   */
  private static estimateNormals(depth: Float32Array, width: number, height: number): Float32Array {
    const normals = new Float32Array(width * height * 3); // x, y, z components
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        
        // Compute gradients in x and y directions
        const dzdx = (depth[y * width + (x + 1)] - depth[y * width + (x - 1)]) * 0.5;
        const dzdy = (depth[(y + 1) * width + x] - depth[(y - 1) * width + x]) * 0.5;
        
        // Normal vector (cross product of tangent vectors)
        const nx = -dzdx;
        const ny = -dzdy;
        const nz = 1.0;
        
        // Normalize
        const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
        
        normals[idx * 3] = nx / length;
        normals[idx * 3 + 1] = ny / length;
        normals[idx * 3 + 2] = nz / length;
      }
    }
    
    return normals;
  }

  /**
   * Feature point detection inspired by SIFT/ORB
   */
  private static detectFeaturePoints(
    luminance: Float32Array,
    gradients: Float32Array,
    width: number,
    height: number,
    config: PhotogrammetryConfig
  ): Point2D[] {
    const features: Point2D[] = [];
    const threshold = 0.1;
    const windowSize = 9;
    const half = Math.floor(windowSize / 2);
    
    // Harris corner detection
    for (let y = half; y < height - half; y++) {
      for (let x = half; x < width - half; x++) {
        let Ixx = 0, Iyy = 0, Ixy = 0;
        
        // Compute structure tensor
        for (let dy = -half; dy <= half; dy++) {
          for (let dx = -half; dx <= half; dx++) {
            const idx = (y + dy) * width + (x + dx);
            
            // Compute gradients
            const gx = x + dx < width - 1 ? 
              luminance[(y + dy) * width + (x + dx + 1)] - luminance[(y + dy) * width + (x + dx - 1)] : 0;
            const gy = y + dy < height - 1 ? 
              luminance[(y + dy + 1) * width + (x + dx)] - luminance[(y + dy - 1) * width + (x + dx)] : 0;
            
            Ixx += gx * gx;
            Iyy += gy * gy;
            Ixy += gx * gy;
          }
        }
        
        // Harris response
        const det = Ixx * Iyy - Ixy * Ixy;
        const trace = Ixx + Iyy;
        const response = det - 0.04 * trace * trace;
        
        if (response > threshold && this.isLocalMaximum(gradients, x, y, width, height, 3)) {
          features.push({
            x,
            y,
            intensity: response
          });
        }
      }
    }
    
    // Sort by response strength and keep top features
    features.sort((a, b) => (b.intensity || 0) - (a.intensity || 0));
    return features.slice(0, Math.min(features.length, 500));
  }

  private static isLocalMaximum(
    data: Float32Array,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ): boolean {
    const centerValue = data[y * width + x];
    
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx === 0 && dy === 0) continue;
        
        const nx = x + dx;
        const ny = y + dy;
        
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          if (data[ny * width + nx] >= centerValue) {
            return false;
          }
        }
      }
    }
    
    return true;
  }

  /**
   * Texture analysis for quality metrics
   */
  private static analyzeTexture(luminance: Float32Array, width: number, height: number): TextureMetrics {
    // Compute texture properties
    let sum = 0, sumSq = 0;
    let entropy = 0;
    const histogram = new Array(256).fill(0);
    
    // Basic statistics
    for (let i = 0; i < luminance.length; i++) {
      const value = luminance[i];
      sum += value;
      sumSq += value * value;
      
      const bin = Math.floor(value * 255);
      histogram[bin]++;
    }
    
    const mean = sum / luminance.length;
    const variance = (sumSq / luminance.length) - (mean * mean);
    const contrast = Math.sqrt(variance);
    
    // Entropy calculation
    for (const count of histogram) {
      if (count > 0) {
        const p = count / luminance.length;
        entropy -= p * Math.log2(p);
      }
    }
    
    // Homogeneity (GLCM-inspired)
    let homogeneity = 0;
    let roughness = 0;
    const step = 5; // Sample every 5th pixel for performance
    
    for (let y = 0; y < height - 1; y += step) {
      for (let x = 0; x < width - 1; x += step) {
        const current = luminance[y * width + x];
        const right = luminance[y * width + (x + 1)];
        const down = luminance[(y + 1) * width + x];
        
        const diffRight = Math.abs(current - right);
        const diffDown = Math.abs(current - down);
        
        homogeneity += 1 / (1 + diffRight + diffDown);
        roughness += diffRight + diffDown;
      }
    }
    
    const totalSamples = Math.floor(width / step) * Math.floor(height / step);
    homogeneity /= totalSamples;
    roughness /= totalSamples;
    
    return {
      contrast,
      entropy,
      homogeneity,
      roughness
    };
  }
}
