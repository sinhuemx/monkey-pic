// Advanced types for high-quality 3D conversion

export interface DepthEstimationConfig {
  method: 'gradient-based' | 'ai-based' | 'hybrid';
  edgeThreshold: number;
  smoothingKernel: number;
  depthLayers: number;
  normalEstimation: boolean;
}

export interface MeshOptimizationConfig {
  decimationRatio: number;
  preserveEdges: boolean;
  smoothingIterations: number;
  adaptiveSubdivision: boolean;
  qualityThreshold: number;
}

export interface PhotogrammetryConfig {
  multiScaleAnalysis: boolean;
  featureDetection: 'SIFT' | 'ORB' | 'AKAZE';
  stereoMatching: boolean;
  structureFromMotion: boolean;
}

export interface AdvancedConversionOptions {
  // Core parameters
  widthMM: number;
  baseMM: number;
  maxHeightMM: number;
  
  // Quality settings
  sampleMax: number;
  resolution: 'low' | 'medium' | 'high' | 'ultra';
  
  // Mesh quality parameters
  vertices: number;
  faces: number;
  voxelResolution: number;
  
  // Advanced depth estimation
  depthConfig: DepthEstimationConfig;
  
  // Mesh optimization
  meshConfig: MeshOptimizationConfig;
  
  // Photogrammetry-inspired techniques
  photoConfig: PhotogrammetryConfig;
  
  // Post-processing
  invert: boolean;
  format: 'binary' | 'ascii';
  compression: 'none' | 'low' | 'medium' | 'high';
  
  // Enhanced volume and texture options
  volumeEnhancement?: {
    enabled: boolean;
    depthMultiplier: number;
    gradientBoost: number;
    contrastCurve: number;
  };
  
  textureEnhancement?: {
    enabled: boolean;
    detailPreservation: number;
    edgeSharpening: number;
    surfaceSmoothing: number;
    microTexture: boolean;
  };
  
  advancedGeometry?: {
    adaptiveSubdivision: boolean;
    organicShaping: boolean;
    overhangsSupport: boolean;
  };
  
  // AI-inspired enhancement
  enhanceEdges: boolean;
  preserveDetails: boolean;
  smartSmoothing: boolean;
}

export interface ImageAnalysisResult {
  luminanceMap: Float32Array;
  gradientMap: Float32Array;
  edgeMap: Float32Array;
  depthMap: Float32Array;
  normalMap: Float32Array;
  featurePoints: Point2D[];
  textureMetrics: TextureMetrics;
}

export interface Point2D {
  x: number;
  y: number;
  intensity?: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
  normal?: Vector3D;
  uv?: Point2D;
}

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface TextureMetrics {
  contrast: number;
  entropy: number;
  homogeneity: number;
  roughness: number;
}

export interface Triangle {
  vertices: [Point3D, Point3D, Point3D];
  normal: Vector3D;
  area: number;
  quality: number;
}

export interface OptimizedMesh {
  vertices: Point3D[];
  triangles: Triangle[];
  bounds: {
    min: Point3D;
    max: Point3D;
    center: Point3D;
  };
  quality: {
    averageTriangleQuality: number;
    aspectRatio: number;
    manifoldness: number;
  };
}

export interface ConversionMetrics {
  processingTime: number;
  memoryUsage: number;
  triangleCount: number;
  vertexCount: number;
  compressionRatio: number;
  qualityScore: number;
}
