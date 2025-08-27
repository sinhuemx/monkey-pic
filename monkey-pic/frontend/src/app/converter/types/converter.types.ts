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

export type ImageEditOps = {
  crop?: { x: number; y: number; w: number; h: number } | null;
  scalePct?: number;     // 10–300
  denoise?: number;      // 0–1
  sharpen?: number;      // 0–1
  brightness?: number;   // -1..+1
  contrast?: number;     // -1..+1
};

export type ReliefParams = {
  widthMM: number; baseMM: number; maxHeightMM: number;    // dimensiones
  subdivision: 1|2|3|4;
  depthMultiplier: number;                                 // 0.5–3
  surfaceSmoothing: number;                                // 0–1
  qualitySamples: number;                                  // 50–600
  smoothingKernel: 1|3|5|7|9;                              // 1,3,5,7,9
  format: 'binary'|'ascii';
};

export type Model3DParams = {
  widthMM: number; baseMM: number; maxHeightMM: number;
  wireframe?: boolean; flatShading?: boolean;
  targetFaces?: number;                                     // ej. 300k–600k
  manifold: true;
  prompt: string;
  format?: 'binary'|'ascii';
  invert?: boolean;                                        // Para invertir la altura del modelo
  
  // Parámetros de procesamiento detallado
  depthMultiplier?: number;                                // Multiplicador de profundidad
  surfaceSmoothing?: number;                               // Factor de suavizado de superficie
  qualityThreshold?: number;                               // Umbral de calidad
  smoothingKernel?: number;                                // Tamaño del kernel de suavizado
  subdivisionLevel?: number;                               // Nivel de subdivisión
  
  // Nuevos parámetros para calidad profesional
  qualityMode?: 'standard' | 'professional';              // Modo de calidad
  taubinIterations?: number;                               // 5-20 iteraciones de suavizado Taubin
  creaseAngle?: number;                                    // 30-60° para preservar aristas
  enableAdvancedSmoothing?: boolean;                       // Activar suavizado avanzado
  enableQuadricDecimation?: boolean;                       // Activar decimación inteligente
  resolution?: number;                                     // 512, 1024 para resolución de generación
  enableMultiview?: boolean;                               // Consistencia multivista
  enableConsistency?: boolean;                             // Activar validaciones de consistencia
};

export type MeshStats = { faces: number; verts: number; volumeCM3?: number };
