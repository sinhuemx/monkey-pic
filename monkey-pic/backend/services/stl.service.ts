import { imageToStl } from "./enhanced-stl.service.ts";

interface ModelOptions {
  widthMM?: number;
  baseMM?: number;
  maxHeightMM?: number;
  invert?: boolean;
  targetTris?: number;
}

// NUEVO: Interfaz específica para modelos 3D completos (independiente del relieve)
interface Model3DOptions {
  // Parámetros físicos detallados
  widthMM?: number;           // Ancho en milímetros
  baseMM?: number;            // Grosor de la base en milímetros
  maxHeightMM?: number;       // Altura máxima en milímetros
  targetFaces?: number;       // Número objetivo de caras/triángulos
  
  // Parámetros de procesamiento detallado
  depthMultiplier?: number;   // Multiplicador de profundidad
  surfaceSmoothing?: number;  // Factor de suavizado de superficie
  qualityThreshold?: number;  // Umbral de calidad
  smoothingKernel?: number;   // Tamaño del kernel de suavizado
  subdivisionLevel?: number;  // Nivel de subdivisión
  
  // Parámetros de control
  invert?: boolean;           // Invertir profundidad
  manifold?: boolean;         // Asegurar geometría watertight
  wireframe?: boolean;        // Modo wireframe
  flatShading?: boolean;      // Sombreado plano
  
  // Parámetros de calidad profesional
  qualityMode?: 'standard' | 'professional';  // Modo de calidad
  taubinIterations?: number;                   // Iteraciones de suavizado Taubin
  creaseAngle?: number;                        // Ángulo de pliegue para preservar aristas
  enableAdvancedSmoothing?: boolean;           // Activar suavizado avanzado
  enableQuadricDecimation?: boolean;           // Activar decimación inteligente
  resolution?: number;                         // Resolución de generación
  enableMultiview?: boolean;                   // Consistencia multivista
  enableConsistency?: boolean;                 // Activar validaciones de consistencia
  
  // Parámetros legacy (para compatibilidad)
  scale?: number;             // Escala general del modelo (1.0 = normal)
  detail?: number;            // Nivel de detalle (1.0 = normal, 2.0 = alto detalle)
  volume?: number;            // Factor de volumen (1.0 = normal, 2.0 = más volumétrico)
  
  // Parámetros adicionales
  prompt?: string;            // Prompt para generación
  format?: 'binary' | 'ascii'; // Formato de salida
}

export class StlService {
  async generatePreview(imageContent: Uint8Array): Promise<string> {
    // This is legacy, the frontend should call the HQ endpoint for previews now.
    // For compatibility, we can return a simple placeholder or call the TS implementation.
    const stl = await imageToStl(imageContent, { widthMM: 100, baseMM: 1, maxHeightMM: 10, invert: false });
    return stl;
  }

  // NUEVO: Función específica para generar modelos 3D completos (independiente del relieve)
  async generate3DModel(imageContent: Uint8Array, options: Model3DOptions = {}): Promise<{ stl?: string; obj?: string; error?: string, stdout?: string, stderr?: string }> {
    const tempImagePath = await Deno.makeTempFile({ prefix: "monkey-pic-3d-", suffix: ".png" });
    await Deno.writeFile(tempImagePath, imageContent);

    const tempOutputPath = await Deno.makeTempFile({ prefix: "monkey-pic-3d-output-", suffix: ".obj" });

    // PARÁMETROS DETALLADOS PARA CONSTRUCCIÓN 3D ESPECÍFICA
    // Usar parámetros enviados del frontend o valores por defecto optimizados
    const widthMM = options.widthMM ?? 80;
    const baseMM = options.baseMM ?? 2;
    const maxHeightMM = options.maxHeightMM ?? 5;
    const targetTris = options.targetFaces ?? 200000;
    const depthMultiplier = options.depthMultiplier ?? 2.5;
    const surfaceSmoothing = options.surfaceSmoothing ?? 1.0;
    const qualityThreshold = options.qualityThreshold ?? 0.75;
    const smoothingKernel = options.smoothingKernel ?? 3;
    const subdivisionLevel = options.subdivisionLevel ?? 0;
    
    // Calcular contraste basado en el multiplicador de profundidad
    const contrast = Math.max(1.2, 1.0 + (depthMultiplier * 0.4));
    
    // Calcular volumen esperado (en cm³)
    const expectedVolumeCM3 = (widthMM * widthMM * maxHeightMM) / 1000 * 0.6; // 60% fill
    
    console.log(`🎯 3D Model Parameters (From Frontend):`);
    console.log(`  - Dimensions: ${widthMM}×${widthMM}×${maxHeightMM}mm (W×D×H)`);
    console.log(`  - Base: ${baseMM}mm, Target Faces: ${targetTris}, Contrast: ${contrast.toFixed(1)}`);
    console.log(`  - Depth Multiplier: ${depthMultiplier}x, Surface Smoothing: ${surfaceSmoothing}`);
    console.log(`  - Quality Threshold: ${qualityThreshold}, Smoothing Kernel: ${smoothingKernel}`);
    console.log(`  - Subdivision Level: ${subdivisionLevel}, Expected Volume: ${expectedVolumeCM3.toFixed(2)} cm³`);

    const args = [
      "scripts/ai3d/volumetric_generator.py",  // CORREGIDO: Usar generador volumétrico real para 3D
      "--input", tempImagePath,
      "--output", tempOutputPath,
      "--width", widthMM.toString(),
      "--depth", (widthMM * 0.75).toString(), // Depth proporcional al width
      "--height", maxHeightMM.toString(),
      "--resolution", Math.min(128, Math.floor(targetTris / 1000)).toString(), // Voxel resolution basado en targetTris
      "--smoothing", smoothingKernel.toString(),
      "--threshold", qualityThreshold.toString(),
      "--mode", "volumetric", // Forzar modo volumétrico
      "--algorithm", "multiview", // Usar algoritmo de múltiples vistas
    ];

    if (options.invert) {
      args.push("--invert");
    }

    // Nota: Los parámetros como manifold, depthMultiplier, surfaceSmoothing, etc. 
    // no están soportados por el script de Python actualmente
    // Se pueden agregar al script de Python en el futuro si es necesario

    console.log(`Running 3D Model command: scripts/ai3d/.venv/bin/python ${args.join(" ")}`);

    const command = new Deno.Command("scripts/ai3d/.venv/bin/python", {
      args,
      cwd: Deno.cwd(),
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();
    
    // Read stdout and stderr streams properly
    const [stdout, stderr, status] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.status
    ]);

    console.log("3D Model Python script stdout:", stdout);
    console.error("3D Model Python script stderr:", stderr);

    await Deno.remove(tempImagePath);

    if (status.success) {
      const objContent = await Deno.readTextFile(tempOutputPath);
      await Deno.remove(tempOutputPath);
      
      // Si se solicita STL, convertir OBJ a STL
      if (options.format === 'binary' || options.format === 'ascii') {
        const stlContent = this.convertObjToStl(objContent, options.format === 'binary');
        return { stl: stlContent, obj: objContent, stdout, stderr };
      }
      
      return { obj: objContent, stdout, stderr };
    } else {
      await Deno.remove(tempOutputPath).catch(() => {});
      return { error: `Python script failed with exit code ${status.code}`, stdout, stderr };
    }
  }

  // Función auxiliar para convertir OBJ a STL
  private convertObjToStl(objContent: string, binary: boolean = false): string {
    const lines = objContent.split('\n');
    const vertices: number[][] = [];
    const faces: number[][] = [];
    
    // Parsear OBJ
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] === 'v' && parts.length >= 4) {
        vertices.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
      } else if (parts[0] === 'f' && parts.length >= 4) {
        // Convertir indices de OBJ (1-based) a 0-based y manejar formato v/vt/vn
        const faceIndices = [];
        for (let i = 1; i < parts.length; i++) {
          const vertexIndex = parseInt(parts[i].split('/')[0]) - 1;
          faceIndices.push(vertexIndex);
        }
        // Si la cara tiene más de 3 vértices, triangular
        for (let i = 1; i < faceIndices.length - 1; i++) {
          faces.push([faceIndices[0], faceIndices[i], faceIndices[i + 1]]);
        }
      }
    }
    
    // Generar STL ASCII
    let stlContent = `solid model\n`;
    
    for (const face of faces) {
      if (face.length !== 3) continue;
      
      const v1 = vertices[face[0]];
      const v2 = vertices[face[1]];
      const v3 = vertices[face[2]];
      
      if (!v1 || !v2 || !v3) continue;
      
      // Calcular normal
      const u = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
      const v = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]];
      const normal = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0]
      ];
      
      // Normalizar
      const length = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
      if (length > 0) {
        normal[0] /= length;
        normal[1] /= length;
        normal[2] /= length;
      }
      
      stlContent += `  facet normal ${normal[0]} ${normal[1]} ${normal[2]}\n`;
      stlContent += `    outer loop\n`;
      stlContent += `      vertex ${v1[0]} ${v1[1]} ${v1[2]}\n`;
      stlContent += `      vertex ${v2[0]} ${v2[1]} ${v2[2]}\n`;
      stlContent += `      vertex ${v3[0]} ${v3[1]} ${v3[2]}\n`;
      stlContent += `    endloop\n`;
      stlContent += `  endfacet\n`;
    }
    
    stlContent += `endsolid model\n`;
    return stlContent;
  }

  // FUNCIÓN ORIGINAL PARA RELIEVE (2.5D) - Mantiene parámetros del relieve
  async generateHqModel(imageContent: Uint8Array, options: ModelOptions): Promise<{ stl?: string; obj?: string; error?: string, stdout?: string, stderr?: string }> {
    const tempImagePath = await Deno.makeTempFile({ prefix: "monkey-pic-input-", suffix: ".png" });
    await Deno.writeFile(tempImagePath, imageContent);

    // Use .obj extension for HQ generation since frontend expects OBJ format
    const tempOutputPath = await Deno.makeTempFile({ prefix: "monkey-pic-output-", suffix: ".obj" });

    // OPTIMIZADO: Ajustar parámetros según nivel de calidad
    const qualityLevel = options.targetTris ?? 350000;
    let maxHeightMM = "25";  // Base height
    let debugMode = false;
    
    // Ajustar parámetros por calidad
    if (qualityLevel <= 200000) {
      // Normal quality
      maxHeightMM = "22";
      debugMode = false;
    } else if (qualityLevel <= 400000) {
      // Alta quality  
      maxHeightMM = "28";
      debugMode = true;
    } else {
      // Máxima quality
      maxHeightMM = "35";
      debugMode = true;
    }

    const args = [
      "scripts/ai3d/estimate_and_mesh_optimized.py",  // NUEVO: Script optimizado para mejor calidad
      "--input", tempImagePath,
      "--output", tempOutputPath,
      "--widthMM", options.widthMM?.toString() ?? "140",    // Dimensión física en mm
      "--baseMM", options.baseMM?.toString() ?? "4",        // Base sólida
      "--maxHeightMM", options.maxHeightMM?.toString() ?? maxHeightMM, // Altura ajustada por calidad
      "--targetTris", options.targetTris?.toString() ?? "350000", // Triangles objetivo
    ];

    // Agregar debug solo para calidad alta/máxima
    if (debugMode) {
      args.push("--debug", "/tmp/monkey_pic_debug");
    }

    if (options.invert) {
      args.push("--invert");
    }

    console.log(`Running HQ command: scripts/ai3d/.venv/bin/python ${args.join(" ")}`);

    const command = new Deno.Command("scripts/ai3d/.venv/bin/python", {
      args,
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();
    
    // Read stdout and stderr streams properly
    const [stdout, stderr, status] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.status
    ]);

    console.log("Python script stdout:", stdout);
    console.error("Python script stderr:", stderr);

    await Deno.remove(tempImagePath);

    if (status.success) {
      const objContent = await Deno.readTextFile(tempOutputPath);
      await Deno.remove(tempOutputPath);
      return { obj: objContent, stdout, stderr };
    } else {
      await Deno.remove(tempOutputPath).catch(() => {}); // Try to clean up output file on error
      return { error: `Failed to generate HQ OBJ.`, stdout, stderr };
    }
  }

  async generateHqStl(imageContent: Uint8Array, options: ModelOptions): Promise<{ stl?: string; error?: string, stdout?: string, stderr?: string }> {
    const tempImagePath = await Deno.makeTempFile({ prefix: "monkey-pic-input-", suffix: ".png" });
    await Deno.writeFile(tempImagePath, imageContent);

    const tempOutputPath = await Deno.makeTempFile({ prefix: "monkey-pic-output-", suffix: ".stl" });

    const args = [
      "scripts/ai3d/estimate_and_mesh.py",
      "--input", tempImagePath,
      "--output", tempOutputPath,
      "--widthMM", options.widthMM?.toString() ?? "120",    // OPTIMIZADO: Tamaño generoso pero manejable
      "--baseMM", options.baseMM?.toString() ?? "4",        // OPTIMIZADO: Base más sólida
      "--maxHeightMM", options.maxHeightMM?.toString() ?? "18", // OPTIMIZADO: Altura sustancial para buen relieve
      "--targetTris", "800000", // OPTIMIZADO: Más triángulos para mejor calidad
      "--contrast", "1.5", // OPTIMIZADO: Contraste mejorado
      "--useMiDaS", // Use AI model for HQ
    ];

    if (options.invert) {
      args.push("--invert");
    }

    console.log(`Running HQ STL command: scripts/ai3d/.venv/bin/python ${args.join(" ")}`);

    const command = new Deno.Command("scripts/ai3d/.venv/bin/python", {
      args,
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();
    
    // Read stdout and stderr streams properly
    const [stdout, stderr, status] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.status
    ]);

    console.log("Python script stdout:", stdout);
    console.error("Python script stderr:", stderr);

    await Deno.remove(tempImagePath);

    if (status.success) {
      const stlContent = await Deno.readTextFile(tempOutputPath);
      await Deno.remove(tempOutputPath);
      return { stl: stlContent, stdout, stderr };
    } else {
      await Deno.remove(tempOutputPath).catch(() => {}); // Try to clean up output file on error
      return { error: `Failed to generate HQ STL.`, stdout, stderr };
    }
  }
}