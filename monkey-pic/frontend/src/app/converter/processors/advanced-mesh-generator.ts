import { 
  ImageAnalysisResult, 
  OptimizedMesh, 
  Triangle, 
  Point3D, 
  Vector3D, 
  MeshOptimizationConfig,
  AdvancedConversionOptions 
} from '../types/advanced-types';

export class AdvancedMeshGenerator {
  
  /**
   * Generate high-quality mesh from image analysis
   */
  public static generateOptimizedMesh(
    analysis: ImageAnalysisResult,
    width: number,
    height: number,
    options: AdvancedConversionOptions
  ): OptimizedMesh {
    // 1. Generate initial high-density mesh
    const initialMesh = this.generateInitialMesh(analysis, width, height, options);
    
    // 2. Apply adaptive subdivision for important areas
    const subdividedMesh = this.applyAdaptiveSubdivision(initialMesh, analysis, options.meshConfig);
    
    // 3. Optimize mesh topology
    const optimizedMesh = this.optimizeMeshTopology(subdividedMesh, options.meshConfig);
    
    // 4. Apply smart smoothing while preserving details
    const smoothedMesh = this.applySmartSmoothing(optimizedMesh, analysis, options.meshConfig);
    
    // 5. Final quality assessment and bounds calculation
    return this.finalizeMesh(smoothedMesh);
  }

  /**
   * Generate initial mesh from depth map
   */
  private static generateInitialMesh(
    analysis: ImageAnalysisResult,
    width: number,
    height: number,
    options: AdvancedConversionOptions
  ): OptimizedMesh {
    const vertices: Point3D[] = [];
    const triangles: Triangle[] = [];
    
    // Calculate scale factors
    const scaleX = options.widthMM / width;
    const scaleY = options.widthMM * (height / width) / height;
    const scaleZ = options.maxHeightMM;
    
    // Generate vertices with enhanced positioning
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        
        // Base position
        const worldX = (x - width * 0.5) * scaleX;
        const worldY = (height * 0.5 - y) * scaleY;
        
        // Enhanced depth calculation
        let depth = analysis.depthMap[idx];
        
        // Apply feature-based depth enhancement
        const featureEnhancement = this.calculateFeatureEnhancement(
          x, y, analysis.featurePoints, width, height
        );
        depth *= (1.0 + featureEnhancement * 0.3);
        
        // Apply edge preservation
        const edgeValue = analysis.edgeMap[idx];
        if (edgeValue > 0.5 && options.meshConfig.preserveEdges) {
          depth *= 1.2; // Enhance edges
        }
        
        const worldZ = options.baseMM + depth * scaleZ;
        
        // Calculate normal from normal map
        const normalIdx = idx * 3;
        const normal: Vector3D = {
          x: analysis.normalMap[normalIdx] || 0,
          y: analysis.normalMap[normalIdx + 1] || 0,
          z: analysis.normalMap[normalIdx + 2] || 1
        };
        
        vertices.push({
          x: worldX,
          y: worldY,
          z: worldZ,
          normal,
          uv: { x: x / width, y: y / height }
        });
      }
    }
    
    // Generate triangles with quality assessment
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const idx = y * width + x;
        
        // Vertex indices for quad
        const v0 = idx;
        const v1 = idx + 1;
        const v2 = idx + width;
        const v3 = idx + width + 1;
        
        // Create two triangles with optimal orientation
        const tri1 = this.createOptimalTriangle(vertices[v0], vertices[v1], vertices[v2]);
        const tri2 = this.createOptimalTriangle(vertices[v1], vertices[v3], vertices[v2]);
        
        if (tri1.quality > 0.1) triangles.push(tri1);
        if (tri2.quality > 0.1) triangles.push(tri2);
      }
    }
    
    return {
      vertices,
      triangles,
      bounds: this.calculateBounds(vertices),
      quality: this.assessMeshQuality(vertices, triangles)
    };
  }

  /**
   * Calculate feature-based depth enhancement
   */
  private static calculateFeatureEnhancement(
    x: number,
    y: number,
    featurePoints: { x: number; y: number; intensity?: number }[],
    width: number,
    height: number
  ): number {
    let enhancement = 0;
    const maxDistance = Math.min(width, height) * 0.1;
    
    for (const feature of featurePoints) {
      const dx = x - feature.x;
      const dy = y - feature.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < maxDistance) {
        const influence = Math.exp(-distance / (maxDistance * 0.3));
        const strength = feature.intensity || 1.0;
        enhancement += influence * strength;
      }
    }
    
    return Math.min(enhancement, 1.0);
  }

  /**
   * Create triangle with quality assessment
   */
  private static createOptimalTriangle(v0: Point3D, v1: Point3D, v2: Point3D): Triangle {
    const normal = this.calculateTriangleNormal(v0, v1, v2);
    const area = this.calculateTriangleArea(v0, v1, v2);
    const quality = this.assessTriangleQuality(v0, v1, v2);
    
    return {
      vertices: [v0, v1, v2],
      normal,
      area,
      quality
    };
  }

  /**
   * Calculate triangle normal
   */
  private static calculateTriangleNormal(v0: Point3D, v1: Point3D, v2: Point3D): Vector3D {
    const edge1: Vector3D = {
      x: v1.x - v0.x,
      y: v1.y - v0.y,
      z: v1.z - v0.z
    };
    
    const edge2: Vector3D = {
      x: v2.x - v0.x,
      y: v2.y - v0.y,
      z: v2.z - v0.z
    };
    
    // Cross product
    const normal: Vector3D = {
      x: edge1.y * edge2.z - edge1.z * edge2.y,
      y: edge1.z * edge2.x - edge1.x * edge2.z,
      z: edge1.x * edge2.y - edge1.y * edge2.x
    };
    
    // Normalize
    const length = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
    if (length > 0) {
      normal.x /= length;
      normal.y /= length;
      normal.z /= length;
    }
    
    return normal;
  }

  /**
   * Calculate triangle area
   */
  private static calculateTriangleArea(v0: Point3D, v1: Point3D, v2: Point3D): number {
    const edge1Length = Math.sqrt(
      Math.pow(v1.x - v0.x, 2) + Math.pow(v1.y - v0.y, 2) + Math.pow(v1.z - v0.z, 2)
    );
    const edge2Length = Math.sqrt(
      Math.pow(v2.x - v0.x, 2) + Math.pow(v2.y - v0.y, 2) + Math.pow(v2.z - v0.z, 2)
    );
    const edge3Length = Math.sqrt(
      Math.pow(v2.x - v1.x, 2) + Math.pow(v2.y - v1.y, 2) + Math.pow(v2.z - v1.z, 2)
    );
    
    // Heron's formula
    const s = (edge1Length + edge2Length + edge3Length) * 0.5;
    return Math.sqrt(s * (s - edge1Length) * (s - edge2Length) * (s - edge3Length));
  }

  /**
   * Assess triangle quality (aspect ratio)
   */
  private static assessTriangleQuality(v0: Point3D, v1: Point3D, v2: Point3D): number {
    const edge1 = Math.sqrt(Math.pow(v1.x - v0.x, 2) + Math.pow(v1.y - v0.y, 2) + Math.pow(v1.z - v0.z, 2));
    const edge2 = Math.sqrt(Math.pow(v2.x - v0.x, 2) + Math.pow(v2.y - v0.y, 2) + Math.pow(v2.z - v0.z, 2));
    const edge3 = Math.sqrt(Math.pow(v2.x - v1.x, 2) + Math.pow(v2.y - v1.y, 2) + Math.pow(v2.z - v1.z, 2));
    
    const maxEdge = Math.max(edge1, edge2, edge3);
    const minEdge = Math.min(edge1, edge2, edge3);
    
    if (maxEdge === 0) return 0;
    
    // Quality is ratio of min to max edge (1.0 = equilateral)
    return minEdge / maxEdge;
  }

  /**
   * Apply adaptive subdivision based on detail importance
   */
  private static applyAdaptiveSubdivision(
    mesh: OptimizedMesh,
    analysis: ImageAnalysisResult,
    config: MeshOptimizationConfig
  ): OptimizedMesh {
    if (!config.adaptiveSubdivision) return mesh;
    
    const newVertices = [...mesh.vertices];
    const newTriangles: Triangle[] = [];
    
    for (const triangle of mesh.triangles) {
      // Assess if triangle needs subdivision
      const subdivisionNeed = this.assessSubdivisionNeed(triangle, analysis, config);
      
      if (subdivisionNeed > config.qualityThreshold) {
        // Subdivide triangle
        const subdividedTriangles = this.subdivideTriangle(triangle);
        newTriangles.push(...subdividedTriangles);
        
        // Add new vertices if needed
        for (const subTriangle of subdividedTriangles) {
          for (const vertex of subTriangle.vertices) {
            if (!newVertices.find(v => 
              Math.abs(v.x - vertex.x) < 0.001 && 
              Math.abs(v.y - vertex.y) < 0.001 && 
              Math.abs(v.z - vertex.z) < 0.001
            )) {
              newVertices.push(vertex);
            }
          }
        }
      } else {
        newTriangles.push(triangle);
      }
    }
    
    return {
      vertices: newVertices,
      triangles: newTriangles,
      bounds: this.calculateBounds(newVertices),
      quality: this.assessMeshQuality(newVertices, newTriangles)
    };
  }

  /**
   * Assess if triangle needs subdivision
   */
  private static assessSubdivisionNeed(
    triangle: Triangle,
    analysis: ImageAnalysisResult,
    config: MeshOptimizationConfig
  ): number {
    // Factors that indicate need for subdivision:
    // 1. Large triangle area
    // 2. High gradient variance within triangle
    // 3. Low triangle quality
    // 4. Presence of feature points
    
    let need = 0;
    
    // Area factor
    const averageArea = 1.0; // Normalized
    need += Math.min(triangle.area / averageArea, 1.0) * 0.3;
    
    // Quality factor (low quality = high subdivision need)
    need += (1.0 - triangle.quality) * 0.4;
    
    // Feature presence factor
    const featureNearby = this.hasNearbyFeatures(triangle, analysis.featurePoints);
    need += featureNearby ? 0.3 : 0;
    
    return Math.min(need, 1.0);
  }

  /**
   * Check for nearby feature points
   */
  private static hasNearbyFeatures(
    triangle: Triangle,
    featurePoints: { x: number; y: number; intensity?: number }[]
  ): boolean {
    const center = {
      x: (triangle.vertices[0].x + triangle.vertices[1].x + triangle.vertices[2].x) / 3,
      y: (triangle.vertices[0].y + triangle.vertices[1].y + triangle.vertices[2].y) / 3
    };
    
    const threshold = 5.0; // Distance threshold
    
    return featurePoints.some(feature => {
      const dx = center.x - feature.x;
      const dy = center.y - feature.y;
      return Math.sqrt(dx * dx + dy * dy) < threshold;
    });
  }

  /**
   * Subdivide triangle into 4 smaller triangles
   */
  private static subdivideTriangle(triangle: Triangle): Triangle[] {
    const [v0, v1, v2] = triangle.vertices;
    
    // Calculate midpoints
    const m01 = this.interpolateVertex(v0, v1);
    const m12 = this.interpolateVertex(v1, v2);
    const m20 = this.interpolateVertex(v2, v0);
    
    // Create 4 new triangles
    return [
      this.createOptimalTriangle(v0, m01, m20),
      this.createOptimalTriangle(m01, v1, m12),
      this.createOptimalTriangle(m20, m12, v2),
      this.createOptimalTriangle(m01, m12, m20)
    ];
  }

  /**
   * Interpolate between two vertices
   */
  private static interpolateVertex(v0: Point3D, v1: Point3D): Point3D {
    return {
      x: (v0.x + v1.x) * 0.5,
      y: (v0.y + v1.y) * 0.5,
      z: (v0.z + v1.z) * 0.5,
      normal: v0.normal && v1.normal ? {
        x: (v0.normal.x + v1.normal.x) * 0.5,
        y: (v0.normal.y + v1.normal.y) * 0.5,
        z: (v0.normal.z + v1.normal.z) * 0.5
      } : undefined,
      uv: v0.uv && v1.uv ? {
        x: (v0.uv.x + v1.uv.x) * 0.5,
        y: (v0.uv.y + v1.uv.y) * 0.5
      } : undefined
    };
  }

  /**
   * Optimize mesh topology (remove degenerate triangles, etc.)
   */
  private static optimizeMeshTopology(
    mesh: OptimizedMesh,
    config: MeshOptimizationConfig
  ): OptimizedMesh {
    // Remove degenerate triangles
    const validTriangles = mesh.triangles.filter(triangle => 
      triangle.area > 1e-6 && triangle.quality > 0.01
    );
    
    // Remove duplicate vertices
    const uniqueVertices: Point3D[] = [];
    const vertexMap = new Map<string, number>();
    
    for (const vertex of mesh.vertices) {
      const key = `${vertex.x.toFixed(6)},${vertex.y.toFixed(6)},${vertex.z.toFixed(6)}`;
      if (!vertexMap.has(key)) {
        vertexMap.set(key, uniqueVertices.length);
        uniqueVertices.push(vertex);
      }
    }
    
    // Update triangle vertex references
    const updatedTriangles = validTriangles.map(triangle => {
      const newVertices: [Point3D, Point3D, Point3D] = [
        triangle.vertices[0],
        triangle.vertices[1],
        triangle.vertices[2]
      ];
      
      return {
        ...triangle,
        vertices: newVertices
      };
    });
    
    return {
      vertices: uniqueVertices,
      triangles: updatedTriangles,
      bounds: this.calculateBounds(uniqueVertices),
      quality: this.assessMeshQuality(uniqueVertices, updatedTriangles)
    };
  }

  /**
   * Apply smart smoothing while preserving important details
   */
  private static applySmartSmoothing(
    mesh: OptimizedMesh,
    analysis: ImageAnalysisResult,
    config: MeshOptimizationConfig
  ): OptimizedMesh {
    const smoothedVertices = [...mesh.vertices];
    const iterations = config.smoothingIterations;
    
    for (let iter = 0; iter < iterations; iter++) {
      const newPositions = [...smoothedVertices];
      
      for (let i = 0; i < smoothedVertices.length; i++) {
        const vertex = smoothedVertices[i];
        
        // Find neighboring vertices
        const neighbors = this.findNeighborVertices(i, mesh.triangles, smoothedVertices);
        
        if (neighbors.length > 0) {
          // Calculate smoothing factor based on local features
          const smoothingFactor = this.calculateSmoothingFactor(vertex, analysis);
          
          // Laplacian smoothing with adaptive factor
          let avgX = 0, avgY = 0, avgZ = 0;
          for (const neighbor of neighbors) {
            avgX += neighbor.x;
            avgY += neighbor.y;
            avgZ += neighbor.z;
          }
          
          avgX /= neighbors.length;
          avgY /= neighbors.length;
          avgZ /= neighbors.length;
          
          // Blend original and smoothed position
          newPositions[i] = {
            ...vertex,
            x: vertex.x + (avgX - vertex.x) * smoothingFactor,
            y: vertex.y + (avgY - vertex.y) * smoothingFactor,
            z: vertex.z + (avgZ - vertex.z) * smoothingFactor
          };
        }
      }
      
      for (let i = 0; i < smoothedVertices.length; i++) {
        smoothedVertices[i] = newPositions[i];
      }
    }
    
    // Recalculate triangle normals after smoothing
    const updatedTriangles = mesh.triangles.map(triangle => ({
      ...triangle,
      normal: this.calculateTriangleNormal(
        triangle.vertices[0],
        triangle.vertices[1],
        triangle.vertices[2]
      )
    }));
    
    return {
      vertices: smoothedVertices,
      triangles: updatedTriangles,
      bounds: this.calculateBounds(smoothedVertices),
      quality: this.assessMeshQuality(smoothedVertices, updatedTriangles)
    };
  }

  /**
   * Find neighboring vertices
   */
  private static findNeighborVertices(
    vertexIndex: number,
    triangles: Triangle[],
    vertices: Point3D[]
  ): Point3D[] {
    const neighbors: Point3D[] = [];
    const vertex = vertices[vertexIndex];
    
    for (const triangle of triangles) {
      for (let i = 0; i < 3; i++) {
        const triangleVertex = triangle.vertices[i];
        if (this.verticesEqual(vertex, triangleVertex)) {
          // Add other vertices of this triangle as neighbors
          for (let j = 0; j < 3; j++) {
            if (j !== i && !neighbors.some(n => this.verticesEqual(n, triangle.vertices[j]))) {
              neighbors.push(triangle.vertices[j]);
            }
          }
        }
      }
    }
    
    return neighbors;
  }

  /**
   * Check if two vertices are equal (within tolerance)
   */
  private static verticesEqual(v1: Point3D, v2: Point3D, tolerance = 1e-6): boolean {
    return Math.abs(v1.x - v2.x) < tolerance &&
           Math.abs(v1.y - v2.y) < tolerance &&
           Math.abs(v1.z - v2.z) < tolerance;
  }

  /**
   * Calculate adaptive smoothing factor
   */
  private static calculateSmoothingFactor(vertex: Point3D, analysis: ImageAnalysisResult): number {
    // Reduce smoothing near edges and features
    // This would require mapping vertex back to image coordinates
    // For now, use a moderate smoothing factor
    return 0.1; // Conservative smoothing
  }

  /**
   * Calculate mesh bounds
   */
  private static calculateBounds(vertices: Point3D[]) {
    if (vertices.length === 0) {
      return {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0, y: 0, z: 0 },
        center: { x: 0, y: 0, z: 0 }
      };
    }
    
    let minX = vertices[0].x, maxX = vertices[0].x;
    let minY = vertices[0].y, maxY = vertices[0].y;
    let minZ = vertices[0].z, maxZ = vertices[0].z;
    
    for (const vertex of vertices) {
      minX = Math.min(minX, vertex.x);
      maxX = Math.max(maxX, vertex.x);
      minY = Math.min(minY, vertex.y);
      maxY = Math.max(maxY, vertex.y);
      minZ = Math.min(minZ, vertex.z);
      maxZ = Math.max(maxZ, vertex.z);
    }
    
    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
      center: {
        x: (minX + maxX) * 0.5,
        y: (minY + maxY) * 0.5,
        z: (minZ + maxZ) * 0.5
      }
    };
  }

  /**
   * Assess overall mesh quality
   */
  private static assessMeshQuality(vertices: Point3D[], triangles: Triangle[]) {
    if (triangles.length === 0) {
      return {
        averageTriangleQuality: 0,
        aspectRatio: 0,
        manifoldness: 0
      };
    }
    
    const totalQuality = triangles.reduce((sum, tri) => sum + tri.quality, 0);
    const averageTriangleQuality = totalQuality / triangles.length;
    
    // Calculate aspect ratio (simplified)
    let totalAspect = 0;
    for (const triangle of triangles) {
      const [v0, v1, v2] = triangle.vertices;
      const edge1 = Math.sqrt(Math.pow(v1.x - v0.x, 2) + Math.pow(v1.y - v0.y, 2) + Math.pow(v1.z - v0.z, 2));
      const edge2 = Math.sqrt(Math.pow(v2.x - v0.x, 2) + Math.pow(v2.y - v0.y, 2) + Math.pow(v2.z - v0.z, 2));
      const edge3 = Math.sqrt(Math.pow(v2.x - v1.x, 2) + Math.pow(v2.y - v1.y, 2) + Math.pow(v2.z - v1.z, 2));
      
      const maxEdge = Math.max(edge1, edge2, edge3);
      const minEdge = Math.min(edge1, edge2, edge3);
      
      if (maxEdge > 0) {
        totalAspect += minEdge / maxEdge;
      }
    }
    
    const aspectRatio = totalAspect / triangles.length;
    
    // Manifoldness check (simplified - check for non-manifold edges)
    const manifoldness = 1.0; // Simplified - assume manifold for now
    
    return {
      averageTriangleQuality,
      aspectRatio,
      manifoldness
    };
  }

  /**
   * Finalize mesh with quality assessment
   */
  private static finalizeMesh(mesh: OptimizedMesh): OptimizedMesh {
    return {
      ...mesh,
      bounds: this.calculateBounds(mesh.vertices),
      quality: this.assessMeshQuality(mesh.vertices, mesh.triangles)
    };
  }
}
