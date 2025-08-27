# Backend AI3D Scripts

## 🏗️ Arquitectura Mejorada

Los scripts de Python ahora están ubicados dentro del directorio `backend/` para mejor organización:

```
backend/
├── ai3d/                          ← Scripts Python integrados
│   ├── .venv/                     ← Entorno virtual Python
│   ├── volumetric_generator.py    ← Generación 3D volumétrica
│   ├── estimate_and_mesh_optimized.py ← Relieves 2.5D
│   ├── requirements.txt
│   └── environment.yml
├── services/
│   └── stl.service.ts            ← Ejecuta scripts con rutas limpias
└── routes/
    ├── model3d.ts                ← API 3D volumétrico
    └── hq.ts                     ← API relieves
```

## 🎯 Beneficios de la Nueva Estructura

### ✅ **Rutas Limpias**
- Antes: `../scripts/ai3d/.venv/bin/python ../scripts/ai3d/volumetric_generator.py`
- Ahora: `./ai3d/.venv/bin/python ai3d/volumetric_generator.py`

### ✅ **Mejor Organización**
- Todo el backend en un solo directorio
- Lógica Python integrada con lógica Deno
- Deployment más simple

### ✅ **Mantenimiento Simplificado**
- No más problemas de rutas relativas
- Backend completamente autocontenido
- Desarrollo más ágil

## 🔧 Scripts Disponibles

### 1. **volumetric_generator.py** - Modelos 3D Volumétricos
```bash
./ai3d/.venv/bin/python ai3d/volumetric_generator.py \
  --input image.png \
  --output model.obj \
  --quality maxima
```

### 2. **estimate_and_mesh_optimized.py** - Relieves 2.5D
```bash
./ai3d/.venv/bin/python ai3d/estimate_and_mesh_optimized.py \
  --input image.png \
  --output relief.obj \
  --widthMM 140
```

## 🚀 Integración con Backend

Los scripts se ejecutan automáticamente:
- **`POST /api/model3d`** → `volumetric_generator.py`
- **`POST /api/hq`** → `estimate_and_mesh_optimized.py`

**Arquitectura final optimizada y lista para producción.** 🎉
