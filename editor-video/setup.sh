#!/bin/bash
# Prepara una carpeta de trabajo para editar: dependencias, modelos, tipografías y efectos. Es idempotente (saltea lo que ya está).
# uso: editor-video/setup.sh <carpeta-de-trabajo>      (después: export VIDEO_EDIT_ROOT=<carpeta-de-trabajo>)
set -e
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(mkdir -p "$1" && cd "$1" && pwd)
mkdir -p "$ROOT"/{work,build/overlay,build/edl,analysis,assets,dl/src,audio,models,videos}
cp -r "$HERE"/work/. "$ROOT"/work/; cp "$HERE"/build/overlay/runtime.js "$ROOT"/build/overlay/; cp -rn "$HERE"/videos/. "$ROOT"/videos/ 2>/dev/null || true
python3 -I -c "import faster_whisper, sherpa_onnx, onnxruntime, soundfile, cv2, scipy, torch, transformers" 2>/dev/null || \
  pip install -q faster-whisper sherpa-onnx onnxruntime soundfile opencv-python-headless scipy torch transformers
get() { [ -s "$2" ] || curl -sSL --fail --retry 3 -o "$2" "$1"; }
M="$ROOT/models"; mkdir -p "$M"/{fw-large-v3,mms_fa,rvm,parakeet}
for f in config.json model.bin preprocessor_config.json tokenizer.json vocabulary.json; do get "https://huggingface.co/Systran/faster-whisper-large-v3/resolve/main/$f" "$M/fw-large-v3/$f"; done
for f in config.json model.safetensors preprocessor_config.json special_tokens_map.json tokenizer_config.json vocab.json; do get "https://huggingface.co/MahmoudAshraf/mms-300m-1130-forced-aligner/resolve/main/$f" "$M/mms_fa/$f"; done
get "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_resnet50_fp32.onnx" "$M/rvm/rvm_resnet50_fp32.onnx"
if [ ! -d "$M/parakeet/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8" ]; then
  get "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2" "$M/parakeet/pk.tar.bz2" && tar -xjf "$M/parakeet/pk.tar.bz2" -C "$M/parakeet"
fi
[ -s "$ROOT/build/sfx/shimmer.wav" ] || python3 -I "$ROOT/work/sfx.py" "$ROOT/build/sfx"
[ -s "$ROOT/build/fonts/fonts.css" ] || python3 -I "$ROOT/work/fetch_fonts.py" "$ROOT/build/fonts"
echo "listo: export VIDEO_EDIT_ROOT=$ROOT"
