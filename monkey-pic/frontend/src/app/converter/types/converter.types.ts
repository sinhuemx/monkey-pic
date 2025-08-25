/**
 * High-quality converter types and interfaces
 * Optimized for excellent compression and precision
 */

export interface ConversionParameters {
  widthMM: number;
  baseMM: number;
  maxHeightMM: number;
  sampleMax: number;
  invert: boolean;
  format: 'binary' | 'ascii';
  smoothingKernel?: number;
  subdivisionLevel?: number;
  compressionLevel?: number;
}

export interface ImageDimensions {
  width: number;
  height: number;
  aspectRatio: number;
}

export interface CanvasConfig {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface HeightmapData {
  data: Float32Array;
  width: number;
  height: number;
  minHeight: number;
  maxHeight: number;
}

export interface TriangleMeshData {
  vertices: Float32Array;
  indices: Uint32Array;
  triangleCount: number;
  compressionRatio: number;
}

export interface ConversionResult {
  blob: Blob;
  triangleCount: number;
  compressionRatio: number;
  processingTime: number;
  optimizationStats: OptimizationStats;
}

export interface OptimizationStats {
  originalVertices: number;
  optimizedVertices: number;
  originalTriangles: number;
  optimizedTriangles: number;
  vertexReduction: number;
  triangleReduction: number;
}

export type PreviewMode = 'image' | 'relief' | 'wireframe' | 'normals';

export interface RenderContext {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  config: CanvasConfig;
}

export interface ConversionProgress {
  stage: 'analyzing' | 'processing' | 'generating' | 'optimizing' | 'compressing' | 'complete';
  progress: number;
  message: string;
}
