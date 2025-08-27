#!/bin/bash

# Test script for optimized AI 3D pipeline
echo "🧪 Testing Optimized AI 3D Pipeline"
echo "===================================="

cd "/Users/carlossinhuegarciahernandez/Dev/sinhuemx/monkey-pic/monkey-pic/scripts/ai3d"

test_image="../../frontend/src/assets/cat.png"

# Test Normal Quality
echo "📊 Testing NORMAL Quality (150K triangles)..."
.venv/bin/python estimate_and_mesh_optimized.py \
  --input "$test_image" \
  --output "/tmp/test_normal.obj" \
  --widthMM 140 \
  --baseMM 4 \
  --maxHeightMM 22 \
  --targetTris 150000

echo ""
echo "📊 Testing ALTA Quality (350K triangles)..."
.venv/bin/python estimate_and_mesh_optimized.py \
  --input "$test_image" \
  --output "/tmp/test_alta.obj" \
  --widthMM 140 \
  --baseMM 4 \
  --maxHeightMM 28 \
  --targetTris 350000 \
  --debug "/tmp/debug_alta"

echo ""
echo "📊 Testing MÁXIMA Quality (500K triangles)..."
.venv/bin/python estimate_and_mesh_optimized.py \
  --input "$test_image" \
  --output "/tmp/test_maxima.obj" \
  --widthMM 140 \
  --baseMM 4 \
  --maxHeightMM 35 \
  --targetTris 500000 \
  --debug "/tmp/debug_maxima"

echo ""
echo "📁 Generated files:"
ls -lh /tmp/test_*.obj

echo ""
echo "🎯 Quality comparison:"
echo "Normal: $(grep -o 'Final mesh:.*' /tmp/test_normal_log.txt 2>/dev/null || echo 'Check manually')"
echo "Alta: $(grep -o 'Final mesh:.*' /tmp/test_alta_log.txt 2>/dev/null || echo 'Check manually')"
echo "Máxima: $(grep -o 'Final mesh:.*' /tmp/test_maxima_log.txt 2>/dev/null || echo 'Check manually')"

echo ""
echo "✅ Testing completed!"
