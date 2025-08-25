import { Injectable } from '@angular/core';
import { 
  AdvancedConversionOptions, 
  ConversionMetrics,
  ImageAnalysisResult,
  OptimizedMesh
} from '../types/advanced-types';
import { AdvancedImageProcessor } from '../processors/advanced-image-processor';
import { AdvancedMeshGenerator } from '../processors/advanced-mesh-generator';
import { AdvancedSTLGenerator } from '../processors/advanced-stl-generator';

@Injectable({
  providedIn: 'root'
})
export class AdvancedConverterService {
  
  /**
   * Convert image to optimized STL with advanced algorithms
   */
  public async convertImageToSTL(
    imageFile: File,
    options: AdvancedConversionOptions
  ): Promise<{
    blob: Blob;
    metrics: ConversionMetrics;
    preview: ImageData;
    analysis: ImageAnalysisResult;
    mesh: OptimizedMesh;
  }> {
    try {
      // 1. Load and prepare image
      if (typeof window === 'undefined') {
        throw new Error('Image conversion is only available in the browser');
      }
      const imageBitmap = await createImageBitmap(imageFile);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      
      // Set canvas size based on resolution setting
      const resolution = this.getResolutionMultiplier(options.resolution);
      canvas.width = Math.floor(imageBitmap.width * resolution);
      canvas.height = Math.floor(imageBitmap.height * resolution);
      
      // Draw with high quality scaling
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // 2. Advanced image analysis
      const analysis = AdvancedImageProcessor.analyzeImage(
        imageData,
        options.depthConfig,
        options.photoConfig
      );
      
      // 3. Generate optimized mesh
      const mesh = AdvancedMeshGenerator.generateOptimizedMesh(
        analysis,
        canvas.width,
        canvas.height,
        options
      );
      
      // 4. Generate STL with compression
      const stlResult = AdvancedSTLGenerator.generateOptimizedSTL(
        mesh,
        options.format,
        options.compression
      );
      
      // 5. Generate preview for display
      const preview = this.generateAdvancedPreview(
        analysis,
        canvas.width,
        canvas.height,
        options.invert
      );
      
      // Cleanup
      imageBitmap.close();
      
      return {
        blob: stlResult.blob,
        metrics: stlResult.metrics,
        preview,
        analysis,
        mesh
      };
      
    } catch (error) {
      console.error('Advanced conversion failed:', error);
      throw new Error(`Conversion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get default advanced options with smart defaults
   */
  public getDefaultOptions(): AdvancedConversionOptions {
    return {
      // Core parameters with optimal quality settings
      widthMM: 150,          // Increased for better detail capture
      baseMM: 3.0,           // More stable base for printing
      maxHeightMM: 25.0,     // Better depth range for relief detail
      
      // Quality settings optimized for excellence
      sampleMax: 400,        // Higher sampling for quality
      resolution: 'ultra',   // Maximum resolution by default
      
      // Mesh quality parameters
      vertices: 25000,       // High-quality vertex count
      faces: 50000,          // Detailed face count
      voxelResolution: 512,  // High voxel resolution for smooth surfaces
      
      // Advanced depth estimation with optimal settings
      depthConfig: {
        method: 'hybrid',
        edgeThreshold: 0.2,     // More sensitive edge detection
        smoothingKernel: 7,     // Better smoothing
        depthLayers: 12,        // More depth layers for detail
        normalEstimation: true
      },
      
      // Mesh optimization with quality focus
      meshConfig: {
        decimationRatio: 0.9,      // Less aggressive decimation
        preserveEdges: true,
        smoothingIterations: 5,     // More smoothing iterations
        adaptiveSubdivision: true,
        qualityThreshold: 0.6       // Higher quality threshold
      },
      
      // Photogrammetry-inspired techniques
      photoConfig: {
        multiScaleAnalysis: true,
        featureDetection: 'SIFT',
        stereoMatching: false,
        structureFromMotion: false
      },
      
      // Post-processing with optimal settings
      invert: false,
      format: 'binary',
      compression: 'low',        // Less compression for quality
      
      // AI-inspired enhancement - all enabled for quality
      enhanceEdges: true,
      preserveDetails: true,
      smartSmoothing: true,
      
      // Volume enhancement with optimal defaults
      volumeEnhancement: {
        enabled: true,
        depthMultiplier: 1.5,      // Increased for better relief
        gradientBoost: 1.3,        // Enhanced gradient response
        contrastCurve: 0.8         // Better contrast definition
      },
      
      // Texture enhancement with quality settings
      textureEnhancement: {
        enabled: true,
        detailPreservation: 0.6,   // Higher detail preservation
        edgeSharpening: 0.4,       // More edge definition
        surfaceSmoothing: 0.12,    // Refined smoothing
        microTexture: true
      },
      
      // Advanced geometry with all features enabled
      advancedGeometry: {
        adaptiveSubdivision: true,
        organicShaping: true,
        overhangsSupport: true
      }
    };
  }

  /**
   * Get resolution multiplier based on quality setting
   */
  private getResolutionMultiplier(resolution: 'low' | 'medium' | 'high' | 'ultra'): number {
    switch (resolution) {
      case 'low': return 0.5;
      case 'medium': return 0.75;
      case 'high': return 1.0;
      case 'ultra': return 1.5;
      default: return 1.0;
    }
  }

  /**
   * Generate advanced preview with enhanced visualization
   */
  private generateAdvancedPreview(
    analysis: ImageAnalysisResult,
    width: number,
    height: number,
    invert: boolean
  ): ImageData {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = width;
    canvas.height = height;
    
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;
    
    // Enhanced preview combining multiple visualization modes
    for (let i = 0; i < width * height; i++) {
      const depth = analysis.depthMap[i];
      const edge = analysis.edgeMap[i];
      const gradient = analysis.gradientMap[i];
      
      // Combine depth, edges, and gradients for better visualization
      let value = depth;
      
      // Enhance edges
      if (edge > 0.5) {
        value = Math.min(value + 0.3, 1.0);
      }
      
      // Add gradient information for surface detail
      value = Math.min(value + gradient * 0.1, 1.0);
      
      // Apply inversion if requested
      if (invert) {
        value = 1.0 - value;
      }
      
      // Convert to RGB with enhanced contrast
      const intensity = Math.pow(value, 0.8); // Gamma correction for better visualization
      const rgb = Math.floor(intensity * 255);
      
      const pixelIndex = i * 4;
      data[pixelIndex] = rgb;     // R
      data[pixelIndex + 1] = rgb; // G
      data[pixelIndex + 2] = rgb; // B
      data[pixelIndex + 3] = 255; // A
    }
    
    return imageData;
  }

  /**
   * Estimate triangle count based on options
   */
  public estimateTriangleCount(
    width: number,
    height: number,
    options: AdvancedConversionOptions
  ): number {
    const resolution = this.getResolutionMultiplier(options.resolution);
    const effectiveWidth = Math.floor(width * resolution);
    const effectiveHeight = Math.floor(height * resolution);
    
    // Base triangle count (2 triangles per pixel quad)
    let baseCount = (effectiveWidth - 1) * (effectiveHeight - 1) * 2;
    
    // Apply subdivision factor
    if (options.meshConfig.adaptiveSubdivision) {
      baseCount *= 1.5; // Average subdivision increase
    }
    
    // Apply decimation
    baseCount *= options.meshConfig.decimationRatio;
    
    // Apply compression
    const compressionFactors = {
      none: 1.0,
      low: 0.9,
      medium: 0.7,
      high: 0.5
    };
    
    baseCount *= compressionFactors[options.compression];
    
    return Math.floor(baseCount);
  }

  /**
   * Analyze image complexity for optimization suggestions
   */
  public analyzeImageComplexity(imageFile: File): Promise<{
    complexity: 'low' | 'medium' | 'high' | 'ultra';
    suggestedOptions: Partial<AdvancedConversionOptions>;
    warnings: string[];
  }> {
    return new Promise((resolve) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      
      img.onload = () => {
        canvas.width = Math.min(img.width, 512); // Sample at reasonable resolution
        canvas.height = Math.min(img.height, 512);
        
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        // Analyze complexity metrics
        const metrics = this.calculateComplexityMetrics(imageData);
        
        let complexity: 'low' | 'medium' | 'high' | 'ultra';
        let suggestedOptions: Partial<AdvancedConversionOptions> = {};
        const warnings: string[] = [];
        
        // Determine complexity and suggestions
        if (metrics.edgeComplexity < 0.1 && metrics.textureVariance < 0.05) {
          complexity = 'low';
          suggestedOptions = {
            resolution: 'medium',
            compression: 'medium',
            meshConfig: {
              decimationRatio: 0.6,
              preserveEdges: false,
              smoothingIterations: 5,
              adaptiveSubdivision: false,
              qualityThreshold: 0.3
            }
          };
        } else if (metrics.edgeComplexity < 0.3 && metrics.textureVariance < 0.15) {
          complexity = 'medium';
          suggestedOptions = {
            resolution: 'high',
            compression: 'medium',
            meshConfig: {
              decimationRatio: 0.7,
              preserveEdges: true,
              smoothingIterations: 3,
              adaptiveSubdivision: true,
              qualityThreshold: 0.4
            }
          };
        } else if (metrics.edgeComplexity < 0.6 && metrics.textureVariance < 0.3) {
          complexity = 'high';
          suggestedOptions = {
            resolution: 'high',
            compression: 'low',
            meshConfig: {
              decimationRatio: 0.8,
              preserveEdges: true,
              smoothingIterations: 2,
              adaptiveSubdivision: true,
              qualityThreshold: 0.5
            }
          };
        } else {
          complexity = 'ultra';
          suggestedOptions = {
            resolution: 'ultra',
            compression: 'none',
            meshConfig: {
              decimationRatio: 0.9,
              preserveEdges: true,
              smoothingIterations: 1,
              adaptiveSubdivision: true,
              qualityThreshold: 0.6
            }
          };
          warnings.push('Very complex image detected. Processing may take longer and result in large files.');
        }
        
        // Additional warnings
        if (canvas.width < 200 || canvas.height < 200) {
          warnings.push('Image resolution is low. Consider using a higher resolution image for better results.');
        }
        
        if (metrics.contrast < 0.1) {
          warnings.push('Low contrast detected. The 3D result may lack detail.');
        }
        
        URL.revokeObjectURL(img.src);
        resolve({ complexity, suggestedOptions, warnings });
      };
      
      img.src = URL.createObjectURL(imageFile);
    });
  }

  /**
   * Calculate image complexity metrics
   */
  private calculateComplexityMetrics(imageData: ImageData): {
    edgeComplexity: number;
    textureVariance: number;
    contrast: number;
  } {
    const { width, height, data } = imageData;
    
    // Convert to luminance
    const luminance = new Float32Array(width * height);
    for (let i = 0; i < luminance.length; i++) {
      const idx = i * 4;
      const r = data[idx] / 255;
      const g = data[idx + 1] / 255;
      const b = data[idx + 2] / 255;
      luminance[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    
    // Calculate edge complexity (Sobel gradient magnitude)
    let edgeSum = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const gx = 
          -luminance[(y-1)*width + (x-1)] + luminance[(y-1)*width + (x+1)] +
          -2*luminance[y*width + (x-1)] + 2*luminance[y*width + (x+1)] +
          -luminance[(y+1)*width + (x-1)] + luminance[(y+1)*width + (x+1)];
        
        const gy = 
          -luminance[(y-1)*width + (x-1)] - 2*luminance[(y-1)*width + x] - luminance[(y-1)*width + (x+1)] +
          luminance[(y+1)*width + (x-1)] + 2*luminance[(y+1)*width + x] + luminance[(y+1)*width + (x+1)];
        
        edgeSum += Math.sqrt(gx*gx + gy*gy);
      }
    }
    const edgeComplexity = edgeSum / ((width-2) * (height-2));
    
    // Calculate texture variance
    let sum = 0, sumSq = 0;
    for (const value of luminance) {
      sum += value;
      sumSq += value * value;
    }
    const mean = sum / luminance.length;
    const textureVariance = (sumSq / luminance.length) - (mean * mean);
    
    // Calculate contrast
    let min = luminance[0], max = luminance[0];
    for (const value of luminance) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    const contrast = max - min;
    
    return { edgeComplexity, textureVariance, contrast };
  }

  /**
   * Validate conversion options
   */
  public validateOptions(options: AdvancedConversionOptions): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Validate dimensions
    if (options.widthMM <= 0) {
      errors.push('Width must be greater than 0');
    }
    if (options.baseMM < 0) {
      errors.push('Base thickness cannot be negative');
    }
    if (options.maxHeightMM <= 0) {
      errors.push('Maximum height must be greater than 0');
    }
    
    // Validate quality settings
    if (options.sampleMax < 10) {
      errors.push('Sample count too low (minimum 10)');
    } else if (options.sampleMax > 1000) {
      warnings.push('Very high sample count may cause long processing times');
    }
    
    // Validate mesh settings
    if (options.meshConfig.decimationRatio < 0.1 || options.meshConfig.decimationRatio > 1.0) {
      errors.push('Decimation ratio must be between 0.1 and 1.0');
    }
    
    if (options.meshConfig.smoothingIterations < 0) {
      errors.push('Smoothing iterations cannot be negative');
    } else if (options.meshConfig.smoothingIterations > 10) {
      warnings.push('High smoothing iterations may over-smooth details');
    }
    
    // Validate depth estimation settings
    if (options.depthConfig.edgeThreshold < 0 || options.depthConfig.edgeThreshold > 1) {
      errors.push('Edge threshold must be between 0 and 1');
    }
    
    if (options.depthConfig.smoothingKernel < 1 || options.depthConfig.smoothingKernel > 15) {
      errors.push('Smoothing kernel size must be between 1 and 15');
    }
    
    // Performance warnings
    if (options.resolution === 'ultra' && options.compression === 'none') {
      warnings.push('Ultra resolution with no compression may result in very large files');
    }
    
    if (options.meshConfig.adaptiveSubdivision && options.meshConfig.decimationRatio > 0.8) {
      warnings.push('Adaptive subdivision with low decimation may create very dense meshes');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
}
