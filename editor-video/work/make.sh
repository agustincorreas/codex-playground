#!/bin/bash
# usage: make.sh <projdir> [crf] [preset]   -> full pipeline: audio, overlays (front/back), final render
set -e
S=${VIDEO_EDIT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}   # working folder (holds work/, build/, analysis/, assets/, dl/, models/)
P=$(realpath $1); CRF=${2:-16}; PRESET=${3:-slow}
N=$(python3 -I -c "import json;p=json.load(open('$P/project.json'));print(int(round(p['duration']*p['fps'])))")
echo "== recuadros"; (cd $S/work && node overflow_check.js $P/overlay/index.html)     # ningún texto fuera de su caja: si falla, no se renderiza
echo "== audio"; python3 -I $S/work/audio_build.py $P/project.json $P/audio
echo "== overlays ($N frames)"; rm -rf $P/ov_front $P/ov_back
cd $S/work
node overlay_render.js "$P/overlay/index.html?layer=front" $P/ov_front $N 30 0 $N 3 | tail -2
node overlay_render.js "$P/overlay/index.html?layer=back" $P/ov_back $N 30 0 $N 2 | tail -1
echo "== render"; python3 -I $S/work/render.py $P/project.json $P/out.mp4 --crf $CRF --preset $PRESET | tail -2
ffprobe -v error -show_entries format=duration,size,bit_rate:stream=codec_name,width,height,nb_frames -of default=nw=1 $P/out.mp4
