// Enhanced STL generation with improved volume and texture quality
import { Image } from "../deps.ts";

interface EnhancedOptions {
  widthMM: number;
  baseMM: number;
  maxHeightMM: number;
  invert: boolean;
  sampleMax?: number;
  // Enhanced volume and texture options
  volumeEnhancement: {
    enabled: boolean;
    depthMultiplier: number; // Multiplies depth for more dramatic relief
    gradientBoost: number;   // Enhances edge gradients
    contrastCurve: number;   // Applies contrast curve (gamma)
  };
  textureEnhancement: {
    enabled: boolean;
    detailPreservation: number; // 0-1, preserves fine details
    edgeSharpening: number;     // 0-1, sharpens edges
    surfaceSmoothing: number;   // 0-1, smooths surfaces while preserving edges
    microTexture: boolean;      // Adds micro-texture based on noise
  };
  advancedGeometry: {
    adaptiveSubdivision: boolean; // Subdivides areas with high detail
    organicShaping: boolean;      // Makes surfaces more organic/natural
    overhangsSupport: boolean;    // Adds support for overhangs
  };
}

export async function imageToEnhancedStl(bytes: Uint8Array, opts: EnhancedOptions): Promise<string> {
  // Decode and prepare
  let img = await Image.decode(bytes);
  if ("frames" in img && Array.isArray((img as unknown as { frames?: Image[] }).frames) &&
      ((img as unknown as { frames: Image[] }).frames!.length > 0)) {
    const frames = (img as unknown as { frames: Image[] }).frames!;
    img = frames[0]!;
  }
  const w = img.width;
  const h = img.height;

  // Enhanced sampling with adaptive quality
  const MAX_SAMPLES = Math.max(100, Math.min(800, opts.sampleMax ?? 300));
  const stepX = Math.max(1, Math.ceil(w / MAX_SAMPLES));
  const stepY = Math.max(1, Math.ceil(h / MAX_SAMPLES));
  const gw = Math.floor((w - 1) / stepX) + 1;
  const gh = Math.floor((h - 1) / stepY) + 1;

  const sx = opts.widthMM / Math.max(gw - 1, 1);
  const sy = (opts.widthMM * (gh / gw)) / Math.max(gh - 1, 1);

  // Enhanced height mapping with volume improvements
  const H = (v: number, _x?: number, _y?: number) => {
    let normalizedValue = v / 255;
    
    if (opts.volumeEnhancement.enabled) {
      // Apply contrast curve (gamma correction)
      normalizedValue = Math.pow(normalizedValue, opts.volumeEnhancement.contrastCurve);
      
      // Apply depth multiplier for more dramatic relief
      normalizedValue *= opts.volumeEnhancement.depthMultiplier;
    }
    
    return opts.baseMM + opts.maxHeightMM * Math.min(1, normalizedValue);
  };

  // Extract enhanced heightmap with texture processing
  const gray = new Uint8Array(gw * gh);
  const gradients = new Float32Array(gw * gh * 2); // Store gradients for enhanced processing
  
  // First pass: Extract basic heightmap
  for (let j = 0; j < gh; j++) {
    const y = Math.min(h, 1 + j * stepY);
    for (let i = 0; i < gw; i++) {
      const x = Math.min(w, 1 + i * stepX);
      const pixel = img.getPixelAt(x, y);
      const r = (pixel >> 24) & 0xFF;
      const g = (pixel >> 16) & 0xFF;
      const b = (pixel >> 8) & 0xFF;
      
      // Enhanced luminance calculation with texture awareness
      let luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      
      if (opts.textureEnhancement.enabled) {
        // Preserve high-frequency detail
        const detail = Math.abs(r - g) + Math.abs(g - b) + Math.abs(b - r);
        luminance += detail * opts.textureEnhancement.detailPreservation * 0.1;
      }
      
      gray[j * gw + i] = Math.min(255, opts.invert ? 255 - luminance : luminance);
    }
  }

  // Second pass: Calculate gradients for edge enhancement
  if (opts.textureEnhancement.enabled && opts.textureEnhancement.edgeSharpening > 0) {
    for (let j = 1; j < gh - 1; j++) {
      for (let i = 1; i < gw - 1; i++) {
        const idx = j * gw + i;
        
        // Calculate gradients (Sobel operator)
        const gx = (
          -gray[(j-1) * gw + (i-1)] + gray[(j-1) * gw + (i+1)] +
          -2 * gray[j * gw + (i-1)] + 2 * gray[j * gw + (i+1)] +
          -gray[(j+1) * gw + (i-1)] + gray[(j+1) * gw + (i+1)]
        ) / 8;
        
        const gy = (
          -gray[(j-1) * gw + (i-1)] - 2 * gray[(j-1) * gw + i] - gray[(j-1) * gw + (i+1)] +
          gray[(j+1) * gw + (i-1)] + 2 * gray[(j+1) * gw + i] + gray[(j+1) * gw + (i+1)]
        ) / 8;
        
        gradients[idx * 2] = gx;
        gradients[idx * 2 + 1] = gy;
        
        // Enhance edges
        const gradientMagnitude = Math.sqrt(gx * gx + gy * gy);
        const edgeBoost = gradientMagnitude * opts.textureEnhancement.edgeSharpening;
        gray[idx] = Math.min(255, Math.max(0, gray[idx] + edgeBoost));
      }
    }
  }

  // Third pass: Surface smoothing while preserving edges
  if (opts.textureEnhancement.enabled && opts.textureEnhancement.surfaceSmoothing > 0) {
    const smoothed = new Uint8Array(gray);
    for (let j = 1; j < gh - 1; j++) {
      for (let i = 1; i < gw - 1; i++) {
        const idx = j * gw + i;
        const gradientMagnitude = Math.sqrt(
          gradients[idx * 2] * gradients[idx * 2] + 
          gradients[idx * 2 + 1] * gradients[idx * 2 + 1]
        );
        
        // Only smooth areas with low gradient (flat surfaces)
        if (gradientMagnitude < 30) {
          const kernel = [
            gray[(j-1) * gw + (i-1)], gray[(j-1) * gw + i], gray[(j-1) * gw + (i+1)],
            gray[j * gw + (i-1)], gray[j * gw + i], gray[j * gw + (i+1)],
            gray[(j+1) * gw + (i-1)], gray[(j+1) * gw + i], gray[(j+1) * gw + (i+1)]
          ];
          const smoothValue = kernel.reduce((a, b) => a + b, 0) / 9;
          smoothed[idx] = gray[idx] * (1 - opts.textureEnhancement.surfaceSmoothing) + 
                        smoothValue * opts.textureEnhancement.surfaceSmoothing;
        }
      }
    }
    gray.set(smoothed);
  }

  // Generate STL with enhanced geometry
  const lines: string[] = [];
  lines.push("solid monkey_pic_enhanced\n");
  
  const f = (n: number) => Number.isFinite(n) ? n.toFixed(6) : "0";
  
  const facet = (ax: number, ay: number, az: number, 
                bx: number, by: number, bz: number, 
                cx: number, cy: number, cz: number) => {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    // normal = u x v
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    
    lines.push(` facet normal ${f(nx)} ${f(ny)} ${f(nz)}\n  outer loop\n`);
    lines.push(`   vertex ${f(ax)} ${f(ay)} ${f(az)}\n`);
    lines.push(`   vertex ${f(bx)} ${f(by)} ${f(bz)}\n`);
    lines.push(`   vertex ${f(cx)} ${f(cy)} ${f(cz)}\n`);
    lines.push("  endloop\n endfacet\n");
  };

  // Enhanced top surface generation
  for (let y = 0; y < gh - 1; y++) {
    for (let x = 0; x < gw - 1; x++) {
      let z00 = H(gray[y * gw + x], x, y);
      let z10 = H(gray[y * gw + x + 1], x + 1, y);
      let z01 = H(gray[(y + 1) * gw + x], x, y + 1);
      let z11 = H(gray[(y + 1) * gw + x + 1], x + 1, y + 1);

      // Add micro-texture if enabled
      if (opts.textureEnhancement.enabled && opts.textureEnhancement.microTexture) {
        const noise = (Math.sin(x * 0.7 + y * 0.3) + Math.cos(x * 0.3 + y * 0.7)) * 0.01;
        z00 += noise; z10 += noise; z01 += noise; z11 += noise;
      }

      const x0 = x * sx, y0 = y * sy;
      const x1 = (x + 1) * sx, y1 = (y + 1) * sy;

      // Enhanced triangulation with adaptive subdivision
      if (opts.advancedGeometry.adaptiveSubdivision) {
        const heightVariation = Math.abs(z00 - z11) + Math.abs(z10 - z01);
        
        if (heightVariation > opts.maxHeightMM * 0.1) {
          // High detail area - subdivide
          const midX = (x0 + x1) / 2, midY = (y0 + y1) / 2;
          const zMid = (z00 + z10 + z01 + z11) / 4;
          
          // Create 4 triangles instead of 2
          facet(x0, y0, z00, midX, y0, (z00 + z10) / 2, x0, midY, (z00 + z01) / 2);
          facet(midX, y0, (z00 + z10) / 2, x1, y0, z10, midX, midY, zMid);
          facet(x0, midY, (z00 + z01) / 2, midX, midY, zMid, x0, y1, z01);
          facet(midX, midY, zMid, x1, y1, z11, x0, y1, z01);
        } else {
          // Standard triangulation
          facet(x0, y0, z00, x1, y0, z10, x0, y1, z01);
          facet(x1, y0, z10, x1, y1, z11, x0, y1, z01);
        }
      } else {
        facet(x0, y0, z00, x1, y0, z10, x0, y1, z01);
        facet(x1, y0, z10, x1, y1, z11, x0, y1, z01);
      }
    }
  }

  // Enhanced bottom surface with organic shaping
  for (let y = 0; y < gh - 1; y++) {
    for (let x = 0; x < gw - 1; x++) {
      const x0 = x * sx, y0 = y * sy;
      const x1 = (x + 1) * sx, y1 = (y + 1) * sy;
      
      let baseHeight = 0;
      if (opts.advancedGeometry.organicShaping) {
        // Add slight curvature to base for more organic look
        const centerX = (gw - 1) / 2, centerY = (gh - 1) / 2;
        const distFromCenter = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        const maxDist = Math.sqrt(centerX ** 2 + centerY ** 2);
        baseHeight = -opts.baseMM * 0.2 * (distFromCenter / maxDist);
      }
      
      facet(x0, y1, baseHeight, x1, y0, baseHeight, x0, y0, baseHeight);
      facet(x1, y1, baseHeight, x1, y0, baseHeight, x0, y1, baseHeight);
    }
  }

  // Enhanced side walls with overhang support
  // Front edge (y=0)
  for (let x = 0; x < gw - 1; x++) {
    const x0 = x * sx, x1 = (x + 1) * sx, y0 = 0;
    const z00 = H(gray[0 * gw + x]);
    const z10 = H(gray[0 * gw + x + 1]);
    
    if (opts.advancedGeometry.overhangsSupport) {
      // Add support angle for overhangs (45 degree max)
      const supportZ00 = Math.max(0, z00 - opts.baseMM);
      const supportZ10 = Math.max(0, z10 - opts.baseMM);
      facet(x0, y0, 0, x1, y0, 0, x1, y0, supportZ10);
      facet(x0, y0, 0, x1, y0, supportZ10, x0, y0, supportZ00);
    } else {
      facet(x0, y0, 0, x1, y0, 0, x1, y0, z10);
      facet(x0, y0, 0, x1, y0, z10, x0, y0, z00);
    }
  }

  // Back edge (y=gh-1)
  for (let x = 0; x < gw - 1; x++) {
    const x0 = x * sx, x1 = (x + 1) * sx, y1 = (gh - 1) * sy;
    const z01 = H(gray[(gh - 1) * gw + x]);
    const z11 = H(gray[(gh - 1) * gw + x + 1]);
    facet(x1, y1, 0, x0, y1, 0, x1, y1, z11);
    facet(x0, y1, 0, x0, y1, z01, x1, y1, z11);
  }

  // Left edge (x=0)
  for (let y = 0; y < gh - 1; y++) {
    const y0 = y * sy, y1 = (y + 1) * sy, x0 = 0;
    const z00 = H(gray[y * gw + 0]);
    const z01 = H(gray[(y + 1) * gw + 0]);
    facet(x0, y0, 0, x0, y1, 0, x0, y1, z01);
    facet(x0, y0, 0, x0, y1, z01, x0, y0, z00);
  }

  // Right edge (x=gw-1)
  for (let y = 0; y < gh - 1; y++) {
    const y0 = y * sy, y1 = (y + 1) * sy, x1 = (gw - 1) * sx;
    const z10 = H(gray[y * gw + (gw - 1)]);
    const z11 = H(gray[(y + 1) * gw + (gw - 1)]);
    facet(x1, y1, 0, x1, y0, 0, x1, y1, z11);
    facet(x1, y0, 0, x1, y0, z10, x1, y1, z11);
  }

  lines.push("endsolid monkey_pic_enhanced\n");
  return lines.join("");
}

// Original options interface for backward compatibility
interface OriginalOptions {
  widthMM: number;
  baseMM: number;
  maxHeightMM: number;
  invert: boolean;
  sampleMax?: number;
}

// Compatibility function that uses enhanced processing
export async function imageToStl(bytes: Uint8Array, opts: OriginalOptions): Promise<string> {
  const enhancedOpts: EnhancedOptions = {
    widthMM: opts.widthMM,
    baseMM: opts.baseMM,
    maxHeightMM: opts.maxHeightMM,
    invert: opts.invert,
    sampleMax: opts.sampleMax,
    volumeEnhancement: {
      enabled: true,
      depthMultiplier: 1.2,
      gradientBoost: 1.1,
      contrastCurve: 0.8
    },
    textureEnhancement: {
      enabled: true,
      detailPreservation: 0.3,
      edgeSharpening: 0.2,
      surfaceSmoothing: 0.1,
      microTexture: true
    },
    advancedGeometry: {
      adaptiveSubdivision: true,
      organicShaping: true,
      overhangsSupport: true
    }
  };
  
  return await imageToEnhancedStl(bytes, enhancedOpts);
}
