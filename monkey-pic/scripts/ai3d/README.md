# AI 3D HQ (Python)
This folder contains the optional Python-based High Quality (HQ) mesh generator.
## Requirements
- Python 3.10 or 3.11 recommended.
  - Open3D wheels are not available for Python 3.13 on many platforms yet.
- pip/conda packages listed in `requirements.txt`.
- Optional: PyTorch to enable MiDaS depth (`--useMiDaS`).
## Quick setup (virtualenv + pip)
Works on platforms where `pip install open3d` provides wheels (e.g., Linux or macOS with supported Python):
```
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
If `open3d` fails to install: use a conda/mamba environment.
## macOS Apple Silicon (arm64) – recommended via conda-forge
1) Install Miniforge/Mambaforge (conda-forge) if you don't have it.
2) Create the env from the provided file:
```
mamba env create -f scripts/ai3d/environment.yml
conda activate monkey3d
3) Optional: enable MiDaS depth by installing PyTorch with MPS support:
```
mamba install -c conda-forge pytorch torchvision torchaudio
```
4) Test locally:
```
python scripts/ai3d/estimate_and_mesh.py \
  --input /path/to/image.jpg \
  --output /tmp/out.stl \
  --widthMM 120 --baseMM 1 --maxHeightMM 5 --format stl
```
## Wire backend
1) Copy `backend/.env.example` to `backend/.env`.
2) Set:
- `PYTHON_HQ_ENABLED=true`
- `PYTHON_CMD` to your env Python binary, for example:
  - virtualenv: `/absolute/path/to/scripts/ai3d/.venv/bin/python`
  - conda: `/absolute/path/to/miniforge3/envs/monkey3d/bin/python`
- `PYTHON_HQ_USE_MIDAS=true` (optional)
- `PYTORCH_DEVICE=cpu|mps|cuda` (optional; `mps` for Apple Silicon)
3) Start backend and use POST /api/convert-hq.
## Behavior and fallback
- The script outputs a watertight mesh with optional smoothing/decimation.
- Formats: stl, obj, glb (depending on installed libs).
- If the Python stage fails (spawn error, non-zero exit, missing output), the backend route now automatically falls back to the enhanced STL path so the request still succeeds.
## Troubleshooting
- open3d cannot be installed with pip on Python 3.13: create a Python 3.10/3.11 environment (conda recommended) and set `PYTHON_CMD` to that interpreter.
- MiDaS (PyTorch) is optional; if unavailable, leave `PYTHON_HQ_USE_MIDAS=false` and rely on the client-side ONNX depth or grayscale fallback.
High-Quality 3D Conversion (Python Pipeline)

This optional pipeline uses Python for depth estimation (MiDaS/DPT via PyTorch, optional) and mesh generation (Open3D). It outputs watertight STL/OBJ, with smoothing and decimation.

Quick start:
- Install Python 3.10+ and create a venv.
- pip install -r requirements.txt
- Set environment variables for backend (in backend/.env):
  - PYTHON_HQ_ENABLED=true
  - PYTHON_CMD=python3 (or your venv path)
  - PYTHON_HQ_SCRIPT=./scripts/ai3d/estimate_and_mesh.py
  - PYTHON_HQ_USE_MIDAS=true (optional)
  - PYTORCH_DEVICE=cpu|cuda|mps (optional)

Endpoint:
- POST /api/convert-hq (form-data: file, widthMM, baseMM, maxHeightMM, format=stl|glb|obj, invert=true|false)

Local usage:
```bash
python3 estimate_and_mesh.py \
  --input ./sample.jpg \
  --output ./out.stl \
  --widthMM 120 \
  --baseMM 1.0 \
  --maxHeightMM 5.0 \
  --format stl \
  --invert
```

Enable MiDaS depth:
```bash
python3 estimate_and_mesh.py \
  --input ./sample.jpg \
  --output ./out.stl \
  --widthMM 120 \
  --baseMM 1.0 \
  --maxHeightMM 5.0 \
  --format stl \
  --useMiDaS --device cpu
```

Notes:
- On Apple Silicon, install PyTorch with MPS support using the official instructions.
- If MiDaS is disabled, the script uses an OpenCV-based proxy depth with edge-guided sharpening.

High-poly targets and mesh quality:
- Use `--targetTris 400000` (default) to approach ~400k faces; the script adapts grid resolution to meet this target while preserving aspect ratio.
- The resulting mesh is watertight (top, bottom, sides) and smoothed with Taubin filtering to keep surfaces clean without shrinking volume too much.
- If the mesh is far under the target triangle count, a single Loop subdivision is applied to increase detail, maintaining clean topology.
