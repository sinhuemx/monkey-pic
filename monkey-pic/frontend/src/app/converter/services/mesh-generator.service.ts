import { HeightmapData, TriangleMeshData, ConversionParameters, OptimizationStats } from '../types/converter.types';

/**
 * Advanced mesh generator with adaptive subdivision and compression
 */
export class MeshGenerator {
  
  /**
   * Generate optimized triangle mesh from heightmap
   */
  static generateMesh(
    heightmap: HeightmapData,
    params: ConversionParameters
  ): TriangleMeshData {
    // Calculate real-world dimensions
    const aspectRatio = heightmap.width / heightmap.height;
    const realWidth = params.widthMM;
    const realHeight = params.widthMM / aspectRatio;
    
    // Adaptive subdivision based on complexity
    const subdivision = this.calculateOptimalSubdivision(heightmap, params.sampleMax);
    
    // Generate vertices with adaptive density
    const vertices = this.generateAdaptiveVertices(
      heightmap,
      realWidth,
      realHeight,
      params,
      subdivision
    );
    
    // Generate indices with optimized triangle generation
    const indices = this.generateOptimizedIndices(
      subdivision.width,
      subdivision.height,
      heightmap,
      params
    );
    
    // Calculate compression ratio
    const maxPossibleTriangles = (heightmap.width - 1) * (heightmap.height - 1) * 2;
    const compressionRatio = indices.length / 3 / maxPossibleTriangles;
    
    return {
      vertices,
      indices,
      triangleCount: indices.length / 3,
      compressionRatio
    };
  }

  /**
   * Calculate optimal subdivision based on image complexity
   */
  private static calculateOptimalSubdivision(
    heightmap: HeightmapData,
    maxSamples: number
  ): { width: number; height: number } {
    // Analyze local variance to determine optimal resolution
    const complexity = this.analyzeComplexity(heightmap);
    
    // Calculate target resolution based on complexity and max samples
    const totalPixels = heightmap.width * heightmap.height;
    const complexityFactor = Math.min(complexity * 2, 1); // Scale complexity
    const targetSamples = Math.min(maxSamples * (0.5 + complexityFactor), totalPixels);
    
    const scale = Math.sqrt(targetSamples / totalPixels);
    
    return {
      width: Math.max(8, Math.floor(heightmap.width * scale)),
      height: Math.max(8, Math.floor(heightmap.height * scale))
    };
  }

  /**
   * Analyze image complexity using local variance
   */
  private static analyzeComplexity(heightmap: HeightmapData): number {
    const { data, width, height } = heightmap;
    let totalVariance = 0;
    let sampleCount = 0;
    
    // Sample every 4x4 block for efficiency
    for (let y = 2; y < height - 2; y += 4) {
      for (let x = 2; x < width - 2; x += 4) {
        const variance = this.calculateLocalVariance(data, x, y, width, 2);
        totalVariance += variance;
        sampleCount++;
      }
    }
    
    return sampleCount > 0 ? totalVariance / sampleCount : 0;
  }

  /**
   * Calculate local variance in a neighborhood
   */
  private static calculateLocalVariance(
    data: Float32Array,
    centerX: number,
    centerY: number,
    width: number,
    radius: number = 1
  ): number {
    let sum = 0;
    let sumSquares = 0;
    let count = 0;
    
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = centerX + dx;
        const y = centerY + dy;
        const idx = y * width + x;
        
        if (idx >= 0 && idx < data.length) {
          const value = data[idx];
          sum += value;
          sumSquares += value * value;
          count++;
        }
      }
    }
    
    if (count === 0) return 0;
    
    const mean = sum / count;
    const variance = (sumSquares / count) - (mean * mean);
    return Math.max(0, variance);
  }

  /**
   * Generate vertices with adaptive sampling
   */
  private static generateAdaptiveVertices(
    heightmap: HeightmapData,
    realWidth: number,
    realHeight: number,
    params: ConversionParameters,
    subdivision: { width: number; height: number }
  ): Float32Array {
    const vertices = new Float32Array(subdivision.width * subdivision.height * 3);
    
    // Calculate sampling steps
    const xStep = (heightmap.width - 1) / (subdivision.width - 1);
    const yStep = (heightmap.height - 1) / (subdivision.height - 1);
    
    // Real-world scaling
    const xScale = realWidth / (subdivision.width - 1);
    const yScale = realHeight / (subdivision.height - 1);
    const zScale = params.maxHeightMM / (heightmap.maxHeight - heightmap.minHeight);
    
    let vertexIndex = 0;
    
    for (let y = 0; y < subdivision.height; y++) {
      for (let x = 0; x < subdivision.width; x++) {
        // Bilinear interpolation for sub-pixel sampling
        const sourceX = x * xStep;
        const sourceY = y * yStep;
        const height = this.bilinearInterpolate(
          heightmap.data,
          sourceX,
          sourceY,
          heightmap.width,
          heightmap.height
        );
        
        // Convert to real-world coordinates
        vertices[vertexIndex] = x * xScale; // X
        vertices[vertexIndex + 1] = y * yScale; // Y
        vertices[vertexIndex + 2] = params.baseMM + (height - heightmap.minHeight) * zScale; // Z
        
        vertexIndex += 3;
      }
    }
    
    return vertices;
  }

  /**
   * Bilinear interpolation for smooth height sampling
   */
  private static bilinearInterpolate(
    data: Float32Array,
    x: number,
    y: number,
    width: number,
    height: number
  ): number {
    const x1 = Math.floor(x);
    const x2 = Math.min(x1 + 1, width - 1);
    const y1 = Math.floor(y);
    const y2 = Math.min(y1 + 1, height - 1);
    
    const fx = x - x1;
    const fy = y - y1;
    
    const v11 = data[y1 * width + x1];
    const v12 = data[y2 * width + x1];
    const v21 = data[y1 * width + x2];
    const v22 = data[y2 * width + x2];
    
    const i1 = v11 * (1 - fx) + v21 * fx;
    const i2 = v12 * (1 - fx) + v22 * fx;
    
    return i1 * (1 - fy) + i2 * fy;
  }

  /**
   * Generate optimized triangle indices with adaptive decimation
   */
  private static generateOptimizedIndices(
    width: number,
    height: number,
    heightmap: HeightmapData,
    params: ConversionParameters
  ): Uint32Array {
    const indices: number[] = [];
    
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const tl = y * width + x;       // Top-left
        const tr = y * width + x + 1;   // Top-right
        const bl = (y + 1) * width + x; // Bottom-left
        const br = (y + 1) * width + x + 1; // Bottom-right
        
        // Adaptive triangle generation based on height variance
        const shouldSubdivide = this.shouldSubdivideFace(
          heightmap, x, y, width, height
        );
        
        if (shouldSubdivide) {
          // Generate both triangles for complex areas
          indices.push(tl, bl, tr, tr, bl, br);
        } else {
          // Use single triangle for flat areas (decimation)
          const variance = this.calculateQuadVariance(heightmap, x, y, width, height);
          if (variance < 0.001) {
            // Very flat area - use single triangle
            indices.push(tl, bl, br);
          } else {
            // Normal area - use both triangles
            indices.push(tl, bl, tr, tr, bl, br);
          }
        }
      }
    }
    
    return new Uint32Array(indices);
  }

  /**
   * Determine if a face should be subdivided based on curvature
   */
  private static shouldSubdivideFace(
    heightmap: HeightmapData,
    x: number,
    y: number,
    meshWidth: number,
    meshHeight: number
  ): boolean {
    // Map mesh coordinates back to heightmap coordinates
    const hx = (x / (meshWidth - 1)) * (heightmap.width - 1);
    const hy = (y / (meshHeight - 1)) * (heightmap.height - 1);
    
    const curvature = this.calculateCurvature(heightmap, hx, hy);
    return curvature > 0.05; // Threshold for subdivision
  }

  /**
   * Calculate curvature at a point
   */
  private static calculateCurvature(
    heightmap: HeightmapData,
    x: number,
    y: number
  ): number {
    const { data, width, height } = heightmap;
    
    const x1 = Math.max(0, Math.floor(x) - 1);
    const x2 = Math.min(width - 1, Math.floor(x) + 1);
    const y1 = Math.max(0, Math.floor(y) - 1);
    const y2 = Math.min(height - 1, Math.floor(y) + 1);
    
    const center = data[Math.floor(y) * width + Math.floor(x)];
    const left = data[Math.floor(y) * width + x1];
    const right = data[Math.floor(y) * width + x2];
    const top = data[y1 * width + Math.floor(x)];
    const bottom = data[y2 * width + Math.floor(x)];
    
    // Second derivatives (curvature approximation)
    const curvX = Math.abs(left - 2 * center + right);
    const curvY = Math.abs(top - 2 * center + bottom);
    
    return Math.sqrt(curvX * curvX + curvY * curvY);
  }

  /**
   * Calculate variance in a quad for decimation decisions
   */
  private static calculateQuadVariance(
    heightmap: HeightmapData,
    x: number,
    y: number,
    meshWidth: number,
    meshHeight: number
  ): number {
    // Map to heightmap coordinates
    const hx1 = (x / (meshWidth - 1)) * (heightmap.width - 1);
    const hy1 = (y / (meshHeight - 1)) * (heightmap.height - 1);
    const hx2 = ((x + 1) / (meshWidth - 1)) * (heightmap.width - 1);
    const hy2 = ((y + 1) / (meshHeight - 1)) * (heightmap.height - 1);
    
    const h1 = this.bilinearInterpolate(heightmap.data, hx1, hy1, heightmap.width, heightmap.height);
    const h2 = this.bilinearInterpolate(heightmap.data, hx2, hy1, heightmap.width, heightmap.height);
    const h3 = this.bilinearInterpolate(heightmap.data, hx1, hy2, heightmap.width, heightmap.height);
    const h4 = this.bilinearInterpolate(heightmap.data, hx2, hy2, heightmap.width, heightmap.height);
    
    const mean = (h1 + h2 + h3 + h4) / 4;
    const variance = ((h1 - mean) ** 2 + (h2 - mean) ** 2 + (h3 - mean) ** 2 + (h4 - mean) ** 2) / 4;
    
    return variance;
  }

  /**
   * Optimize mesh using advanced techniques
   */
  static optimizeMesh(mesh: TriangleMeshData): { mesh: TriangleMeshData; stats: OptimizationStats } {
    const originalVertices = mesh.vertices.length / 3;
    const originalTriangles = mesh.triangleCount;
    
    // For now, return the mesh as-is with stats
    // In a real implementation, you would apply:
    // - Vertex welding
    // - Edge collapse
    // - Normal smoothing
    // - Triangle strip generation
    
    const stats: OptimizationStats = {
      originalVertices,
      optimizedVertices: originalVertices,
      originalTriangles,
      optimizedTriangles: originalTriangles,
      vertexReduction: 0,
      triangleReduction: 0
    };
    
    return { mesh, stats };
  }
}
