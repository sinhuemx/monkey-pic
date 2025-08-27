// services/conversion-engine.service.ts
import { Injectable, Inject } from '@angular/core';
import { ImageEditOps, ReliefParams, Model3DParams } from '../types/converter.types';
import { Mesh } from '../types/advanced-types';
import { ImageProcessorService } from './image-processor.service';
import { MeshGeneratorService } from './mesh-generator.service';
import { StlGeneratorService } from './stl-generator.service';
import { AdvancedConverterService } from './advanced-converter.service';

@Injectable({ providedIn: 'root' })
export class ConversionEngineService {
  constructor(
    private img: ImageProcessorService,
    private relief: MeshGeneratorService,
    @Inject(StlGeneratorService) private stl: StlGeneratorService,
    private adv: AdvancedConverterService
  ) { }

  async preview2D(file: File, ops: ImageEditOps): Promise<ImageBitmap> {
    const bmp = await this.img.load(file);
    return await this.img.applyOps(bmp, ops);
  }

  async toReliefSTL(file: File, ops: ImageEditOps, p: ReliefParams) {
    const bmp = await this.img.load(file);
    const edited = await this.img.applyOps(bmp, ops);
    const heightmap = await this.img.toHeightmap(edited, p.qualitySamples, p.smoothingKernel);
    const mesh = await this.relief.heightmapToMesh(heightmap, {
      widthMM: p.widthMM, baseMM: p.baseMM, maxHeightMM: p.maxHeightMM,
      subdivision: p.subdivision, depthMultiplier: p.depthMultiplier, surfaceSmoothing: p.surfaceSmoothing
    });
    const { stl, stats } = await this.stl.fromMesh(mesh, { format: p.format, units: 'mm', watertightExpected: true });
    return { stl, stats };
  }

  parseOBJ(objContent: string): { vertices: number[], faces: number[] } {
    const lines = objContent.split('\n');
    const vertices: number[] = [];
    const faces: number[] = [];
    
    let vertexCount = 0;
    let faceCount = 0;
    let invalidFaceCount = 0;
    
    console.log('📝 Parsing OBJ with', lines.length, 'lines');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.startsWith('v ')) {
        // Parse vertex: v x y z
        const parts = line.split(/\s+/);
        if (parts.length >= 4) {
          const x = parseFloat(parts[1]);
          const y = parseFloat(parts[2]);
          const z = parseFloat(parts[3]);
          
          if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
            vertices.push(x, y, z);
            vertexCount++;
          } else {
            console.warn('📝 Invalid vertex values at line', i + 1, ':', line);
          }
        }
      } else if (line.startsWith('f ')) {
        // Parse face: f v1 v2 v3 or f v1/vt1/vn1 v2/vt2/vn2 v3/vt3/vn3
        const parts = line.split(/\s+/);
        if (parts.length >= 4) { // f + 3 vertices minimum
          const indices: number[] = [];
          
          for (let j = 1; j < parts.length; j++) {
            const vertexRef = parts[j];
            // Handle different face formats (v, v/vt, v/vt/vn, v//vn)
            const vertexIndex = parseInt(vertexRef.split('/')[0]);
            
            if (!isNaN(vertexIndex)) {
              // OBJ uses 1-based indexing, convert to 0-based
              const zeroBasedIndex = vertexIndex > 0 ? vertexIndex - 1 : vertexIndex;
              indices.push(zeroBasedIndex);
            }
          }
          
          // Verificar que tenemos al menos 3 vértices para un triángulo
          if (indices.length >= 3) {
            // Para caras con más de 3 vértices, triangular (asumiendo cara convexa)
            for (let t = 1; t < indices.length - 1; t++) {
              const i1 = indices[0];
              const i2 = indices[t];
              const i3 = indices[t + 1];
              
              // Validar que los índices están en rango
              const maxVertexIndex = (vertexCount - 1);
              if (i1 >= 0 && i1 <= maxVertexIndex && 
                  i2 >= 0 && i2 <= maxVertexIndex && 
                  i3 >= 0 && i3 <= maxVertexIndex) {
                
                // Verificar que no es un triángulo degenerado
                if (i1 !== i2 && i2 !== i3 && i1 !== i3) {
                  faces.push(i1, i2, i3);
                  faceCount++;
                } else {
                  invalidFaceCount++;
                  console.warn('� Degenerate triangle at line', i + 1, ':', i1, i2, i3);
                }
              } else {
                invalidFaceCount++;
                console.warn('📝 Out of bounds face indices at line', i + 1, ':', 
                  i1, i2, i3, 'max vertex index:', maxVertexIndex);
              }
            }
          } else {
            invalidFaceCount++;
            console.warn('📝 Face with insufficient vertices at line', i + 1, ':', line);
          }
        }
      }
    }
    
    console.log('� OBJ parsing complete:', {
      totalLines: lines.length,
      vertexCount: vertexCount,
      triangleCount: faceCount,
      invalidFaceCount: invalidFaceCount,
      verticesLength: vertices.length,
      facesLength: faces.length,
      averageVerticesPerTriangle: vertices.length / (faceCount * 3) || 0
    });
    
    // Validación final
    if (vertexCount === 0) {
      console.error('📝 No valid vertices found in OBJ file');
      throw new Error('OBJ file contains no valid vertices');
    }
    
    if (faceCount === 0) {
      console.warn('📝 No valid faces found in OBJ file, returning vertices only');
    }
    
    return {
      vertices,
      faces
    };
  }

  async toModel3D(file: File, ops: ImageEditOps, p: Model3DParams) {
    console.log('🔧 ConversionEngine.toModel3D called with:', {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      ops,
      params: p
    });

    // PIPELINE DE CALIDAD PROFESIONAL 🥇
    const bmp = await this.img.load(file);
    console.log('🔧 Image loaded:', { width: bmp.width, height: bmp.height });
    
    // 1. ENTRADA 2D IMPECABLE
    let processedBmp: ImageBitmap;
    
    // Verificar si se activa el modo "Alta Calidad"
    const isHighQuality = p.qualityMode === 'professional' || (p.targetFaces && p.targetFaces >= 400000);
    
    if (isHighQuality) {
      console.log('🎯 Modo ALTA CALIDAD activado - Aplicando pipeline profesional');
      
      // Aplicar operaciones básicas primero si existen
      const editedBmp = await this.img.applyOps(bmp, ops);
      
      // Pipeline de calidad profesional: segmentación + upscale x2 + pre-filtro
      processedBmp = await this.img.prepareForHighQuality(editedBmp);
      console.log('✅ Pipeline de entrada 2D completado');
    } else {
      // Modo estándar (como antes)
      if (!ops.crop && (ops.scalePct ?? 100) === 100 && !ops.brightness && !ops.contrast) {
        processedBmp = bmp;
        console.log('🔧 Using original image (no editing operations)');
      } else {
        processedBmp = await this.img.applyOps(bmp, ops);
        console.log('🔧 Applied image operations, new size:', { width: processedBmp.width, height: processedBmp.height });
      }
    }
    
    // 2. PREPARAR PARA GENERACIÓN 3D CON PROMPT MEJORADO
    const canvas = document.createElement('canvas');
    canvas.width = processedBmp.width;
    canvas.height = processedBmp.height;
    const ctx = canvas.getContext('2d', { 
      willReadFrequently: false,
      alpha: false
    })!;
    
    // Configuraciones de máxima calidad
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(processedBmp, 0, 0);
    
    console.log('🔧 Image processing:', {
      originalSize: `${bmp.width}x${bmp.height}`,
      finalSize: `${processedBmp.width}x${processedBmp.height}`,
      canvasSize: `${canvas.width}x${canvas.height}`,
      qualityMode: isHighQuality ? 'PROFESIONAL' : 'estándar'
    });
    
    // Convertir a blob con máxima calidad PNG
    const imageBlob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob!);
      }, 'image/png', 1.0);
    });
    
    console.log('🔧 Image blob created:', {
      size: `${(imageBlob.size / 1024 / 1024).toFixed(2)} MB`,
      type: imageBlob.type,
      canvasSize: `${canvas.width}x${canvas.height}`,
      imageSize: `${processedBmp.width}x${processedBmp.height}`
    });
    
    const formData = new FormData();
    formData.append('file', imageBlob, 'processed_image.png');
    
    // 3. OPCIONES MEJORADAS PARA EL BACKEND CON FORZADO DE GEOMETRÍA COMPLETA
    const options = {
      widthMM: p.widthMM || 100,
      baseMM: p.baseMM || 1,
      maxHeightMM: p.maxHeightMM || 10,
      invert: p.invert || false,
      // Nuevos parámetros para calidad profesional
      qualityMode: isHighQuality ? 'professional' : 'standard',
      targetFaces: p.targetFaces || (isHighQuality ? 500000 : 200000),
      prompt: this.buildVolumetricPrompt(!!isHighQuality),
      resolution: isHighQuality ? 1024 : 512,
      enableMultiview: isHighQuality,
      enableConsistency: isHighQuality,
      // NUEVOS PARÁMETROS PARA FORZAR GEOMETRÍA COMPLETA
      forceComplete: true,                    // Forzar modelo completo
      generate360: true,                      // Generar geometría 360°
      minimumThickness: 2.0,                  // Mínimo 2mm de grosor
      ensureWatertight: true,                 // Asegurar manifold watertight
      depthEstimationQuality: isHighQuality ? 'ultra' : 'high',  // Calidad de estimación de profundidad
      multiViewSynthesis: isHighQuality,      // Síntesis multi-vista
      backfaceGeneration: 'complete',         // Generar caras traseras completas
      volumeCompletionMode: 'full',           // Modo de completado volumétrico
      surfaceSmoothing: isHighQuality ? 'advanced' : 'standard',
      edgePreservation: true,                 // Preservar bordes importantes
      detailEnhancement: isHighQuality        // Mejora de detalles
    };
    formData.append('options', JSON.stringify(options));
    
    console.log('🔧 Making HTTP request to /api/hq with enhanced options...', options);
    let response: Response;
    try {
      response = await fetch('/api/hq', {
        method: 'POST',
        body: formData,
      });
    } catch (fetchError) {
      console.error('🔧 Fetch failed:', fetchError);
      throw new Error(`Network error: ${fetchError}`);
    }

    console.log('🔧 HTTP response received:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length')
    });

    if (!response.ok) {
      let errorBody: any;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = { error: 'Failed to process response' };
      }
      console.error('🔧 HTTP error response:', errorBody);
      throw new Error(errorBody.error || `HTTP error! status: ${response.status}`);
    }
    
    let objData: string;
    try {
      objData = await response.text();
    } catch (textError) {
      console.error('🔧 Failed to read response text:', textError);
      throw new Error(`Failed to read response: ${textError}`);
    }
    
    console.log('🔧 OBJ data received:', {
      length: objData.length,
      preview: objData.substring(0, 500),
      hasVertices: objData.includes('v '),
      hasFaces: objData.includes('f '),
      lineCount: objData.split('\n').length
    });

    console.log('🔧 Parsing OBJ data...');
    let rawMesh: Mesh;
    try {
      const parsedOBJ = this.parseOBJ(objData);
      // Convertir a tipos correctos para Mesh
      rawMesh = {
        vertices: new Float32Array(parsedOBJ.vertices),
        faces: new Uint32Array(parsedOBJ.faces)
      };
    } catch (parseError) {
      console.error('🔧 Failed to parse OBJ:', parseError);
      throw new Error(`OBJ parsing failed: ${parseError}`);
    }
    
    console.log('🔧 Raw mesh parsed:', {
      vertices: rawMesh.vertices.length / 3,
      faces: rawMesh.faces.length / 3,
      verticesBuffer: rawMesh.vertices.constructor.name,
      facesBuffer: rawMesh.faces.constructor.name
    });

    // 4. POST-PROCESO AVANZADO CON PIPELINE DE CALIDAD OPTIMIZADO
    console.log('🔧 Starting advanced post-processing with quality optimization...');
    let cleanMesh: Mesh;
    try {
      cleanMesh = await this.adv.postProcess(rawMesh, {
        makeManifold: true, 
        closeHoles: true, 
        fixSelfIntersections: true, 
        unifyNormals: true,
        scaleToWidthMM: p.widthMM, 
        addBaseMM: p.baseMM, 
        center: true,
        // Parámetros de calidad profesional disponibles
        targetFaces: isHighQuality ? (p.targetFaces || 500000) : undefined,
        taubinIterations: isHighQuality ? 15 : 5,
        creaseAngle: isHighQuality ? 50 : 60,
        enableAdvancedSmoothing: !!isHighQuality,
        enableQuadricDecimation: !!(isHighQuality && p.targetFaces !== undefined)
      });
    } catch (postProcessError) {
      console.error('🔧 Post-processing failed:', postProcessError);
      throw new Error(`Post-processing failed: ${postProcessError}`);
    }
    
    console.log('🔧 Clean mesh after advanced post-processing:', {
      vertices: cleanMesh.vertices.length / 3,
      faces: cleanMesh.faces.length / 3,
      qualityMode: isHighQuality ? 'PROFESIONAL' : 'estándar'
    });
    
    console.log('🔧 Starting STL generation...');
    let stlResult: { stl: ArrayBuffer; stats: { faces: number; verts: number; volumeCM3?: number } };
    try {
      const format = p.format ?? 'binary'; // Valor predeterminado
      stlResult = await this.stl.fromMesh(cleanMesh, { format: format, units: 'mm', watertightExpected: true });
    } catch (stlError) {
      console.error('🔧 STL generation failed:', stlError);
      throw new Error(`STL generation failed: ${stlError}`);
    }
    
    const { stl, stats } = stlResult;
    console.log('🔧 STL conversion stats:', stats);

    console.log('🔧 ¡Pipeline de calidad profesional completado exitosamente! 🥇');
    return { stl, stats, previewMesh: cleanMesh };
  }

  /**
   * Construye prompt volumétrico optimizado para calidad profesional
   */
  private buildVolumetricPrompt(isHighQuality: boolean): string {
    const basePrompt = "Generate a complete 3D volumetric model from this single image with full 360-degree geometry.";
    
    if (isHighQuality) {
      return `${basePrompt} 
        CRITICAL: Generate COMPLETE volumetric 3D model with full back/sides/top/bottom geometry.
        Generate multivistas consistentes: frontal, lateral izquierda, lateral derecha, trasera, vista superior, vista inferior.
        Create FULL 360-degree geometry - NO flat backs or missing surfaces.
        Use advanced depth estimation and multi-view synthesis for complete volume reconstruction.
        Generate smooth clay-like surfaces with consistent topology throughout.
        Ensure WATERTIGHT manifold geometry with proper thickness (minimum 2mm walls).
        Target HIGH polygon density for smooth curvature and fine details.
        Avoid planar artifacts - create FULL volumetric closed surface.
        Optimize for professional 3D printing with complete printable geometry.
        COMPLETE the model - ensure no missing faces or open edges.
        Generate consistent normals and proper mesh topology for 3D printing.`;
    }
    
    return `${basePrompt} 
      Create COMPLETE volumetric geometry with full 360-degree surfaces.
      Generate back and sides using depth estimation and view synthesis.
      Ensure watertight manifold structure suitable for 3D printing.
      NO flat backs - create complete closed surface geometry.`;
  }
}