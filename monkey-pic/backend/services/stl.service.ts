// Convierte una imagen a STL con mejoras de volumen y textura
import { imageToEnhancedStl } from "./enhanced-stl.service.ts";

interface Options {
  widthMM: number;
  baseMM: number;
  maxHeightMM: number;
  invert: boolean;
  sampleMax?: number;
  // Enhanced options from frontend
  depthMultiplier?: number;
  edgeSharpening?: number;
  detailPreservation?: number;
  surfaceSmoothing?: number;
  microTexture?: boolean;
  organicShaping?: boolean;
}

export async function imageToStl(bytes: Uint8Array, opts: Options): Promise<string> {
  // Use enhanced STL generation for better quality
  const enhancedOpts = {
    widthMM: opts.widthMM,
    baseMM: opts.baseMM,
    maxHeightMM: opts.maxHeightMM,
    invert: opts.invert,
    sampleMax: opts.sampleMax,
    volumeEnhancement: {
      enabled: true,
      depthMultiplier: opts.depthMultiplier ?? 1.3,
      gradientBoost: 1.2,
      contrastCurve: 0.75
    },
    textureEnhancement: {
      enabled: true,
      detailPreservation: opts.detailPreservation ?? 0.4,
      edgeSharpening: opts.edgeSharpening ?? 0.3,
      surfaceSmoothing: opts.surfaceSmoothing ?? 0.15,
      microTexture: opts.microTexture ?? true
    },
    advancedGeometry: {
      adaptiveSubdivision: true,
      organicShaping: opts.organicShaping ?? true,
      overhangsSupport: true
    }
  };
  
  return await imageToEnhancedStl(bytes, enhancedOpts);
}

export async function imageToStlBinary(bytes: Uint8Array, opts: Options): Promise<{ data: Uint8Array; triangles: number; sampleMaxUsed: number }>{
  // For now, convert enhanced STL to binary format
  const stlText = await imageToStl(bytes, opts);
  
  // Parse triangles from ASCII STL
  const triangleMatches = stlText.match(/facet normal[\s\S]*?endfacet/g) || [];
  const triangleCount = triangleMatches.length;
  
  // Create binary STL structure
  const headerBytes = 80;
  const triBytes = 50; // 12*4 floats + 2 bytes attribute
  const totalBytes = headerBytes + 4 + triangleCount * triBytes;
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);
  
  // Header
  const header = new Uint8Array(buf, 0, headerBytes);
  const headerText = new TextEncoder().encode("monkey_pic_enhanced_binary");
  header.set(headerText.slice(0, headerBytes));
  
  // Triangle count
  view.setUint32(headerBytes, triangleCount, true);
  
  let offset = headerBytes + 4;
  
  // Parse and write triangles
  for (const triangle of triangleMatches) {
    const normalMatch = triangle.match(/facet normal ([-\d.]+) ([-\d.]+) ([-\d.]+)/);
    const vertexMatches = triangle.match(/vertex ([-\d.]+) ([-\d.]+) ([-\d.]+)/g);
    
    if (normalMatch && vertexMatches && vertexMatches.length === 3) {
      // Normal
      view.setFloat32(offset + 0, parseFloat(normalMatch[1]), true);
      view.setFloat32(offset + 4, parseFloat(normalMatch[2]), true);
      view.setFloat32(offset + 8, parseFloat(normalMatch[3]), true);
      
      // Vertices
      let vertexOffset = 12;
      for (const vertex of vertexMatches) {
        const coords = vertex.match(/([-\d.]+)/g);
        if (coords && coords.length >= 3) {
          view.setFloat32(offset + vertexOffset, parseFloat(coords[0]), true);
          view.setFloat32(offset + vertexOffset + 4, parseFloat(coords[1]), true);
          view.setFloat32(offset + vertexOffset + 8, parseFloat(coords[2]), true);
          vertexOffset += 12;
        }
      }
      
      // Attribute byte count
      view.setUint16(offset + 48, 0, true);
      offset += triBytes;
    }
  }
  
  const sampleMaxUsed = opts.sampleMax ?? 300;
  return { 
    data: new Uint8Array(buf), 
    triangles: triangleCount, 
    sampleMaxUsed 
  };
}
