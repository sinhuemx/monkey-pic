# 🐵 Monkey Pic - Generador de Modelos 3D

Sistema avanzado de conversión de imágenes a modelos 3D volumétricos y relieves para impresión 3D.

## 🏗️ Arquitectura Limpia y Optimizada

```
monkey-pic/
├── 📁 backend/               ← Backend Deno con AI integrado
│   ├── ai3d/                ← Scripts Python para generación 3D
│   │   ├── .venv/           ← Entorno virtual Python
│   │   ├── volumetric_generator.py     ← Modelos 3D volumétricos
│   │   └── estimate_and_mesh_optimized.py ← Relieves 2.5D
│   ├── routes/              ← API endpoints
│   │   ├── hq.ts           ← Generación de relieves (2.5D)
│   │   └── model3d.ts      ← Generación volumétrica (3D)
│   └── services/            ← Lógica de negocio
├── 📁 frontend/             ← Frontend Angular 18+
│   └── src/app/converter/   ← Componente principal
└── 📁 archive/              ← Archivos de desarrollo archivados
```

## 🎯 Características Principales

### ✨ **Generación Volumétrica 3D**
- **Niveles de calidad**: Normal (128 voxels) → Alta (256 voxels) → Máxima (512 voxels)
- **Algoritmo**: Bilinear interpolation + Poisson surface reconstruction  
- **Resultado**: Modelos 3D verdaderamente volumétricos

### 🔧 **Relieves 2.5D Optimizados**
- **Calidad profesional** con parámetros ajustables
- **Algoritmo**: Depth estimation + mesh generation con Open3D
- **Formato**: STL/OBJ listo para impresión 3D

### 🖥️ **Interfaz Avanzada**
- **Estados independientes** por pestaña (Relieve/3D)
- **Preview en tiempo real** con Three.js
- **Escalado de calidad dinámico**

## 🚀 Inicio Rápido

### 1. **Backend (Deno + Python)**
```bash
cd backend
# Configurar Python AI3D
cd ai3d && source .venv/bin/activate
# Iniciar backend
deno run --allow-all mod.ts
```

### 2. **Frontend (Angular 18+)**
```bash
cd frontend
npm install
npm start
```

### 3. **Acceso**
- **Frontend**: http://localhost:4200
- **Backend API**: http://localhost:8000

## 🛠️ API Endpoints

| Endpoint | Propósito | Script Python |
|----------|-----------|---------------|
| `POST /api/model3d` | Modelos 3D volumétricos | `volumetric_generator.py` |
| `POST /api/hq` | Relieves 2.5D | `estimate_and_mesh_optimized.py` |

## 📊 Mejoras de Arquitectura

### ✅ **Antes vs Ahora**
- ❌ `monkey-pic/monkey-pic/scripts/ai3d/` (estructura duplicada)
- ✅ `monkey-pic/backend/ai3d/` (estructura limpia)

### ✅ **Beneficios**
- **Rutas simplificadas**: `./ai3d/.venv/bin/python`
- **Backend autocontenido**: Todo en un directorio
- **Deployment simplificado**: Sin dependencias externas
- **Desarrollo ágil**: Menos complejidad de rutas

## 🔬 Tecnologías

- **Frontend**: Angular 18+ con signals, Three.js, Carbon Design
- **Backend**: Deno, Oak router, TypeScript
- **AI/3D**: Python, Open3D, MiDaS, NumPy, OpenCV
- **Calidad**: ESLint, Prettier, Husky

---

**🎉 Arquitectura final optimizada y lista para producción**
