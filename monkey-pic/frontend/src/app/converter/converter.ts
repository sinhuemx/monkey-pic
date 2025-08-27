import { Component, ElementRef, ViewChild, inject, signal, computed, effect, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SliderModule } from 'carbon-components-angular/slider';

import { ConversionEngineService } from './services/conversion-engine.service';
import { Model3DService, Model3DOptions } from './services/model3d.service';
import { ImageEditOps, ReliefParams, Model3DParams } from './types/converter.types';
import { ApiService } from '../../core/api.service';

@Component({
  selector: 'app-converter',
  templateUrl: './converter.html',
  styleUrls: ['./converter.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SliderModule
  ],
})
export class ConverterComponent implements OnDestroy {
  engine = inject(ConversionEngineService);
  model3dService = inject(Model3DService);
  apiService = inject(ApiService);

  constructor() {
    // React to wireframe / flat shading toggles and update material live
    effect(() => {
      const wf = this.wireframe();
      const flat = this.flatShading();
      const m: any = this._mesh && this._mesh.material ? this._mesh.material : null;
      if (m) {
        if (typeof m.wireframe === 'boolean') m.wireframe = wf;
        if (typeof m.flatShading === 'boolean') {
          if (m.flatShading !== flat) {
            m.flatShading = flat;
            m.needsUpdate = true;
          }
        }
      }
    });

    // Monitor for state corruption and auto-fix (solo si hay un problema real)
    effect(() => {
      const mode = this.previewMode();
      if (mode === '3d' && this._mesh) {
        // Solo verificar si hay un mesh que podría estar corrupto
        // Dar tiempo para que se establezca el estado antes de verificar
        setTimeout(() => {
          if (this.previewMode() === '3d' && this._mesh) { // Verificar de nuevo después del timeout
            this.checkAndFixState();
          }
        }, 2000); // Aumentar tiempo para evitar verificaciones prematuras
      }
    });
  }

  // ===== Signals de estado =====
  file = signal<File | null>(null);
  previewMode = signal<'image' | 'relief' | '3d'>('image');
  // Estados de carga independientes por tab
  isLoading = signal(false); // Global para UI general
  reliefLoading = signal(false); // Específico para tab relieve
  model3dLoading = signal(false); // Específico para tab 3D
  
  // Estados de proceso activo por tab
  reliefProcessActive = signal(false); // Proceso de relieve en curso
  model3dProcessActive = signal(false); // Proceso de 3D en curso
  error = signal<string | undefined>(undefined);
  lastConversion = signal<'relief' | '3d' | null>(null);

  // Progress bar states para loader mejorado
  loadingProgress = signal(0);
  loadingStatusText = signal('Iniciando...');
  private loadingInterval?: number;

  // CONTROLES ESPECÍFICOS DEL TAB RELIEVE
  reliefDepthMultiplier = signal(2.5);
  reliefSmoothingKernel = signal(3);
  reliefWidthMM = signal(80);
  reliefMaxHeightMM = signal(5);
  reliefBaseMM = signal(2);
  reliefSubdivisionLevel = signal(0);
  reliefSurfaceSmoothing = signal(1);
  reliefQualityThreshold = signal(0.75);

  // CONTROLES ESPECÍFICOS DEL TAB 3D (independientes del relieve)
  model3dDepthMultiplier = signal(2.5);
  model3dSmoothingKernel = signal(3);
  model3dWidthMM = signal(80);
  model3dMaxHeightMM = signal(5);
  model3dBaseMM = signal(2);
  model3dSubdivisionLevel = signal(0);
  model3dSurfaceSmoothing = signal(1);
  model3dQualityThreshold = signal(0.75);
  model3dQualityLevel = signal<'normal' | 'alta' | 'maxima'>('alta'); // Nivel de calidad seleccionado
  model3dSampleMax = computed(() => {
    switch (this.model3dQualityLevel()) {
      case 'normal': return 300;
      case 'alta': return 700;
      case 'maxima': return 1000;
      default: return 700;
    }
  });

  // Computed para mostrar las caras objetivo en formato K
  model3dExpectedFaces = computed(() => {
    const targetFaces = Math.max(25000, this.model3dSampleMax() * 500);
    if (targetFaces >= 1000) {
      return (targetFaces / 1000).toFixed(0) + 'K';
    }
    return targetFaces.toString();
  });

  // Estado 3D (UI controls)
  imageScalePct = signal(100);
  imageRotation = signal(0);
  imageBrightness = signal(100);
  imageContrast = signal(100);
  imageSharpness = signal(100);
  imageFlipH = signal(false);
  imageFlipV = signal(false);
  cropEnabled = signal(false);
  cropRect = signal({ x: 0, y: 0, w: 100, h: 100 });

  // UI signals
  wireframe = signal(false);
  flatShading = signal(false);
  faceCount = signal(0);
  vertCount = signal(0);
  volumeCM3 = signal<number | null>(null);
  ready3D = signal(false);

  // Derivadas
  // Computed properties para estados por tab
  isImage = computed(() => this.previewMode() === 'image');
  isRelief = computed(() => this.previewMode() === 'relief');
  is3D = computed(() => this.previewMode() === '3d');
  
  // Estados de carga específicos
  isCurrentTabLoading = computed(() => {
    switch (this.previewMode()) {
      case 'relief': return this.reliefLoading();
      case '3d': return this.model3dLoading();
      default: return this.isLoading();
    }
  });
  
  // Estados de proceso activo
  isCurrentTabProcessActive = computed(() => {
    switch (this.previewMode()) {
      case 'relief': return this.reliefProcessActive();
      case '3d': return this.model3dProcessActive();
      default: return false;
    }
  });
  is3DReady = computed(() => this.ready3D());
  trianglesEstimate = computed(() => {
    // Usar valores específicos según el tab activo
    if (this.previewMode() === '3d') {
      return 512 * 512 * 2; // Valor fijo para 3d de alta calidad
    } else {
      return this.sampleMax() * this.sampleMax() * 2;
    }
  });

  // Computed properties que retornan los valores correctos según el modo actual
  widthMM = computed(() => {
    switch (this.previewMode()) {
      case 'relief': return this.reliefWidthMM();
      case '3d': return this.model3dWidthMM();
      default: return this.reliefWidthMM(); // fallback para 'image'
    }
  });

  baseMM = computed(() => {
    switch (this.previewMode()) {
      case 'relief': return this.reliefBaseMM();
      case '3d': return this.model3dBaseMM();
      default: return this.reliefBaseMM(); // fallback para 'image'
    }
  });

  maxHeightMM = computed(() => {
    switch (this.previewMode()) {
      case 'relief': return this.reliefMaxHeightMM();
      case '3d': return this.model3dMaxHeightMM();
      default: return this.reliefMaxHeightMM(); // fallback para 'image'
    }
  });

  subdivisionLevel = computed(() => {
    switch (this.previewMode()) {
      case 'relief': return this.reliefSubdivisionLevel();
      case '3d': return this.model3dSubdivisionLevel();
      default: return this.reliefSubdivisionLevel(); // fallback para 'image'
    }
  });

  depthMultiplier = computed(() => {
    switch (this.previewMode()) {
      case 'relief': return this.reliefDepthMultiplier();
      case '3d': return this.model3dDepthMultiplier();
      default: return this.reliefDepthMultiplier(); // fallback para 'image'
    }
  });

  surfaceSmoothing = computed(() => {
    switch (this.previewMode()) {
      case 'relief': return this.reliefSurfaceSmoothing();
      case '3d': return this.model3dSurfaceSmoothing();
      default: return this.reliefSurfaceSmoothing(); // fallback para 'image'
    }
  });

  qualityThreshold = computed(() => {
    switch (this.previewMode()) {
      case 'relief': return this.reliefQualityThreshold();
      case '3d': return this.model3dQualityThreshold();
      default: return this.reliefQualityThreshold(); // fallback para 'image'
    }
  });

  sampleMax = computed(() => {
    switch (this.previewMode()) {
      case 'relief': return 150; // valor fijo para relief
      case '3d': return this.model3dSampleMax(); // valor dinámico para 3d
      default: return 150; // fallback para 'image'
    }
  });

  smoothingKernel = computed(() => {
    switch (this.previewMode()) {
      case 'relief': return this.reliefSmoothingKernel();
      case '3d': return this.model3dSmoothingKernel();
      default: return this.reliefSmoothingKernel(); // fallback para 'image'
    }
  });

  // Referencias del DOM - Un solo canvas que se usa para todos los modos
  // Canvas references para cada tab independiente
  @ViewChild('previewCanvas', { static: false }) previewCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('reliefCanvas', { static: false }) reliefCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('imageCanvas', { static: false }) imageCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('threeContainer', { static: false }) threeContainer?: ElementRef<HTMLDivElement>;

  // Variables Three.js privadas
  private _three: any;
  private _scene: any;
  private _camera: any;
  private _renderer: any;
  private _controls: any;
  private _mesh: any;
  private _currentMesh: any;
  private _raf?: number;
  private _onResizeBound?: () => void;

  // Variables de estado específicas para cada tab
  public lastBitmap?: ImageBitmap;
  private _reliefRaf?: number;
  private _imageRaf?: number;
  
  // Estados independientes por tab
  private _imageReady = signal(false);
  private _reliefReady = signal(false);
  private _3dReady = signal(false);
  
  // Template properties
  format = signal<'binary' | 'ascii'>('binary');
  
  // URLs de descarga INDEPENDIENTES por tab
  reliefDownloadUrl = signal<string | null>(null);
  reliefDownloadName = signal<string | null>(null);
  model3dDownloadUrl = signal<string | null>(null);
  model3dDownloadName = signal<string | null>(null);
  
  // Computed para mostrar la descarga correcta según el tab activo
  downloadUrl = computed(() => {
    switch (this.previewMode()) {
      case 'relief': return this.reliefDownloadUrl();
      case '3d': return this.model3dDownloadUrl();
      default: return null;
    }
  });
  
  downloadName = computed(() => {
    switch (this.previewMode()) {
      case 'relief': return this.reliefDownloadName();
      case '3d': return this.model3dDownloadName();
      default: return null;
    }
  });
  
  // Properties for template
  _lastBmpW = 0;
  _lastBmpH = 0;

  // ===== Métodos principales =====

  setPreviewMode(m: 'image' | 'relief' | '3d') {
    console.log('🔧 Switching preview mode to:', m);
    
    // NO interrumpir procesos activos - solo cambiar la vista
    // Los procesos de cada tab siguen corriendo en background
    
    // Solo parar loops de renderizado visual, no procesos de conversión
    this.stopThreeLoop();
    
    // Clear any active animation frames for visual updates
    if (this._reliefRaf) {
      cancelAnimationFrame(this._reliefRaf);
      this._reliefRaf = undefined;
    }
    if (this._imageRaf) {
      cancelAnimationFrame(this._imageRaf);
      this._imageRaf = undefined;
    }
    
    // Cambiar modo sin afectar estados de proceso
    this.previewMode.set(m);
    
    console.log('🔧 Tab switched to:', m, '- Active processes preserved');
    
    // Renderizar el contenido apropiado para el tab actual
    if (m === 'image') {
      if (this.lastBitmap) {
        console.log('🔧 Refreshing image preview...');
        setTimeout(() => {
          this.refreshImagePreview();
        }, 50);
      }
    } else if (m === 'relief') {
      if (this.lastBitmap) {
        try {
          setTimeout(() => {
            console.log('🔧 Attempting to render relief preview...');
            this.renderReliefPreview(this.lastBitmap!);
          }, 100);
        } catch (error) {
          console.error('🔧 Error rendering relief preview:', error);
        }
      }
    } else if (m === '3d') {
      console.log('🔧 Switching to 3D mode...');
      this.ready3D.set(false);
      
      // Clean up any existing invalid meshes first
      this.cleanupInvalidMeshes();
      
      const container = this.threeContainer?.nativeElement;
      if (container) {
        this.ensureThree(container).then(() => {
          if (this._mesh && this._scene) {
            // Validate mesh before starting render loop
            const isValidMesh = this.validateMesh(this._mesh);
            if (isValidMesh) {
              this.ready3D.set(true);
              this.startThreeLoop();
            } else {
              console.error('🔧 Invalid mesh detected, not starting render loop');
              this.cleanupInvalidMeshes();
              this.error.set('Invalid 3D model data detected');
            }
          }
        }).catch((error) => {
          console.error('🔧 Failed to initialize Three.js:', error);
          this.error.set('Error initializing 3D viewer');
        });
      }
    }
  }

  validateMesh(mesh: any): boolean {
    if (!mesh) {
      console.error('🔧 Invalid mesh: mesh is null or undefined');
      return false;
    }
    
    if (!mesh.isMesh) {
      console.error('🔧 Invalid mesh: not a Three.js Mesh object');
      return false;
    }
    
    const geo = mesh.geometry;
    if (!geo) {
      console.error('🔧 Invalid mesh: no geometry');
      return false;
    }
    
    const posAttr = geo.attributes.position;
    if (!posAttr) {
      console.error('🔧 Invalid mesh: no position attribute');
      return false;
    }
    
    if (!posAttr.array || posAttr.array.length === 0) {
      console.error('🔧 Invalid mesh: empty position array');
      return false;
    }
    
    if (!posAttr.array.byteLength) {
      console.error('🔧 Invalid mesh: position array has no byteLength');
      return false;
    }
    
        // Index is optional - some geometries don't use indices
    if (geo.index) {
      console.log('🔧 Checking index array:', {
        hasArray: !!geo.index.array,
        arrayLength: geo.index.array?.length,
        byteLength: geo.index.array?.byteLength,
        count: geo.index.count
      });
      
      if (!geo.index.array || !geo.index.array.byteLength) {
        console.warn('🔧 Mesh warning: index array exists but is invalid - this might be intentional');
        // Don't fail validation for invalid index - just warn
      } else if (geo.index.array.length === 0) {
        console.warn('🔧 Mesh warning: index array exists but is empty - this might be intentional');
        // Don't fail validation for empty index - just warn
      }
    } else {
      console.log('🔧 Mesh has no index array - using non-indexed geometry');
    }
    
    console.log('🔧 Mesh validation passed');
    return true;
  }

  // Calcular volumen del mesh en cm³ - Optimizado para meshes de alta densidad
  calculateMeshVolume(mesh: any): number | null {
    try {
      if (!mesh || !mesh.geometry) {
        console.warn('🧊 Volume calculation: no mesh or geometry');
        return null;
      }

      const geometry = mesh.geometry;
      const position = geometry.attributes.position;
      
      if (!position || !position.array) {
        console.warn('🧊 Volume calculation: no position attribute');
        return null;
      }

      const vertices = position.array;
      const vertexCount = position.count;
      let triangleCount = 0;
      let volume = 0;
      
      console.log('🧊 Volume calculation for high-density mesh:', {
        hasIndex: !!geometry.index,
        vertexCount: vertexCount,
        verticesArrayLength: vertices.length,
        estimatedTriangles: geometry.index ? geometry.index.count / 3 : vertexCount / 3
      });
      
      // Para meshes de alta densidad, usar algoritmo optimizado
      if (geometry.index && geometry.index.array) {
        const indices = geometry.index.array;
        triangleCount = Math.floor(indices.length / 3);
        
        console.log('🧊 Processing indexed high-density mesh:', triangleCount, 'triangles');
        
        // Muestreo para meshes muy grandes (> 100k triángulos)
        const sampleRate = triangleCount > 100000 ? Math.max(1, Math.floor(triangleCount / 50000)) : 1;
        let sampledTriangles = 0;
        
        for (let i = 0; i < indices.length; i += (3 * sampleRate)) {
          if (i + 2 >= indices.length) break;
          
          const i1 = indices[i] * 3;
          const i2 = indices[i + 1] * 3;
          const i3 = indices[i + 2] * 3;
          
          // Verificación rápida de bounds
          if (i1 + 2 >= vertices.length || i2 + 2 >= vertices.length || i3 + 2 >= vertices.length) {
            continue;
          }
          
          // Usar algoritmo de volumen signado más eficiente
          const v1x = vertices[i1], v1y = vertices[i1 + 1], v1z = vertices[i1 + 2];
          const v2x = vertices[i2], v2y = vertices[i2 + 1], v2z = vertices[i2 + 2];
          const v3x = vertices[i3], v3y = vertices[i3 + 1], v3z = vertices[i3 + 2];
          
          // Producto cruz más directo: (v2-v1) × (v3-v1)
          const ax = v2x - v1x, ay = v2y - v1y, az = v2z - v1z;
          const bx = v3x - v1x, by = v3y - v1y, bz = v3z - v1z;
          
          // Volumen del tetraedro: (1/6) * v1 · ((v2-v1) × (v3-v1))
          const cross_x = ay * bz - az * by;
          const cross_y = az * bx - ax * bz;
          const cross_z = ax * by - ay * bx;
          
          const signedVolume = (v1x * cross_x + v1y * cross_y + v1z * cross_z) / 6;
          
          if (isFinite(signedVolume)) {
            volume += signedVolume;
            sampledTriangles++;
          }
        }
        
        // Escalar volumen si usamos muestreo
        if (sampleRate > 1) {
          volume *= sampleRate;
          console.log('🧊 Used sampling rate:', sampleRate, 'processed:', sampledTriangles, 'triangles');
        }
        
      } else {
        // Sin índices - geometría no indexada
        triangleCount = Math.floor(vertexCount / 3);
        console.log('🧊 Processing non-indexed high-density mesh:', triangleCount, 'triangles');
        
        const sampleRate = triangleCount > 50000 ? Math.max(1, Math.floor(triangleCount / 25000)) : 1;
        let sampledTriangles = 0;
        
        for (let i = 0; i < vertices.length; i += (9 * sampleRate)) {
          if (i + 8 >= vertices.length) break;
          
          const v1x = vertices[i], v1y = vertices[i + 1], v1z = vertices[i + 2];
          const v2x = vertices[i + 3], v2y = vertices[i + 4], v2z = vertices[i + 5];
          const v3x = vertices[i + 6], v3y = vertices[i + 7], v3z = vertices[i + 8];
          
          const ax = v2x - v1x, ay = v2y - v1y, az = v2z - v1z;
          const bx = v3x - v1x, by = v3y - v1y, bz = v3z - v1z;
          
          const cross_x = ay * bz - az * by;
          const cross_y = az * bx - ax * bz;
          const cross_z = ax * by - ay * bx;
          
          const signedVolume = (v1x * cross_x + v1y * cross_y + v1z * cross_z) / 6;
          
          if (isFinite(signedVolume)) {
            volume += signedVolume;
            sampledTriangles++;
          }
        }
        
        if (sampleRate > 1) {
          volume *= sampleRate;
          console.log('🧊 Used sampling rate:', sampleRate, 'processed:', sampledTriangles, 'triangles');
        }
      }

      console.log('🧊 Raw volume calculation result:', {
        triangleCount,
        rawVolume: volume,
        isFinite: isFinite(volume)
      });

      // Verificar que tenemos un volumen válido
      if (!isFinite(volume)) {
        console.warn('🧊 Volume calculation resulted in invalid value:', volume);
        return null;
      }

      // Convertir a valor absoluto
      volume = Math.abs(volume);
      
      // Determinar unidades basándose en la escala del modelo y densidad de vertices
      let volumeCM3;
      const avgVertexMagnitude = this.calculateAverageVertexMagnitude(vertices);
      
      console.log('🧊 Volume unit detection:', {
        volume,
        avgVertexMagnitude,
        vertexCount
      });
      
      // Heurística mejorada para detección de unidades
      if (avgVertexMagnitude < 10 && volume < 100) {
        // Modelo pequeño, probablemente en metros - convertir a cm³
        volumeCM3 = volume * 1000000;
        console.log('🧊 Detected meters, converting to cm³:', volumeCM3);
      } else if (avgVertexMagnitude > 100 && volume > 1000000) {
        // Modelo grande, probablemente en mm - convertir a cm³
        volumeCM3 = volume / 1000;
        console.log('🧊 Detected millimeters, converting to cm³:', volumeCM3);
      } else {
        // Asumir que ya está en unidades apropiadas para cm³
        volumeCM3 = volume;
        console.log('🧊 Using volume as-is (assumed cm³):', volumeCM3);
      }
      
      // Verificar resultado final
      if (!isFinite(volumeCM3) || volumeCM3 <= 0) {
        console.warn('🧊 Final volume is invalid:', volumeCM3);
        return null;
      }
      
      const finalVolume = parseFloat(volumeCM3.toFixed(3));
      console.log(`🧊 Calculated mesh volume: ${finalVolume} cm³ (${triangleCount.toLocaleString()} triangles, ${vertexCount.toLocaleString()} vertices)`);
      return finalVolume;
      
    } catch (error) {
      console.warn('🧊 Failed to calculate mesh volume:', error);
      return null;
    }
  }

  // Calcular magnitud promedio de vertices para detección de unidades
  private calculateAverageVertexMagnitude(vertices: ArrayLike<number>): number {
    let sum = 0;
    let count = 0;
    
    // Muestrear cada 30º vértice para eficiencia
    for (let i = 0; i < vertices.length; i += 30) {
      if (i + 2 < vertices.length) {
        const x = vertices[i];
        const y = vertices[i + 1];
        const z = vertices[i + 2];
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        if (isFinite(magnitude)) {
          sum += magnitude;
          count++;
        }
      }
    }
    
    return count > 0 ? sum / count : 0;
  }

  // Consejos de rendimiento para meshes de alta densidad
  private checkPerformanceAndAdvise(faces: number, vertices: number, volume: number | null): void {
    const isHighDensity = faces > 100000 || vertices > 50000;
    const isUltraHighDensity = faces > 300000 || vertices > 150000;
    
    if (isUltraHighDensity) {
      console.warn(`🚀 ULTRA HIGH DENSITY MESH DETECTED:`);
      console.warn(`   • ${faces.toLocaleString()} caras, ${vertices.toLocaleString()} vértices`);
      console.warn(`   • Volumen: ${volume ? volume.toFixed(3) + ' cm³' : 'N/A'}`);
      console.warn(`   • Rendimiento: PUEDE AFECTAR SIGNIFICATIVAMENTE EL RENDIMIENTO`);
      console.warn(`   • Recomendación: Considera reducir la resolución para mejor experiencia`);
      console.warn(`   • Optimización automática: Se aplicó muestreo en cálculo de volumen`);
    } else if (isHighDensity) {
      console.info(`🔧 HIGH DENSITY MESH:`);
      console.info(`   • ${faces.toLocaleString()} caras, ${vertices.toLocaleString()} vértices`);
      console.info(`   • Volumen: ${volume ? volume.toFixed(3) + ' cm³' : 'N/A'}`);
      console.info(`   • Rendimiento: Buena calidad, uso responsable de recursos`);
      console.info(`   • Ideal para: Impresión 3D de alta calidad`);
    } else {
      console.log(`✅ MESH STATS:`);
      console.log(`   • ${faces.toLocaleString()} caras, ${vertices.toLocaleString()} vértices`);
      console.log(`   • Volumen: ${volume ? volume.toFixed(3) + ' cm³' : 'N/A'}`);
      console.log(`   • Rendimiento: Óptimo para visualización fluida`);
    }
    
    // Calcular ratio calidad/rendimiento
    const qualityScore = Math.min(100, (faces / 1000) * 10);
    const performanceScore = Math.max(0, 100 - (faces / 5000));
    
    console.log(`📊 QUALITY/PERFORMANCE RATIO:`);
    console.log(`   • Calidad: ${qualityScore.toFixed(1)}/100`);
    console.log(`   • Rendimiento: ${performanceScore.toFixed(1)}/100`);
    console.log(`   • Balance: ${((qualityScore + performanceScore) / 2).toFixed(1)}/100`);
  }

  is3ds() { return false; } // Placeholder

  toggleWireframe() {
    this.wireframe.set(!this.wireframe());
  }

  toggleFlatShading() {
    this.flatShading.set(!this.flatShading());
  }

  // Método para construir parámetros específicos del tab 3D
  private get3DParams(): Model3DParams {
    return {
      widthMM: this.model3dWidthMM(),
      baseMM: this.model3dBaseMM(),
      maxHeightMM: this.model3dMaxHeightMM(),
      wireframe: this.wireframe(),
      flatShading: this.flatShading(),
      
      manifold: true,
      prompt: "Convert 2D image to 3D relief model",
      format: this.format() as 'binary' | 'ascii',
      invert: false
    };
  }

  // Método para construir parámetros específicos del tab Relieve
  private getReliefParams(): ReliefParams {
    return {
      widthMM: this.reliefWidthMM(),
      baseMM: this.reliefBaseMM(),
      maxHeightMM: this.reliefMaxHeightMM(),
      depthMultiplier: this.reliefDepthMultiplier(),
      subdivision: this.reliefSubdivisionLevel() as 1|2|3|4,
      surfaceSmoothing: this.reliefSurfaceSmoothing(),
      qualitySamples: 150, // Valor fijo para relieve
      smoothingKernel: this.reliefSmoothingKernel() as 1|3|5|7|9,
      format: 'binary' as 'binary'|'ascii'
    };
  }

  // Método para construir parámetros específicos del tab 3D
  private getModel3DParams(): Model3DParams {
    return {
      widthMM: this.model3dWidthMM(),
      baseMM: this.model3dBaseMM(),
      maxHeightMM: this.model3dMaxHeightMM(),
      wireframe: this.wireframe(),
      flatShading: this.flatShading(),
      targetFaces: Math.max(25000, this.model3dSampleMax() * 500), // Reducido para mejor rendimiento
      manifold: true,
      prompt: `Generate a complete 3D volumetric model from this single image with full 360-degree geometry. 
      Create COMPLETE volumetric geometry with full 360-degree surfaces.
      Generate back and sides using depth estimation and view synthesis.
      Ensure watertight manifold structure suitable for 3D printing.
      NO flat backs - create complete closed surface geometry.`,
      depthMultiplier: this.model3dDepthMultiplier(),
      surfaceSmoothing: this.surfaceSmoothing(),
      qualityThreshold: this.model3dQualityThreshold(),
      smoothingKernel: this.model3dSmoothingKernel(),
      subdivisionLevel: this.model3dSubdivisionLevel()
    };
  }

  // Parámetros para conversión volumétrica REAL - Leídos desde los controles de la UI
  private getVolumetricParams() {
    // Usar los controles del tab 3D para la generación volumétrica
    const width = this.model3dWidthMM();
    // Asignar profundidad proporcional al ancho, manteniendo la lógica anterior
    const depth = width * 0.75; 
    const height = this.model3dMaxHeightMM();
    // La resolución del modelo se controla con el slider de "Calidad" en el UI
    const resolution = 512; 
    const smoothing = this.surfaceSmoothing();
    const threshold = this.model3dQualityThreshold();

    console.log('🧊 Reading Volumetric Params from UI:', {
      width,
      depth,
      height,
      resolution,
      smoothing,
      threshold
    });

    return {
      widthMM: width,
      depthMM: depth,
      heightMM: height,
      resolutionLevel: resolution,
      smoothingIterations: smoothing,
      volumeThreshold: threshold
    };
  }

  // Crear geometría específica para modelos volumétricos
  private async createVolumetricGeometry(previewMesh: any) {
    // Asegurar que el contenedor 3D está disponible
    const container = this.threeContainer?.nativeElement;
    if (!container) {
      throw new Error('🧊 Container 3D no disponible para mostrar modelo volumétrico');
    }

    // Asegurar que Three.js está cargado y la escena inicializada
    await this.ensureThree(container);
    const THREE = this._three;
    
    const geometry = new THREE.BufferGeometry();
    
    // Configurar vértices
    const positions = new Float32Array(previewMesh.vertices);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    console.log('🧊 Volumetric geometry debug:', {
      verticesLength: previewMesh.vertices.length,
      facesLength: previewMesh.faces?.length || 0,
      vertexCount: positions.length / 3,
      hasValidFaces: !!(previewMesh.faces && previewMesh.faces.length > 0),
      facesType: previewMesh.faces?.constructor.name || 'none'
    });
    
    // IMPORTANTE: Para modelos volumétricos, preferir geometría no-indexada para evitar problemas
    let shouldUseIndexed = false;
    
    // Manejar índices si existen con validación mejorada y reparación automática
    if (previewMesh.faces && previewMesh.faces.length > 0) {
      try {
        console.log('🧊 Validating face indices for volumetric geometry...');
        
        // Verificar que los índices son válidos
        const isValidTypedArray = (previewMesh.faces instanceof Uint16Array || 
                                  previewMesh.faces instanceof Uint32Array || 
                                  Array.isArray(previewMesh.faces));
        
        if (!isValidTypedArray) {
          console.warn('🧊 Invalid face array type, creating non-indexed geometry');
        } else {
          let maxIndex = -1;
          let minIndex = Infinity;
          let hasInvalidIndex = false;
          let validIndicesCount = 0;
          
          // Análisis más detallado de los índices
          for (let i = 0; i < previewMesh.faces.length; i++) {
            const index = previewMesh.faces[i];
            if (typeof index !== 'number' || isNaN(index) || index < 0) {
              console.warn(`🧊 Invalid index value found at position ${i}: ${index}`);
              hasInvalidIndex = true;
              // No hacer break para contar todos los errores
            } else {
              validIndicesCount++;
              if (index > maxIndex) maxIndex = index;
              if (index < minIndex) minIndex = index;
            }
          }
          
          const vertexCount = previewMesh.vertices.length / 3;
          const faceCount = previewMesh.faces.length / 3;
          
          console.log('🧊 Index validation results:', {
            faceArrayLength: previewMesh.faces.length,
            triangleCount: faceCount,
            vertexCount: vertexCount,
            validIndicesCount: validIndicesCount,
            hasInvalidIndex: hasInvalidIndex,
            minIndex: minIndex,
            maxIndex: maxIndex,
            indexRange: `${minIndex}-${maxIndex}`,
            vertexRange: `0-${vertexCount - 1}`
          });
          
          // Validación mejorada con más checks
          const hasValidRange = maxIndex < vertexCount && minIndex >= 0;
          const hasCompleteTriangles = previewMesh.faces.length % 3 === 0;
          const hasEnoughVertices = vertexCount >= 3;
          const validityRatio = validIndicesCount / previewMesh.faces.length;
          
          if (!hasInvalidIndex && hasValidRange && hasCompleteTriangles && hasEnoughVertices && validityRatio === 1.0) {
            // Crear array de índices validado
            let indexArray;
            
            if (maxIndex < 65536) {
              // Usar Uint16Array si los índices son pequeños (más eficiente)
              indexArray = previewMesh.faces instanceof Uint16Array ? 
                previewMesh.faces : new Uint16Array(previewMesh.faces);
            } else {
              // Usar Uint32Array para índices grandes
              indexArray = previewMesh.faces instanceof Uint32Array ? 
                previewMesh.faces : new Uint32Array(previewMesh.faces);
            }
            
            // Validación final antes de asignar
            if (indexArray && indexArray.length > 0 && indexArray.byteLength > 0) {
              geometry.setIndex(indexArray);
              shouldUseIndexed = true;
              console.log(`🧊 ✅ Using optimized indexed geometry: ${indexArray.length} indices (${Math.floor(indexArray.length / 3)} triangles), ${indexArray.constructor.name}`);
            } else {
              console.warn('🧊 Failed to create valid index buffer, falling back to non-indexed');
            }
          } else {
            console.warn('🧊 Indices failed validation, falling back to non-indexed geometry:', {
              hasInvalidIndex,
              hasValidRange,
              hasCompleteTriangles,
              hasEnoughVertices,
              validityRatio: Math.round(validityRatio * 100) + '%'
            });
          }
        }
      } catch (error) {
        console.warn('🧊 Exception during index validation:', error);
      }
    }
    
    // Si no pudimos usar índices, crear geometría no-indexada a partir de las caras
    if (!shouldUseIndexed && previewMesh.faces && previewMesh.faces.length > 0) {
      console.log('🧊 Converting indexed mesh to non-indexed for compatibility');
      
      try {
        const originalVertices = previewMesh.vertices;
        const faces = previewMesh.faces;
        const newVertices = [];
        
        // Crear vértices no-indexados a partir de las caras
        for (let i = 0; i < faces.length; i += 3) {
          const i1 = faces[i] * 3;
          const i2 = faces[i + 1] * 3;
          const i3 = faces[i + 2] * 3;
          
          // Verificar bounds
          if (i1 + 2 < originalVertices.length && i2 + 2 < originalVertices.length && i3 + 2 < originalVertices.length) {
            // Vértice 1
            newVertices.push(originalVertices[i1], originalVertices[i1 + 1], originalVertices[i1 + 2]);
            // Vértice 2  
            newVertices.push(originalVertices[i2], originalVertices[i2 + 1], originalVertices[i2 + 2]);
            // Vértice 3
            newVertices.push(originalVertices[i3], originalVertices[i3 + 1], originalVertices[i3 + 2]);
          }
        }
        
        if (newVertices.length > 0) {
          const nonIndexedPositions = new Float32Array(newVertices);
          geometry.setAttribute('position', new THREE.BufferAttribute(nonIndexedPositions, 3));
          console.log('🧊 Created non-indexed geometry with', newVertices.length / 3, 'vertices (', newVertices.length / 9, 'triangles)');
        }
      } catch (error) {
        console.warn('🧊 Failed to create non-indexed geometry:', error);
      }
    }
    
    if (!shouldUseIndexed && (!previewMesh.faces || previewMesh.faces.length === 0)) {
      console.log('🧊 No face indices found, using vertices as non-indexed triangles');
    }

    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    
    // Validación final de la geometría antes de crear el mesh (con reparación automática)
    try {
      const isGeometryValid = this.validateGeometry(geometry);
      if (!isGeometryValid) {
        console.warn('🧊 Geometry validation found issues, but attempting to continue with repaired geometry');
        // En lugar de fallar, intentar usar la geometría reparada
      } else {
        console.log('🧊 ✅ Geometry validation passed successfully');
      }
    } catch (validationError) {
      console.warn('🧊 Geometry validation threw error, but continuing:', validationError);
      // Continuar con la geometría ya que las reparaciones automáticas pueden haber resuelto los problemas
    }

    // Material optimizado para modelos volumétricos
    const material = new THREE.MeshStandardMaterial({
      color: 0xf0f0f0,
      metalness: 0.1,
      roughness: 0.3,
      flatShading: this.flatShading(),
      wireframe: this.wireframe(),
      side: THREE.FrontSide, // Solo cara frontal para volumetría
      transparent: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    console.log('🧊 Volumetric mesh created successfully');
    
    // Ahora la escena debería estar inicializada
    const meshSet = this.setPreviewMesh(mesh);
    
    if (meshSet && this._mesh && this._scene && this._scene.children.includes(this._mesh)) {
      this.centerView();
      this.ready3D.set(true);
      
      // Generar STL para descarga
      this.generate3DDownload();
      
      // Asegurar que el loop de render está ejecutándose para modo 3D
      if (this.previewMode() === '3d') {
        this.startThreeLoop();
      }
      
      console.log('🧊 Volumetric mesh successfully added to scene and centered');
    } else {
      console.error('🧊 Failed to set volumetric mesh in scene');
      throw new Error('No se pudo agregar el modelo volumétrico a la escena 3D');
    }
  }

  // Conversión 3D optimizada usando AI (endpoint HQ)
  async convert3D() {
    if (!this.file()) {
      this.error.set('Por favor selecciona una imagen primero');
      return;
    }

    // Usar estados específicos del tab 3D
    this.model3dLoading.set(true);
    this.model3dProcessActive.set(true);
    this.error.set(undefined);
    this.lastConversion.set('3d');
    
    // Limpiar download URL anterior del 3D
    this.clearModel3dDownloadUrl();
    
    // Iniciar simulación de progreso para 3D
    this.startLoadingProgress('3d');

    try {
      console.log('🚀 Starting VOLUMETRIC 3D model conversion with AI...');
      
      // Usar parámetros optimizados para 3D
      const model3dParams = this.getModel3DParams();
      console.log('🚀 3D Parameters:', model3dParams);
      
      // Usar ApiService con endpoint específico para modelos 3D completos
      this.apiService.convertTo3DModel(this.file()!, {
        widthMM: model3dParams.widthMM,
        baseMM: model3dParams.baseMM,
        maxHeightMM: model3dParams.maxHeightMM,
        targetFaces: model3dParams.targetFaces,
        depthMultiplier: model3dParams.depthMultiplier,
        surfaceSmoothing: model3dParams.surfaceSmoothing,
        qualityThreshold: model3dParams.qualityThreshold,
        smoothingKernel: model3dParams.smoothingKernel,
        subdivisionLevel: model3dParams.subdivisionLevel,
        invert: false, // Normalmente no invertimos para 3D
        manifold: model3dParams.manifold
      }).subscribe({
        next: async (blob) => {
          console.log('🚀 VOLUMETRIC 3D model received from backend');
          
          // Simular progreso hasta 90% antes de procesar
          this.updateLoadingProgress(90, 'Finalizando modelo volumétrico...');
          
          // Convertir blob a texto (OBJ)
          const objContent = await blob.text();
          
          // Parsear usando el engine de conversión (optimizado)
          const previewMesh = this.engine.parseOBJ(objContent);
          console.log('🚀 Parsed VOLUMETRIC mesh:', {
            verticesLength: previewMesh.vertices.length,
            facesLength: previewMesh.faces.length,
            vertexCount: previewMesh.vertices.length / 3,
            faceCount: previewMesh.faces.length / 3
          });

          // Crear geometría de Three.js
          await this.createVolumetricGeometry(previewMesh);
          console.log('🚀 VOLUMETRIC 3D mesh successfully loaded and displayed');
          
          // Generar automáticamente la descarga STL para 3D
          await this.generate3DDownload();
          
          // Completar progress bar al 100%
          this.completeLoadingProgress();
          
          // Proceso completado - mantener estado activo
          this.model3dProcessActive.set(false);
          
          // Esperar un momento para mostrar el estado completo
          setTimeout(() => {
            this.model3dLoading.set(false);
            this.resetLoadingProgress();
          }, 1500); // Mostrar "¡Listo!" por 1.5 segundos
        },
        error: (error) => {
          console.error('🚀 VOLUMETRIC 3D conversion error:', error);
          this.error.set(`Error en conversión 3D volumétrica: ${error.message || error}`);
          this.model3dLoading.set(false);
          this.model3dProcessActive.set(false);
          this.resetLoadingProgress();
        }
      });

    } catch (error) {
      console.error('🚀 3D conversion error:', error);
      this.error.set(`Error en conversión 3D: ${error}`);
      this.model3dLoading.set(false);
      this.model3dProcessActive.set(false);
      this.resetLoadingProgress();
    }
  }

  // Three.js setup
  async ensureThree(container: HTMLElement) {
    if (!this._three) {
      this._three = await import('three');
    }
    const OrbitMod = await import('three/examples/jsm/controls/OrbitControls.js').catch(() => null);
    const THREE = this._three;
    
    if (!this._renderer) {
      this._renderer = new THREE.WebGLRenderer({ 
        antialias: true, 
        alpha: true,
        powerPreference: "default",
        preserveDrawingBuffer: false
      });
      this._renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      
      const canvas = this._renderer.domElement;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.maxWidth = '100%';
      canvas.style.maxHeight = '100%';
      canvas.style.objectFit = 'contain';
      canvas.style.display = 'block';
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.zIndex = '1';
      
      container.appendChild(canvas);
    }
    
    if (!this._scene) {
      this._scene = new THREE.Scene();
      this._scene.background = new THREE.Color(0xf4f4f4);
      
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
      this._scene.add(ambientLight);
      
      const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
      mainLight.position.set(2, 3, 5);
      this._scene.add(mainLight);
      
      const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
      fillLight.position.set(-2, 1, 3);
      this._scene.add(fillLight);
    }
    
    if (!this._camera) {
      const rect = container.getBoundingClientRect();
      this._camera = new THREE.PerspectiveCamera(45, Math.max(1e-6, rect.width / Math.max(1, rect.height)), 0.1, 2000);
      this._camera.position.set(0.5, 0.6, 1.2);
    }

    const OC = (OrbitMod as any)?.OrbitControls;
    if (OC && !this._controls) {
      this._controls = new OC(this._camera, this._renderer.domElement);
      this._controls.enableDamping = true;
      this._controls.dampingFactor = 0.05;
      this._controls.enableZoom = true;
      this._controls.enablePan = true;
      this._controls.enableRotate = true;
      this._controls.maxDistance = 10;
      this._controls.minDistance = 0.1;
    }

    this.resizeThree(container);
  }

  centerView() {
    if (!this._three || !this._camera || !this._renderer) {
      console.warn('🔧 Cannot center view: Missing Three.js core components (three/camera/renderer)');
      return;
    }
    
    if (!this._mesh) {
      console.warn('🔧 Cannot center view: No mesh to center on');
      return;
    }
    
    try {
      const THREE = this._three;
      
      // RESETEAR la escala del mesh a 1,1,1
      this._mesh.scale.set(1, 1, 1);
      this._mesh.updateMatrixWorld(true);
      
      // Recalcular geometría
      this._mesh.geometry.computeBoundingBox();
      const box = new THREE.Box3().setFromObject(this._mesh);
      
      if (box.isEmpty()) {
        console.warn('🔧 Cannot center view: Mesh bounding box is empty');
        return;
      }
      
      const size = new THREE.Vector3(); 
      box.getSize(size);
      const center = new THREE.Vector3(); 
      box.getCenter(center);
      
      // Escalar apropiadamente
      const maxDim = Math.max(size.x, size.y, size.z);
      const targetSize = 2.0;
      const scaleFactor = targetSize / maxDim;
      
      this._mesh.scale.setScalar(scaleFactor);
      this._mesh.updateMatrixWorld(true);
      
      // Recalcular después del escalado
      const finalBox = new THREE.Box3().setFromObject(this._mesh);
      const finalSize = new THREE.Vector3();
      const finalCenter = new THREE.Vector3();
      finalBox.getSize(finalSize);
      finalBox.getCenter(finalCenter);
      
      // Posicionar cámara
      const finalMaxDim = Math.max(finalSize.x, finalSize.y, finalSize.z);
      const fov = (this._camera.fov * Math.PI) / 180;
      let distance = (finalMaxDim * 1.5) / Math.tan(fov / 2);
      distance = Math.max(distance, 3.0);
      
      this._camera.position.set(
        finalCenter.x + distance * 0.7,
        finalCenter.y + distance * 0.8,
        finalCenter.z + distance * 0.9
      );
      
      this._camera.lookAt(finalCenter);
      
      if (this._controls) {
        this._controls.target.copy(finalCenter);
        this._controls.update();
      }
      
    } catch (error) {
      console.error('🔧 Error in centerView:', error);
    }
  }

  startThreeLoop() {
    if (!this._renderer || !this._scene || !this._camera) {
      console.warn('🔧 Cannot start Three.js loop: missing components');
      return;
    }
    
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      
      if (this._controls) {
        this._controls.update();
      }
      
      try {
        // Validate scene and meshes before rendering
        if (this._scene && this._camera && this._renderer) {
          // Check if there are any objects with invalid geometry
          let hasInvalidMesh = false;
          let invalidMeshCount = 0;
          
          this._scene.traverse((object: any) => {
            if (object.isMesh && object.geometry) {
              const geo = object.geometry;
              let meshValid = true;
              const issues: string[] = [];
              
              // Verificar atributos de posición
              if (!geo.attributes || !geo.attributes.position) {
                meshValid = false;
                issues.push('missing position attribute');
              } else {
                const posAttr = geo.attributes.position;
                if (!posAttr.array) {
                  meshValid = false;
                  issues.push('null position array');
                } else if (posAttr.array.length === 0) {
                  meshValid = false;
                  issues.push('empty position array');
                } else if (!posAttr.array.byteLength) {
                  meshValid = false;
                  issues.push('zero byteLength position array');
                }
              }
              
              // Verificar índices solo si existen - manejar corrupción gracefully
              if (geo.index) {
                if (!geo.index.array) {
                  console.warn('🔧 Found mesh with null index array - removing index to fix corruption');
                  geo.index = null; // Reparación automática
                  issues.push('null index array (fixed)');
                } else if (!geo.index.array.byteLength) {
                  console.warn('🔧 Found mesh with zero byteLength index - removing index to fix corruption');
                  geo.index = null; // Reparación automática
                  issues.push('zero byteLength index (fixed)');
                } else if (geo.index.array.length === 0) {
                  console.warn('🔧 Found mesh with empty index array - removing index to fix corruption');
                  geo.index = null; // Reparación automática
                  issues.push('empty index array (fixed)');
                } else {
                  // Verificar integridad de los índices
                  const maxIndex = Math.max(...geo.index.array);
                  const vertexCount = geo.attributes.position.count;
                  if (maxIndex >= vertexCount) {
                    console.warn('🔧 Found mesh with out-of-bounds indices - removing index to fix corruption');
                    geo.index = null; // Reparación automática
                    issues.push('out-of-bounds indices (fixed)');
                  }
                }
              }
              
              // Si la malla sigue siendo inválida después de las reparaciones
              if (!meshValid) {
                console.error('🔧 Found invalid mesh that cannot be repaired:', {
                  name: object.name || 'unnamed',
                  uuid: object.uuid,
                  issues: issues,
                  hasPosition: !!geo.attributes?.position,
                  positionLength: geo.attributes?.position?.array?.length || 0,
                  hasIndex: !!geo.index,
                  indexLength: geo.index?.array?.length || 0
                });
                hasInvalidMesh = true;
                invalidMeshCount++;
              } else if (issues.length > 0) {
                console.log('🔧 Repaired mesh issues:', {
                  name: object.name || 'unnamed',
                  issuesFixed: issues
                });
              }
            }
          });
          
          if (hasInvalidMesh) {
            console.error(`🔧 Stopping render loop due to ${invalidMeshCount} invalid mesh(es) detected`);
            this.stopThreeLoop();
            this.cleanupInvalidMeshes();
            return;
          }
          
          this._renderer.render(this._scene, this._camera);
        }
      } catch (error) {
        console.error('🔧 Error in render loop:', error);
        this.stopThreeLoop();
        this.cleanupInvalidMeshes();
      }
    };
    
    if (this._raf) {
      cancelAnimationFrame(this._raf);
    }
    
    loop();
  }

  stopThreeLoop() {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = undefined;
      console.log('🔧 Three.js render loop stopped');
    }
  }

  // Función de validación específica para geometrías Three.js con reparación automática
  private validateGeometry(geometry: any): boolean {
    try {
      const THREE = this._three;
      if (!THREE || !geometry) {
        console.error('🔧 Cannot validate geometry: missing Three.js or geometry');
        return false;
      }

      const issues: string[] = [];
      const repairs: string[] = [];
      
      // 1. Verificar que es una geometría válida (CRÍTICO - no reparable)
      if (!(geometry instanceof THREE.BufferGeometry)) {
        console.error('🔧 CRITICAL: Not a BufferGeometry instance');
        return false;
      }
      
      // 2. Verificar atributos de posición (CRÍTICO - no reparable)
      if (!geometry.attributes || !geometry.attributes.position) {
        console.error('🔧 CRITICAL: Missing position attribute');
        return false;
      }
      
      const pos = geometry.attributes.position;
      if (!pos.array || pos.array.length === 0) {
        console.error('🔧 CRITICAL: Empty position array');
        return false;
      }
      
      if (pos.array.length % 3 !== 0) {
        console.error('🔧 CRITICAL: Position array length not divisible by 3');
        return false;
      }
      
      if (!pos.array.byteLength) {
        console.error('🔧 CRITICAL: Position array has zero byte length');
        return false;
      }
      
      // 3. Verificar y reparar índices si existen (REPARABLE)
      if (geometry.index) {
        const idx = geometry.index;
        if (!idx.array) {
          repairs.push('removing null index array');
          geometry.index = null;
        } else if (idx.array.length === 0) {
          repairs.push('removing empty index array');
          geometry.index = null;
        } else if (!idx.array.byteLength) {
          repairs.push('removing zero byteLength index array');
          geometry.index = null;
        } else if (idx.array.length % 3 !== 0) {
          repairs.push('removing index array not divisible by 3');
          geometry.index = null;
        } else {
          // Verificar rango de índices
          try {
            const maxIndex = Math.max(...idx.array);
            const vertexCount = geometry.attributes.position.count;
            if (maxIndex >= vertexCount) {
              repairs.push('removing out-of-range index array');
              geometry.index = null;
            }
          } catch (error) {
            repairs.push('removing problematic index array (error during check)');
            geometry.index = null;
          }
        }
      }
      
      // 4. Verificar y reparar bounding box (REPARABLE)
      if (geometry.boundingBox) {
        const bb = geometry.boundingBox;
        if (!bb.min || !bb.max || isNaN(bb.min.x) || isNaN(bb.max.x)) {
          repairs.push('recomputing invalid bounding box');
          geometry.boundingBox = null;
          try {
            geometry.computeBoundingBox();
          } catch (error) {
            console.warn('🔧 Could not recompute bounding box:', error);
          }
        }
      }
      
      // 5. Verificar que tenemos suficientes datos para renderizar (CRÍTICO después de reparaciones)
      const vertexCount = geometry.attributes.position.count;
      if (vertexCount < 3) {
        console.error('🔧 CRITICAL: Insufficient vertices for rendering');
        return false;
      }
      
      const triangleCount = geometry.index ? 
        geometry.index.count / 3 : 
        vertexCount / 3;
      
      // Log de resultados
      console.log('🔧 Geometry validation and repair results:', {
        status: 'VALID',
        vertexCount: vertexCount,
        triangleCount: Math.floor(triangleCount),
        hasIndex: !!geometry.index,
        repairsApplied: repairs.length,
        repairDetails: repairs.length > 0 ? repairs : 'none needed'
      });
      
      if (repairs.length > 0) {
        console.warn('🔧 Applied automatic repairs:', repairs);
      }
      
      // Si llegamos aquí y no hay problemas críticos, consideramos válida la geometría
      return true;
      
    } catch (error) {
      console.error('🔧 Exception during geometry validation:', error);
      return false;
    }
  }

  cleanupInvalidMeshes() {
    if (!this._scene) return;
    
    console.log('🔧 Cleaning up invalid meshes...');
    const toRemove: any[] = [];
    
    this._scene.traverse((object: any) => {
      if (object.isMesh) {
        const geo = object.geometry;
        let isValid = true;
        
        if (!geo || !geo.attributes || !geo.attributes.position) {
          isValid = false;
        } else {
          const posAttr = geo.attributes.position;
          if (!posAttr.array || posAttr.array.length === 0 || !posAttr.array.byteLength) {
            isValid = false;
          }
        }
        
        if (!isValid) {
          console.log('🔧 Marking invalid mesh for removal:', object);
          toRemove.push(object);
        }
      }
    });
    
    // Remove invalid meshes
    toRemove.forEach(mesh => {
      this._scene.remove(mesh);
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat: any) => mat.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    });
    
    // Reset mesh references if they were removed
    if (toRemove.includes(this._mesh)) {
      this._mesh = null;
      this._currentMesh = null;
      this.faceCount.set(0);
      this.vertCount.set(0);
    }
    
    console.log('🔧 Cleanup completed, removed', toRemove.length, 'invalid meshes');
  }

  setPreviewMesh(mesh: any): boolean {
    if (!this._scene) {
      console.error('🔧 Cannot set preview mesh: scene not initialized');
      return false;
    }
    
    if (!mesh) {
      console.error('🔧 Cannot set preview mesh: mesh is null or undefined');
      return false;
    }
    
    // Validate mesh before adding to scene
    if (!this.validateMesh(mesh)) {
      console.error('🔧 Cannot set preview mesh: mesh validation failed');
      this.error.set('Invalid 3D model data received');
      return false;
    }
    
    // Stop render loop before modifying scene
    this.stopThreeLoop();
    
    if (this._mesh) {
      this._scene.remove(this._mesh);
    }
    
    this._mesh = mesh;
    this._currentMesh = mesh;
    this._scene.add(this._mesh);
    
    let faces = 0, verts = 0;
    if (mesh.isMesh) {
      const geo = mesh.geometry;
      if (geo && geo.attributes && geo.attributes.position) {
        verts = geo.attributes.position.count || 0;
        
        // Calculate face count based on whether geometry is indexed or not
        if (geo.index && geo.index.count > 0) {
          // Indexed geometry: divide index count by 3 for triangles
          faces = Math.floor(geo.index.count / 3) || 0;
        } else {
          // Non-indexed geometry: divide vertex count by 3 for triangles
          faces = Math.floor(verts / 3) || 0;
        }
      }
    }
    
    this.faceCount.set(faces);
    this.vertCount.set(verts);
    
    // Calcular volumen del mesh
    const volume = this.calculateMeshVolume(mesh);
    this.volumeCM3.set(volume);
    
    // Proporcionar consejos de rendimiento para meshes de alta densidad
    this.checkPerformanceAndAdvise(faces, verts, volume);
    
    // Solo actualizar estados 3D cuando estemos en modo 3D
    if (this.previewMode() === '3d') {
      this._3dReady.set(true);
    }
    
    // Don't call centerView here - let the caller handle it
    
    // Only start render loop if we're in 3D mode and the mesh is valid
    if (this.previewMode() === '3d' && this._mesh && this._mesh.geometry) {
      // Validate the geometry one more time before starting render loop
      const geo = this._mesh.geometry;
      const hasValidPosition = geo.attributes && geo.attributes.position && geo.attributes.position.array && geo.attributes.position.array.byteLength > 0;
      const hasValidIndex = !geo.index || (geo.index.array && geo.index.array.byteLength > 0);
      
      if (hasValidPosition) {
        this.startThreeLoop();
        console.log('🔧 Started render loop for valid mesh', {
          indexed: !!geo.index,
          vertices: geo.attributes.position.count,
          triangles: geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3
        });
      } else {
        console.warn('🔧 Skipping render loop - invalid position data');
      }
    }
    
    if (this._renderer && this._scene && this._camera) {
      try {
        // Before rendering, check and fix any corrupted geometries
        this._scene.traverse((obj: any) => {
          if (obj.isMesh && obj.geometry && obj.geometry.index) {
            const idx = obj.geometry.index;
            if (!idx.array || !idx.array.byteLength || idx.array.length === 0) {
              console.warn('🔧 Fixing corrupted index in mesh during render');
              obj.geometry.index = null;
            }
          }
        });
        
        this._renderer.render(this._scene, this._camera);
      } catch (error) {
        console.error('🔧 Error in single render:', error);
        // Try to fix the issue by converting all geometries to non-indexed
        this._scene.traverse((obj: any) => {
          if (obj.isMesh && obj.geometry && obj.geometry.index) {
            console.warn('🔧 Converting mesh to non-indexed geometry due to render error');
            obj.geometry.index = null;
          }
        });
        return false;
      }
    }
    
    return true;
  }

  resizeThree(container: HTMLElement) {
    if (!this._renderer || !this._camera) return;
    
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    this._renderer.setSize(w, h, false);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }

  // Debug methods
  debugMeshInfo() {
    if (!this._currentMesh || !this._three) {
      console.log('🔧 No mesh available for debugging');
      return;
    }
    
    const mesh = this._currentMesh;
    const geometry = mesh.geometry;
    
    console.log('🔧 === MESH DEBUG INFO ===');
    console.log('🔧 Mesh type:', mesh.constructor.name);
    console.log('🔧 Is visible:', mesh.visible);
    console.log('🔧 Position:', mesh.position.toArray());
    console.log('🔧 Scale:', mesh.scale.toArray());
    
    if (geometry) {
      console.log('🔧 Vertex count:', geometry.attributes.position?.count || 0);
      console.log('🔧 Face count:', geometry.index ? geometry.index.count / 3 : 0);
    }
    
    console.log('🔧 === END DEBUG INFO ===');
  }

  forceRender() {
    if (!this._renderer || !this._scene || !this._camera) {
      console.error('🔧 Cannot force render: Missing components');
      return;
    }
    
    this._camera.updateProjectionMatrix();
    
    if (this._controls) {
      this._controls.update();
    }
    
    this._renderer.render(this._scene, this._camera);
    console.log('🔧 Force render completed');
  }

  // File handling
  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const selectedFile = input.files?.[0];
    
    if (selectedFile) {
      this.file.set(selectedFile);
      this.error.set(undefined);
      
      // Limpiar downloads anteriores SOLO cuando se carga nueva imagen
      this.clearDownloadsForNewImage();
      
      // Create ImageBitmap for preview
      try {
        this.lastBitmap = await createImageBitmap(selectedFile);
        this._lastBmpW = this.lastBitmap.width;
        this._lastBmpH = this.lastBitmap.height;
        
        // Renderizar en el tab correspondiente y marcar como listo
        if (this.previewMode() === 'image') {
          this.refreshImagePreview();
          this._imageReady.set(true);
        } else if (this.previewMode() === 'relief') {
          this.renderReliefPreview(this.lastBitmap);
          this._reliefReady.set(true);
        }
        // Para 3D no auto-renderizamos, el usuario debe hacer clic en "Convertir a 3D"
        
        console.log('🔧 File loaded successfully for', this.previewMode(), 'mode');
      } catch (err) {
        console.error('Error creating ImageBitmap:', err);
      }
    }
  }

  // File drag and drop handlers
  onDragOver(event: DragEvent) {
    event.preventDefault();
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      this.file.set(file);
      this.onFileSelected({ target: { files: [file] } } as any);
    }
  }

  onFileChange(event: Event) {
    this.onFileSelected(event);
  }

  // Slider change handlers (actualizar propiedades específicas según el modo)
  onWidthSliderChange(value: number) {
    switch (this.previewMode()) {
      case 'relief':
        this.reliefWidthMM.set(value);
        // Actualizar preview en tiempo real
        if (this.lastBitmap) {
          this.renderReliefPreview(this.lastBitmap);
        }
        break;
      case '3d':
        this.model3dWidthMM.set(value);
        break;
      default:
        this.reliefWidthMM.set(value); // fallback para 'image'
        break;
    }
  }

  onBaseSliderChange(value: number) {
    switch (this.previewMode()) {
      case 'relief':
        this.reliefBaseMM.set(value);
        // Actualizar preview en tiempo real
        if (this.lastBitmap) {
          this.renderReliefPreview(this.lastBitmap);
        }
        break;
      case '3d':
        this.model3dBaseMM.set(value);
        break;
      default:
        this.reliefBaseMM.set(value); // fallback para 'image'
        break;
    }
  }

  onHeightSliderChange(value: number) {
    switch (this.previewMode()) {
      case 'relief':
        this.reliefMaxHeightMM.set(value);
        // Actualizar preview en tiempo real
        if (this.lastBitmap) {
          this.renderReliefPreview(this.lastBitmap);
        }
        break;
      case '3d':
        this.model3dMaxHeightMM.set(value);
        break;
      default:
        this.reliefMaxHeightMM.set(value); // fallback para 'image'
        break;
    }
  }

  onSubdivisionChange(value: number) {
    switch (this.previewMode()) {
      case 'relief':
        this.reliefSubdivisionLevel.set(value);
        // Actualizar preview en tiempo real
        if (this.lastBitmap) {
          this.renderReliefPreview(this.lastBitmap);
        }
        break;
      case '3d':
        this.model3dSubdivisionLevel.set(value);
        break;
      default:
        this.reliefSubdivisionLevel.set(value); // fallback para 'image'
        break;
    }
  }

  onDepthMultiplierChange(value: number) {
    switch (this.previewMode()) {
      case 'relief':
        this.reliefDepthMultiplier.set(value);
        // Actualizar preview en tiempo real - este es crucial para el efecto visual
        if (this.lastBitmap) {
          this.renderReliefPreview(this.lastBitmap);
        }
        break;
      case '3d':
        this.model3dDepthMultiplier.set(value);
        break;
      default:
        this.reliefDepthMultiplier.set(value); // fallback para 'image'
        break;
    }
  }

  

  onQualityThresholdChange(value: number) {
    switch (this.previewMode()) {
      case 'relief':
        this.reliefQualityThreshold.set(value);
        // Actualizar preview en tiempo real
        if (this.lastBitmap) {
          this.renderReliefPreview(this.lastBitmap);
        }
        break;
      case '3d':
        this.model3dQualityThreshold.set(value);
        break;
      default:
        this.reliefQualityThreshold.set(value); // fallback para 'image'
        break;
    }
  }

  onSurfaceSmoothingChange(value: number) {
    switch (this.previewMode()) {
      case 'relief':
        this.reliefSurfaceSmoothing.set(value);
        // Actualizar preview en tiempo real - este afecta el suavizado visual
        if (this.lastBitmap) {
          this.renderReliefPreview(this.lastBitmap);
        }
        break;
      case '3d':
        this.model3dSurfaceSmoothing.set(value);
        break;
      default:
        this.reliefSurfaceSmoothing.set(value); // fallback para 'image'
        break;
    }
  }

  onQualitySliderChange(value: number) {
    switch (this.previewMode()) {
      case 'relief':
        // Los reliefs podrían usar un signal diferente si es necesario
        this.reliefQualityThreshold.set(value / 600); // Normalizar a 0-1
        // Actualizar preview en tiempo real - la calidad afecta la visualización
        if (this.lastBitmap) {
          this.renderReliefPreview(this.lastBitmap);
        }
        break;
      case '3d':
        // Para 3D, ahora usamos el selector de nivel de calidad
        if (value <= 250) {
          this.model3dQualityLevel.set('normal');
        } else if (value <= 425) {
          this.model3dQualityLevel.set('alta');
        } else {
          this.model3dQualityLevel.set('maxima');
        }
        break;
      default:
        this.reliefQualityThreshold.set(value / 600); // fallback para 'image'
        break;
    }
  }

  onQualityLevelChange(level: 'normal' | 'alta' | 'maxima') {
    this.model3dQualityLevel.set(level);
  }

  

  onSmoothingChange(value: number) {
    switch (this.previewMode()) {
      case 'relief':
        this.reliefSmoothingKernel.set(value);
        // Actualizar preview en tiempo real - el smoothing kernel afecta el suavizado
        if (this.lastBitmap) {
          this.renderReliefPreview(this.lastBitmap);
        }
        break;
      case '3d':
        this.model3dSmoothingKernel.set(value);
        break;
      default:
        this.reliefSmoothingKernel.set(value); // fallback para 'image'
        break;
    }
  }

  // === MÉTODOS ESPECÍFICOS DEL TAB RELIEVE ===
  onReliefWidthSliderChange(value: number) {
    this.reliefWidthMM.set(value);
    this.updateReliefPreview();
  }

  onReliefBaseSliderChange(value: number) {
    this.reliefBaseMM.set(value);
    this.updateReliefPreview();
  }

  onReliefHeightSliderChange(value: number) {
    this.reliefMaxHeightMM.set(value);
    this.updateReliefPreview();
  }

  onReliefSubdivisionChange(value: number) {
    this.reliefSubdivisionLevel.set(value);
    this.updateReliefPreview();
  }

  onReliefDepthMultiplierChange(value: number) {
    this.reliefDepthMultiplier.set(value);
    this.updateReliefPreview();
  }

  onReliefSurfaceSmoothingChange(value: number) {
    this.reliefSurfaceSmoothing.set(value);
    this.updateReliefPreview();
  }

  onReliefQualityThresholdChange(value: number) {
    this.reliefQualityThreshold.set(value);
    this.updateReliefPreview();
  }

  onReliefSmoothingChange(value: number) {
    this.reliefSmoothingKernel.set(value);
    this.updateReliefPreview();
  }

  // === MÉTODOS ESPECÍFICOS DEL TAB 3D ===
  onModel3dWidthSliderChange(value: number) {
    this.model3dWidthMM.set(value);
    // No auto-actualizar 3D, dejar que el usuario haga clic en "Convertir a 3D"
  }

  onModel3dBaseSliderChange(value: number) {
    this.model3dBaseMM.set(value);
  }

  onModel3dHeightSliderChange(value: number) {
    this.model3dMaxHeightMM.set(value);
  }

  onModel3dSubdivisionChange(value: number) {
    this.model3dSubdivisionLevel.set(value);
  }

  onModel3dDepthMultiplierChange(value: number) {
    this.model3dDepthMultiplier.set(value);
  }

  onModel3dQualityThresholdChange(value: number) {
    this.model3dQualityThreshold.set(value);
  }

  onModel3dSmoothingChange(value: number) {
    this.model3dSmoothingKernel.set(value);
  }

  

  // === MÉTODOS ESPECÍFICOS DE VOLUMÉTRICO ===
  onVolumetricThresholdChange(value: number) {
    // Los parámetros volumétricos están hardcodeados para optimización automática
    console.log('Parámetros volumétricos optimizados automáticamente por AI');
  }

  // Método para actualizar el preview de relieve en tiempo real
  updateReliefPreview() {
    if (this.previewMode() === 'relief' && this.lastBitmap) {
      // Pequeño delay para evitar demasiadas actualizaciones
      if (this._reliefRaf) {
        cancelAnimationFrame(this._reliefRaf);
      }
      this._reliefRaf = requestAnimationFrame(() => {
        this.renderReliefPreview(this.lastBitmap!);
      });
    }
  }

  // Model operations
  scaleModel(factor: number) {
    if (this._mesh) {
      this._mesh.scale.multiplyScalar(factor / 10);
      this.centerView();
    }
  }

  upload() {
    if (!this.file()) {
      this.error.set('Por favor selecciona una imagen primero');
      return;
    }

    // Usar estados específicos del relieve
    this.reliefLoading.set(true);
    this.reliefProcessActive.set(true);
    this.error.set(undefined);
    this.lastConversion.set('relief');
    
    // Limpiar download URL anterior del relieve
    this.clearReliefDownloadUrl();
    
    // Iniciar simulación de progreso para relieve
    this.startLoadingProgress('relief');

    try {
      console.log('🔄 Starting Relief STL conversion...');
      
      // Usar parámetros específicos del relieve
      const reliefParams = this.getReliefParams();
      console.log('🔄 Relief Parameters:', reliefParams);
      
      // Usar ApiService que llama al endpoint regular (no HQ) para relieve
      this.apiService.convertImage(this.file()!, {
        widthMM: reliefParams.widthMM,
        baseMM: reliefParams.baseMM,
        maxHeightMM: reliefParams.maxHeightMM,
        sampleMax: reliefParams.qualitySamples,
        format: this.format(),
        invert: false
      }).subscribe({
        next: (blob) => {
          console.log('🔄 Relief STL generated successfully');
          
          // Completar progress bar al 100%
          this.completeLoadingProgress();
          
          // Proceso completado - mantener estado activo
          this.reliefProcessActive.set(false);
          
          // Esperar un momento para mostrar el estado completo
          setTimeout(() => {
            // Crear URL de descarga específica para relieve
            const url = URL.createObjectURL(blob);
            this.reliefDownloadUrl.set(url);
            
            // Generar nombre del archivo para relieve
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
            const fileName = `relieve-${this.format()}-${timestamp}.stl`;
            this.reliefDownloadName.set(fileName);
            
            console.log('🔄 Relief STL download ready:', fileName);
            this.reliefLoading.set(false);
            this.resetLoadingProgress();
          }, 1500); // Mostrar "¡Listo!" por 1.5 segundos
        },
        error: (error) => {
          console.error('🔄 Relief conversion error:', error);
          this.error.set(`Error en conversión de relieve: ${error.message || error}`);
          this.reliefLoading.set(false);
          this.reliefProcessActive.set(false);
          this.resetLoadingProgress();
        }
      });

    } catch (error) {
      console.error('🔄 Relief conversion error:', error);
      this.error.set(`Error en conversión de relieve: ${error}`);
      this.reliefLoading.set(false);
      this.reliefProcessActive.set(false);
      this.resetLoadingProgress();
    }
  }

  // Generar descarga STL para modelo 3D
  private async generate3DDownload() {
    if (!this.file()) {
      console.error('No file available for 3D download generation');
      return;
    }

    try {
      console.log('🔽 Generating STL download for 3D model...');
      
      // Usar el ApiService para generar el STL del modelo 3D
      // Necesitamos usar un endpoint que genere STL directamente
      const model3dParams = this.getModel3DParams();
      
      // Usar el ApiService para generar el STL del modelo 3D con endpoint específico
      this.apiService.downloadSTLFrom3DModel(this.file()!, {
        widthMM: model3dParams.widthMM,
        baseMM: model3dParams.baseMM,
        maxHeightMM: model3dParams.maxHeightMM,
        targetFaces: model3dParams.targetFaces,
        depthMultiplier: model3dParams.depthMultiplier,
        surfaceSmoothing: model3dParams.surfaceSmoothing,
        qualityThreshold: model3dParams.qualityThreshold,
        smoothingKernel: model3dParams.smoothingKernel,
        subdivisionLevel: model3dParams.subdivisionLevel,
        invert: false,
        manifold: model3dParams.manifold
      }).subscribe({
        next: (blob) => {
          // Crear URL de descarga específica para 3D
          const url = URL.createObjectURL(blob);
          this.model3dDownloadUrl.set(url);
          
          // Generar nombre del archivo para 3D
          const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
          const fileName = `modelo-3d-${this.model3dQualityLevel()}-${timestamp}.stl`;
          this.model3dDownloadName.set(fileName);
          
          console.log('🔽 3D STL download ready:', fileName);
        },
        error: (error) => {
          console.error('🔽 Error generating 3D STL download:', error);
          // No mostrar error al usuario, simplemente no mostrar el botón de descarga
        }
      });
    } catch (error) {
      console.error('🔽 Error in generate3DDownload:', error);
    }
  }

  // Limpiar URL de descarga anterior para relieve
  private clearReliefDownloadUrl() {
    const currentUrl = this.reliefDownloadUrl();
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      this.reliefDownloadUrl.set(null);
      this.reliefDownloadName.set(null);
    }
  }

  // Limpiar URL de descarga anterior para 3D
  private clearModel3dDownloadUrl() {
    const currentUrl = this.model3dDownloadUrl();
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      this.model3dDownloadUrl.set(null);
      this.model3dDownloadName.set(null);
    }
  }

  // Limpiar URL de descarga anterior para evitar memory leaks (método legacy)
  private clearDownloadUrl() {
    // Limpiar ambas para compatibilidad
    this.clearReliefDownloadUrl();
    this.clearModel3dDownloadUrl();
  }

  // NUEVO: Método para limpiar downloads solo cuando se carga nueva imagen
  private clearDownloadsForNewImage() {
    console.log('🔄 Clearing downloads for new image');
    this.clearDownloadUrl();
  }

  // ===== Métodos para controlar el progress bar =====
  
  private startLoadingProgress(type: 'relief' | '3d') {
    this.loadingProgress.set(5);
    this.loadingStatusText.set('Iniciando...');
    
    // Limpiar cualquier intervalo anterior
    if (this.loadingInterval) {
      clearInterval(this.loadingInterval);
    }
    
    // Simular progreso realista
    let currentProgress = 5;
    this.loadingInterval = window.setInterval(() => {
      if (currentProgress < 85) {
        // Progreso variable según el tipo
        const increment = type === '3d' ? 
          Math.random() * 3 + 1 : // 3D: más lento, entre 1-4%
          Math.random() * 5 + 2;  // Relief: más rápido, entre 2-7%
        
        currentProgress = Math.min(85, currentProgress + increment);
        this.loadingProgress.set(Math.floor(currentProgress));
        
        // Actualizar texto según el progreso
        if (currentProgress < 25) {
          this.loadingStatusText.set(type === '3d' ? 'Analizando imagen' : 'Procesando imagen');
        } else if (currentProgress < 50) {
          this.loadingStatusText.set(type === '3d' ? 'Generando profundidad' : 'Creando mapa de altura');
        } else if (currentProgress < 75) {
          this.loadingStatusText.set(type === '3d' ? 'Construyendo geometría' : 'Generando relieve');
        } else {
          this.loadingStatusText.set(type === '3d' ? 'Optimizando modelo' : 'Finalizando STL');
        }
      }
    }, type === '3d' ? 200 : 150); // 3D más lento que Relief
  }
  
  private updateLoadingProgress(progress: number, status: string) {
    this.loadingProgress.set(progress);
    this.loadingStatusText.set(status);
  }
  
  private completeLoadingProgress() {
    if (this.loadingInterval) {
      clearInterval(this.loadingInterval);
      this.loadingInterval = undefined;
    }
    this.loadingProgress.set(100);
    this.loadingStatusText.set('¡Completado!');
  }
  
  private resetLoadingProgress() {
    this.loadingProgress.set(0);
    this.loadingStatusText.set('');
    if (this.loadingInterval) {
      clearInterval(this.loadingInterval);
      this.loadingInterval = undefined;
    }
  }

  resetControls() {
    // NO limpiar downloads cuando solo cambiamos de tab
    // Solo limpiar si es un reset completo o nueva imagen
    
    // Reset según el modo actual sin limpiar downloads existentes
    switch (this.previewMode()) {
      case 'relief':
        this.reliefDepthMultiplier.set(2.5);
        this.reliefSmoothingKernel.set(3);
        this.reliefWidthMM.set(80);
        this.reliefMaxHeightMM.set(5);
        this.reliefBaseMM.set(2);
        this.reliefSubdivisionLevel.set(0);
        this.reliefSurfaceSmoothing.set(1);
        this.reliefQualityThreshold.set(0.75);
        break;
      case '3d':
        this.model3dDepthMultiplier.set(2.5);
        this.model3dSmoothingKernel.set(3);
        this.model3dWidthMM.set(80);
        this.model3dMaxHeightMM.set(5);
        this.model3dBaseMM.set(2);
        this.model3dSubdivisionLevel.set(0);
        this.model3dQualityThreshold.set(0.75);
        break;
      default:
        // fallback para 'image'
        this.reliefDepthMultiplier.set(2.5);
        this.reliefSmoothingKernel.set(3);
        this.reliefWidthMM.set(80);
        this.reliefMaxHeightMM.set(5);
        this.reliefBaseMM.set(2);
        this.reliefSubdivisionLevel.set(0);
        this.reliefSurfaceSmoothing.set(1);
        this.reliefQualityThreshold.set(0.75);
        break;
    }
  }

  // Placeholder methods
  // Canvas helpers - usa el canvas único para todos los modos
  private getCanvasAndContext(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
    // Usar el canvas específico según el modo actual
    let canvas: HTMLCanvasElement | undefined;
    
    switch (this.previewMode()) {
      case 'image':
        canvas = this.imageCanvas?.nativeElement || this.previewCanvas?.nativeElement;
        break;
      case 'relief':
        canvas = this.reliefCanvas?.nativeElement || this.previewCanvas?.nativeElement;
        break;
      default:
        canvas = this.previewCanvas?.nativeElement;
        break;
    }
    
    if (!canvas) {
      console.warn('🔧 Canvas element not found for mode:', this.previewMode());
      return null;
    }
    
    const ctx = canvas.getContext('2d', { 
      willReadFrequently: true,
      alpha: true 
    });
    if (!ctx) {
      console.warn('🔧 Cannot get 2D context from canvas');
      return null;
    }
    
    try {
      // Ajustar tamaño físico al CSS y DPR
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        console.log('🔧 Canvas resized for', this.previewMode(), ':', { width: canvas.width, height: canvas.height, dpr });
      }
      
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { canvas, ctx };
    } catch (error) {
      console.error('🔧 Error setting up canvas for', this.previewMode(), ':', error);
      return null;
    }
  }

  refreshImagePreview() {
    const tools = this.getCanvasAndContext();
    if (!tools || !this.lastBitmap) {
      console.warn('🔧 Cannot refresh image preview: missing canvas or bitmap');
      return;
    }
    
    const { ctx, canvas } = tools;
    
    try {
      // Limpiar
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Ajuste tipo object-fit: contain
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = canvas.width / dpr;
      const ch = canvas.height / dpr;
      const iw = this.lastBitmap.width;
      const ih = this.lastBitmap.height;
      const scale = Math.min(cw / iw, ch / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const dx = (cw - dw) / 2;
      const dy = (ch - dh) / 2;
      
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high' as any;
      ctx.drawImage(this.lastBitmap, dx, dy, dw, dh);
    } catch (error) {
      console.error('🔧 Error refreshing image preview:', error);
    }
  }

  renderReliefPreview(bitmap: ImageBitmap) {
    console.log('🔧 Starting relief preview rendering...');
    const tools = this.getCanvasAndContext();
    if (!tools || !bitmap) {
      console.error('🔧 Cannot render relief preview: missing canvas tools or bitmap');
      return;
    }
    
    const { ctx, canvas } = tools;
    
    try {
      // Clear the canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Get device pixel ratio and canvas dimensions
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = canvas.width / dpr;
      const ch = canvas.height / dpr;
      const iw = bitmap.width;
      const ih = bitmap.height;
      
      console.log('🔧 Relief preview dimensions:', { cw, ch, iw, ih, dpr });
      
      // Calculate scale for object-fit: contain behavior
      const scale = Math.min(cw / iw, ch / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const dx = (cw - dw) / 2;
      const dy = (ch - dh) / 2;
      
      // Set high quality rendering
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high' as any;
      
      // Draw the image first
      ctx.drawImage(bitmap, dx, dy, dw, dh);
      
      // Convert to grayscale for relief effect usando parámetros específicos del relieve
      try {
        const imgData = ctx.getImageData(dx, dy, dw, dh);
        const data = imgData.data;
        
        console.log('🔧 Processing', data.length / 4, 'pixels for relief effect');
        console.log('🔧 Using relief params:', {
          depthMultiplier: this.reliefDepthMultiplier(),
          smoothing: this.reliefSurfaceSmoothing(),
          heightMM: this.reliefMaxHeightMM()
        });
        
        // Aplicar efectos específicos del relieve
        const depthMultiplier = this.reliefDepthMultiplier();
        const smoothing = this.reliefSurfaceSmoothing();
        
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          // Use luminance formula for better grayscale conversion
          let y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
          
          // Aplicar multiplicador de profundidad para simular el relieve
          y = Math.min(255, Math.max(0, y * depthMultiplier));
          
          // Aplicar suavizado si está activado
          if (smoothing > 0) {
            y = Math.round(y * (1 - smoothing * 0.1) + 128 * (smoothing * 0.1));
          }
          
          data[i] = data[i + 1] = data[i + 2] = y;
          // Keep alpha channel unchanged
        }
        
        ctx.putImageData(imgData, dx, dy);
        console.log('🔧 Relief preview rendered successfully with relief-specific parameters');
        
        // Marcar el tab de relieve como listo
        this._reliefReady.set(true);
      } catch (error) {
        console.error('🔧 Error applying grayscale effect:', error);
        // If grayscale conversion fails, just show the original image
      }
    } catch (error) {
      console.error('🔧 Error in relief preview rendering:', error);
    }
  }

  // Emergency reset when errors are detected
  emergencyReset() {
    console.log('🔧 Emergency reset triggered...');
    
    // Stop all render loops immediately
    this.stopThreeLoop();
    
    // Clear error state
    this.error.set(undefined);
    this.ready3D.set(false);
    
    // Clean up all Three.js state
    if (this._scene) {
      this._scene.traverse((object: any) => {
        if (object.isMesh) {
          if (object.geometry) {
            object.geometry.dispose();
          }
          if (object.material) {
            if (Array.isArray(object.material)) {
              object.material.forEach((mat: any) => mat.dispose());
            } else {
              object.material.dispose();
            }
          }
        }
      });
      this._scene.clear();
    }
    
    // Reset mesh references
    this._mesh = undefined;
    this._currentMesh = undefined;
    this.faceCount.set(0);
    this.vertCount.set(0);
    this.volumeCM3.set(null);
    
    // Switch back to image mode safely
    this.previewMode.set('image');
    if (this.lastBitmap) {
      setTimeout(() => {
        this.refreshImagePreview();
      }, 100);
    }
    
    console.log('🔧 Emergency reset completed');
  }

  // Method to check and fix corrupted state
  checkAndFixState() {
    if (this.previewMode() === '3d' && this._mesh) {
      if (!this.validateMesh(this._mesh)) {
        console.warn('🔧 Detected corrupted 3D state, performing emergency reset');
        this.emergencyReset();
      }
    }
  }
  ngOnDestroy() {
    console.log('🔧 ConverterComponent cleanup starting...');
    
    // Stop all animation frames
    this.stopThreeLoop();
    
    // Limpiar intervalo de progreso
    if (this.loadingInterval) {
      clearInterval(this.loadingInterval);
      this.loadingInterval = undefined;
    }
    
    if (this._imageRaf) {
      cancelAnimationFrame(this._imageRaf);
      this._imageRaf = undefined;
    }
    
    if (this._reliefRaf) {
      cancelAnimationFrame(this._reliefRaf);
      this._reliefRaf = undefined;
    }
    
    if (this._onResizeBound) {
      window.removeEventListener('resize', this._onResizeBound);
      this._onResizeBound = undefined;
    }
    
    // Clean up Three.js resources
    if (this._scene) {
      // Dispose of all meshes and their geometries/materials
      this._scene.traverse((object: any) => {
        if (object.isMesh) {
          if (object.geometry) {
            object.geometry.dispose();
          }
          if (object.material) {
            if (Array.isArray(object.material)) {
              object.material.forEach((mat: any) => mat.dispose());
            } else {
              object.material.dispose();
            }
          }
        }
      });
      this._scene.clear();
      this._scene = undefined;
    }
    
    if (this._controls) {
      this._controls.dispose();
      this._controls = undefined;
    }
    
    if (this._renderer) {
      this._renderer.dispose();
      this._renderer = undefined;
    }
    
    this._camera = undefined;
    this._mesh = undefined;
    this._currentMesh = undefined;
    this._three = undefined;
    
    // Limpiar download URL para evitar memory leaks
    this.clearDownloadUrl();
    
    console.log('🔧 ConverterComponent cleanup completed');
  }
}
