import { TriangleMeshData, ConversionParameters } from '../types/converter.types';

/**
 * High-performance STL generator with optimal compression
 */
export class STLGenerator {
  
  /**
   * Generate binary STL with maximum compression
   */
  static generateBinarySTL(
    mesh: TriangleMeshData,
    params: ConversionParameters,
    fileName: string = 'model'
  ): Blob {
    const triangleCount = mesh.triangleCount;
    
    // Binary STL format:
    // 80 bytes header + 4 bytes triangle count + (triangles * 50 bytes each)
    const headerSize = 80;
    const countSize = 4;
    const triangleSize = 50; // 12 floats (3*4 bytes) + 2 bytes attribute
    const totalSize = headerSize + countSize + (triangleCount * triangleSize);
    
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const float32View = new Float32Array(buffer, headerSize + countSize);
    
    // Write header (80 bytes)
    const header = `MonkeyPic STL - ${fileName} - ${triangleCount} triangles - Compression: ${(mesh.compressionRatio * 100).toFixed(1)}%`;
    const encoder = new TextEncoder();
    const headerBytes = encoder.encode(header);
    const headerArray = new Uint8Array(buffer, 0, headerSize);
    headerArray.set(headerBytes.slice(0, Math.min(headerBytes.length, headerSize)));
    
    // Write triangle count (little-endian)
    view.setUint32(headerSize, triangleCount, true);
    
    // Write triangles with optimized normal calculation
    let bufferIndex = 0;
    
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const i1 = mesh.indices[i] * 3;
      const i2 = mesh.indices[i + 1] * 3;
      const i3 = mesh.indices[i + 2] * 3;
      
      // Vertices
      const v1 = [mesh.vertices[i1], mesh.vertices[i1 + 1], mesh.vertices[i1 + 2]];
      const v2 = [mesh.vertices[i2], mesh.vertices[i2 + 1], mesh.vertices[i2 + 2]];
      const v3 = [mesh.vertices[i3], mesh.vertices[i3 + 1], mesh.vertices[i3 + 2]];
      
      // Calculate normal using cross product
      const edge1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
      const edge2 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]];
      
      const normal = [
        edge1[1] * edge2[2] - edge1[2] * edge2[1],
        edge1[2] * edge2[0] - edge1[0] * edge2[2],
        edge1[0] * edge2[1] - edge1[1] * edge2[0]
      ];
      
      // Normalize
      const length = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
      if (length > 0) {
        normal[0] /= length;
        normal[1] /= length;
        normal[2] /= length;
      }
      
      // Write normal (3 floats)
      float32View[bufferIndex++] = normal[0];
      float32View[bufferIndex++] = normal[1];
      float32View[bufferIndex++] = normal[2];
      
      // Write vertices (9 floats)
      float32View[bufferIndex++] = v1[0];
      float32View[bufferIndex++] = v1[1];
      float32View[bufferIndex++] = v1[2];
      
      float32View[bufferIndex++] = v2[0];
      float32View[bufferIndex++] = v2[1];
      float32View[bufferIndex++] = v2[2];
      
      float32View[bufferIndex++] = v3[0];
      float32View[bufferIndex++] = v3[1];
      float32View[bufferIndex++] = v3[2];
      
      // Skip attribute bytes (already zeroed)
      bufferIndex += 0.5; // Account for 2 bytes as 0.5 float positions
    }
    
    return new Blob([buffer], { type: 'application/octet-stream' });
  }

  /**
   * Generate ASCII STL (less compressed but human-readable)
   */
  static generateAsciiSTL(
    mesh: TriangleMeshData,
    params: ConversionParameters,
    fileName: string = 'model'
  ): Blob {
    const lines: string[] = [];
    lines.push(`solid ${fileName}_MonkeyPic`);
    
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const i1 = mesh.indices[i] * 3;
      const i2 = mesh.indices[i + 1] * 3;
      const i3 = mesh.indices[i + 2] * 3;
      
      // Vertices
      const v1 = [mesh.vertices[i1], mesh.vertices[i1 + 1], mesh.vertices[i1 + 2]];
      const v2 = [mesh.vertices[i2], mesh.vertices[i2 + 1], mesh.vertices[i2 + 2]];
      const v3 = [mesh.vertices[i3], mesh.vertices[i3 + 1], mesh.vertices[i3 + 2]];
      
      // Calculate normal
      const edge1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
      const edge2 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]];
      
      const normal = [
        edge1[1] * edge2[2] - edge1[2] * edge2[1],
        edge1[2] * edge2[0] - edge1[0] * edge2[2],
        edge1[0] * edge2[1] - edge1[1] * edge2[0]
      ];
      
      // Normalize
      const length = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
      if (length > 0) {
        normal[0] /= length;
        normal[1] /= length;
        normal[2] /= length;
      }
      
      lines.push(`  facet normal ${this.formatFloat(normal[0])} ${this.formatFloat(normal[1])} ${this.formatFloat(normal[2])}`);
      lines.push('    outer loop');
      lines.push(`      vertex ${this.formatFloat(v1[0])} ${this.formatFloat(v1[1])} ${this.formatFloat(v1[2])}`);
      lines.push(`      vertex ${this.formatFloat(v2[0])} ${this.formatFloat(v2[1])} ${this.formatFloat(v2[2])}`);
      lines.push(`      vertex ${this.formatFloat(v3[0])} ${this.formatFloat(v3[1])} ${this.formatFloat(v3[2])}`);
      lines.push('    endloop');
      lines.push('  endfacet');
    }
    
    lines.push(`endsolid ${fileName}_MonkeyPic`);
    
    const content = lines.join('\n');
    return new Blob([content], { type: 'text/plain' });
  }

  /**
   * Format float with optimal precision for STL
   */
  private static formatFloat(value: number): string {
    // Use 6 decimal places for good precision without excessive file size
    return value.toFixed(6);
  }

  /**
   * Generate STL with automatic format selection based on size
   */
  static generateOptimalSTL(
    mesh: TriangleMeshData,
    params: ConversionParameters,
    fileName: string = 'model'
  ): { blob: Blob; format: 'binary' | 'ascii'; estimatedSize: number } {
    const triangleCount = mesh.triangleCount;
    
    // Estimate sizes
    const binarySize = 80 + 4 + (triangleCount * 50); // Binary STL size
    const asciiSize = triangleCount * 200; // Rough ASCII estimate (200 chars per triangle)
    
    // Use binary for larger models or if explicitly requested
    const useBinary = params.format === 'binary' || triangleCount > 1000;
    
    if (useBinary) {
      return {
        blob: this.generateBinarySTL(mesh, params, fileName),
        format: 'binary',
        estimatedSize: binarySize
      };
    } else {
      return {
        blob: this.generateAsciiSTL(mesh, params, fileName),
        format: 'ascii',
        estimatedSize: asciiSize
      };
    }
  }

  /**
   * Validate mesh before STL generation
   */
  static validateMesh(mesh: TriangleMeshData): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Check for valid triangle indices
    const maxVertexIndex = (mesh.vertices.length / 3) - 1;
    for (let i = 0; i < mesh.indices.length; i++) {
      if (mesh.indices[i] > maxVertexIndex) {
        errors.push(`Invalid vertex index: ${mesh.indices[i]} > ${maxVertexIndex}`);
      }
    }
    
    // Check for degenerate triangles
    let degenerateCount = 0;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const i1 = mesh.indices[i] * 3;
      const i2 = mesh.indices[i + 1] * 3;
      const i3 = mesh.indices[i + 2] * 3;
      
      const v1 = [mesh.vertices[i1], mesh.vertices[i1 + 1], mesh.vertices[i1 + 2]];
      const v2 = [mesh.vertices[i2], mesh.vertices[i2 + 1], mesh.vertices[i2 + 2]];
      const v3 = [mesh.vertices[i3], mesh.vertices[i3 + 1], mesh.vertices[i3 + 2]];
      
      // Check if triangle has zero area
      const edge1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
      const edge2 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]];
      
      const cross = [
        edge1[1] * edge2[2] - edge1[2] * edge2[1],
        edge1[2] * edge2[0] - edge1[0] * edge2[2],
        edge1[0] * edge2[1] - edge1[1] * edge2[0]
      ];
      
      const area = Math.sqrt(cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2]) * 0.5;
      
      if (area < 1e-10) {
        degenerateCount++;
      }
    }
    
    if (degenerateCount > 0) {
      errors.push(`Found ${degenerateCount} degenerate triangles`);
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}
