# Worker de Clipper: yt-dlp + ffmpeg + OpenCV + llamadas a las APIs.
# Un solo contenedor; se despliega en Railway o Render.
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    WORK_DIR=/data/clipper \
    FACE_MODEL_PATH=/opt/models/face_detection_yunet_2023mar.onnx

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg fonts-inter fonts-liberation fontconfig ca-certificates curl libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f

# Modelo de detección de rostros (YuNet, ~230 KB). Si la descarga falla, el
# worker cae a Haar cascade (incluido en OpenCV), con peor precisión.
RUN mkdir -p /opt/models \
 && (curl -fsSL -o /opt/models/face_detection_yunet_2023mar.onnx \
      https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx \
     && [ "$(stat -c %s /opt/models/face_detection_yunet_2023mar.onnx)" -gt 100000 ] \
     || { echo "aviso: no se pudo bajar YuNet, se usará Haar cascade"; rm -f /opt/models/face_detection_yunet_2023mar.onnx; })

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY clipper_worker ./clipper_worker

VOLUME ["/data/clipper"]
CMD ["python", "-m", "clipper_worker.main"]
