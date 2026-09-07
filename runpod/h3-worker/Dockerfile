# MiniMax H3 on RunPod Serverless.
#
# Built as a thin layer on RunPod's own ComfyUI worker image. That base
# already carries ComfyUI 0.34 (the first release line with native H3 nodes),
# PyTorch 2.11 on CUDA 12.8, and Python 3.12 in a venv at /opt/venv — so this
# image adds a handler and little else, and rebuilds are fast.
#
# What is deliberately NOT in here: the ~42 GB of model weights. They live on
# a RunPod network volume mounted at /runpod-volume, written once and then
# read by every worker in that datacenter. Baking them in would mean a 57 GB
# image pulled onto every fresh host.
#
# The base image ships its own handler for generic ComfyUI jobs; ours replaces
# it, because this worker takes a film-shot request rather than a raw graph.

FROM runpod/worker-comfyui:5.10.0-base

# ComfyUI lives at /comfyui in this base image.
ENV COMFY_DIR=/comfyui \
    H3_MODELS_DIR=/runpod-volume/models \
    PYTHONUNBUFFERED=1 \
    HF_HUB_ENABLE_HF_TRANSFER=1

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN /opt/venv/bin/python -m pip install --no-cache-dir -r /app/requirements.txt

COPY h3 /app/h3
COPY handler.py /app/handler.py

# Fail the build rather than the first paid render if the worker cannot even
# be imported. The GPU-dependent paths are not exercised here.
RUN /opt/venv/bin/python -c "import ast, pathlib; [ast.parse(p.read_text(encoding='utf-8')) for p in pathlib.Path('/app').rglob('*.py')]" \
 && /opt/venv/bin/python -c "import sys; sys.path.insert(0, '/app'); from h3.geometry import frames_for_seconds, canvas_for_aspect; assert frames_for_seconds(6) == 141; assert canvas_for_aspect('16:9') == (1344, 768); print('geometry OK')"

CMD ["/opt/venv/bin/python", "-u", "/app/handler.py"]
