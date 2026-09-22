"""Prueba de humo del pipeline con transcripción/selección/storage simulados y ffmpeg real."""
import shutil
import subprocess
from pathlib import Path

import pytest

from clipper_worker import pipeline
from clipper_worker.config import config

ffmpeg_missing = shutil.which("ffmpeg") is None


@pytest.fixture
def sample_video(tmp_path):
    out = tmp_path / "sample.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24",
         "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "70",
         "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", str(out)],
        check=True,
    )
    return out


class FakeDB:
    def __init__(self, video):
        self.video = video
        self.clips = []
        self.updates = []

    def get_video(self, vid):
        return dict(self.video)

    def update_video(self, vid, **fields):
        self.updates.append(fields)
        self.video.update(fields)

    def set_video_status(self, vid, status, detail=None):
        self.update_video(vid, status=status, status_detail=detail)

    def replace_clips(self, vid, clips):
        self.clips = [dict(c, id=f"clip-{i}", video_id=vid) for i, c in enumerate(clips)]
        return self.clips

    def update_clip(self, cid, **fields):
        for c in self.clips:
            if c["id"] == cid:
                c.update(fields)

    def get_preset(self, pid):
        return None


@pytest.mark.skipif(ffmpeg_missing, reason="requiere ffmpeg")
def test_process_video_end_to_end(tmp_path, sample_video, monkeypatch):
    monkeypatch.setattr(config, "WORK_DIR", tmp_path / "work")
    monkeypatch.setattr(config, "PREVIEW_PAD_S", 5)
    video = {"id": "vid-1", "source_type": "upload", "source_path": "sources/x.mp4", "title": None,
             "preset_id": "natural", "min_duration_s": 10, "max_duration_s": 30, "topics": "marcas nicho"}
    fake = FakeDB(video)
    for name in ("get_video", "update_video", "set_video_status", "replace_clips", "update_clip", "get_preset"):
        monkeypatch.setattr(pipeline.db, name, getattr(fake, name))
    monkeypatch.setattr(pipeline.sources, "acquire", lambda v, progress=None: (sample_video, "Video de prueba"))
    monkeypatch.setattr(pipeline.sources, "prune_cache", lambda **kw: None)

    words = []
    t = 0.0
    for i in range(150):
        tok = f"palabra{i}" + ("." if i % 9 == 8 else "")
        words.append({"t": tok, "s": round(t, 2), "e": round(t + 0.3, 2), "spk": 0})
        t += 0.4
    monkeypatch.setattr(pipeline, "transcribe", lambda audio: {"words": words, "language": "es", "provider": "fake"})

    def fake_select(sentences, words_, *, min_s, max_s, topics):
        assert topics == "marcas nicho" and min_s == 10 and max_s == 30
        return [{"start_s": 5.0, "end_s": 25.0, "title": "Uno", "hook": "h", "score": 9, "reason": "r"},
                {"start_s": 30.0, "end_s": 50.0, "title": "Dos", "hook": "h", "score": 7, "reason": "r"}]
    monkeypatch.setattr(pipeline, "select_moments", fake_select)

    uploaded = {}
    def fake_upload(local, path, content_type=None):
        uploaded[path] = Path(local).stat().st_size
        return path
    monkeypatch.setattr(pipeline.storage, "upload_file", fake_upload)

    pipeline.process_video({"video_id": "vid-1"})

    statuses = [u["status"] for u in fake.updates if "status" in u]
    assert statuses[:3] == ["downloading", "transcribing", "transcribing"]
    assert "selecting" in statuses and statuses[-1] == "ready"
    assert fake.video["duration_s"] == pytest.approx(70, abs=1)
    assert fake.video["title"] == "Video de prueba"
    assert len(fake.clips) == 2
    for c in fake.clips:
        assert c["preview_path"] == f"previews/{c['id']}.mp4" and uploaded[c["preview_path"]] > 1000
        assert c["thumb_path"] == f"thumbs/{c['id']}.jpg" and uploaded[c["thumb_path"]] > 500
        assert c["subtitles"] and c["subtitles"][0]["s"] == 0.0
    assert fake.clips[0]["preview_offset_s"] == 0.0   # 5 - 5 de padding
    assert fake.clips[1]["preview_offset_s"] == 25.0
    assert fake.video["status_detail"] is None
