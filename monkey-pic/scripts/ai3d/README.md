High-Quality 3D Conversion (Python Pipeline)

This optional pipeline uses Python for depth estimation (MiDaS/DPT) and mesh generation (Open3D/PyMeshLab).

Quick start:
- Install Python 3.10+ and create a venv.
- pip install -r requirements.txt
- Set environment variables for backend:
  - PYTHON_HQ_ENABLED=true
  - PYTHON_CMD=python3 (or your venv path)
  - PYTHON_HQ_SCRIPT=absolute path to estimate_and_mesh.py (optional)

Endpoint:
- POST /api/convert-hq (form-data: file, widthMM, baseMM, maxHeightMM, format=stl|glb|obj)

Notes:
- This repo includes a stub script that simply converts to a basic heightfield STL. Replace with MiDaS + Open3D for best quality.
