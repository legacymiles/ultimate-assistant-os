"""What each job actually does.

`engines.py` knows how to reach a model; this file knows what a request
means: where the audio goes, which artifacts are worth keeping, what shape
the result dict has. The server module does HTTP and nothing else, so the
contract the website is written against is visible in one place — here and in
the route table.

Every result is real output from a model or from ffmpeg. There is no
placeholder audio anywhere in this server: if a model is missing the job
errors and says which one, and if a capability is missing the endpoint
returns 501.
"""

from __future__ import annotations

import logging
import os
import uuid

import audio
from common import guess_audio_ext, strip_chords
from storage import FileStore, VoiceStore

log = logging.getLogger("music.tasks")


class Runner:
    def __init__(self, args, engines, files: FileStore, voices: VoiceStore):
        self.args = args
        self.engines = engines
        self.files = files
        self.voices = voices
        self.data_dir = args.data_dir
        self.uploads_dir = os.path.join(self.data_dir, "uploads")
        self.songs_dir = os.path.join(self.data_dir, "songs")
        self.scores_dir = os.path.join(self.data_dir, "scores")
        for path in (self.uploads_dir, self.songs_dir, self.scores_dir):
            os.makedirs(path, exist_ok=True)

    # --- helpers ---------------------------------------------------------

    def write_upload(self, data: bytes, filename: str | None = None) -> str:
        """Put an uploaded blob on disk under its real container extension."""
        ext = guess_audio_ext(data, filename)
        path = os.path.join(self.uploads_dir, uuid.uuid4().hex[:16] + ext)
        with open(path, "wb") as handle:
            handle.write(data)
        return path

    def _register(self, path: str, name: str, kind: str = "audio") -> str:
        return self.files.add(path, name=name, kind=kind)

    @staticmethod
    def _probe(path: str) -> dict:
        probed = audio.probe(path)
        return {"duration_s": probed["duration_s"], "sample_rate": probed["sample_rate"]}

    # --- jobs -------------------------------------------------------------

    def song(self, job) -> dict:
        """YuE2. Minutes of GPU work; the job record is the only progress there is."""
        request = job.params["request"]
        out_dir = os.path.join(self.songs_dir, job.id)
        out = self.engines.song(request, out_dir, job.report, timeout=self.args.job_timeout)

        job.report("registering artifacts", 0.95)
        audio_path = out["audio_path"]
        file_id = self._register(audio_path, name=f"{request['id']}.flac")
        artifacts = {
            name: self._register(path, name=f"{request['id']}-{name}",
                                 kind="artifact" if not name.endswith(".flac") else "audio")
            for name, path in out.get("artifacts", {}).items()
            if path != audio_path
        }
        return {
            "file_id": file_id,
            "filename": f"{request['id']}.flac",
            "content_type": "audio/flac",
            **self._probe(audio_path),
            "id": request["id"],
            "seed": request["seed"],
            "cot": request["cot"],
            "cfg_scale": request.get("cfg_scale"),
            "used_abc": "abc" in request,
            "truncated": out.get("truncated"),
            "abc": out.get("abc"),
            "plan": out.get("plan"),
            "result": out.get("result"),
            "artifact_file_ids": artifacts,
            "out_dir": out.get("out_dir"),
        }

    def transcribe(self, job) -> dict:
        """SheetSage2 → ABC, plus the chord-stripped score for the cover path."""
        source = job.params["audio_path"]
        out_dir = os.path.join(self.scores_dir, job.id)
        out = self.engines.transcribe(source, out_dir, job.params.get("melody_only", True),
                                      job.report, timeout=self.args.job_timeout)
        abc = out.get("abc") or ""
        stripped = strip_chords(abc)

        job.report("writing score", 0.95)
        abc_path = os.path.join(out_dir, "score.abc")
        with open(abc_path, "w", encoding="utf-8") as handle:
            handle.write(abc)
        stripped_path = os.path.join(out_dir, "score-melody.abc")
        with open(stripped_path, "w", encoding="utf-8") as handle:
            handle.write(stripped)

        warnings = out.get("warnings")
        if warnings is None:
            warnings = []
        elif not isinstance(warnings, list):
            warnings = [str(warnings)]
        return {
            "abc": abc,
            "stripped_abc": stripped,
            "warnings": warnings,
            "abc_error": out.get("abc_error"),
            "melody_only": out.get("melody_only"),
            "abc_file_id": self._register(abc_path, name="score.abc", kind="score"),
            "stripped_abc_file_id": self._register(stripped_path, name="score-melody.abc", kind="score"),
        }

    def speak(self, job) -> dict:
        """AuK. Speech in a cloned voice — never singing; see workers/auk_worker.py."""
        spec = dict(job.params)
        file_id, out_path = self.files.path_for(".wav")
        spec["out_path"] = out_path
        out = self.engines.speak(spec, job.report, timeout=self.args.job_timeout)

        written = out.get("audio_path") or out_path
        self.files.register(file_id, written, name="speech.wav")
        probed = self._probe(written)
        return {
            "file_id": file_id,
            "filename": "speech.wav",
            "content_type": "audio/wav",
            "sample_rate": out.get("sample_rate") or probed["sample_rate"],
            "duration_s": out.get("duration_s") or probed["duration_s"],
            "voice_ref_id": job.params.get("voice_ref_id"),
            "flash": bool(job.params.get("flash")),
            "gen_seconds": job.params.get("gen_seconds"),
            "prompt": out.get("prompt"),
            "warnings": out.get("warnings") or [],
        }

    def separate(self, job) -> dict:
        """AuK's source separation, when the installed build has it."""
        spec = dict(job.params)
        file_id, out_path = self.files.path_for(".wav")
        spec["out_path"] = out_path
        out = self.engines.separate(spec, job.report, timeout=self.args.job_timeout)

        written = out.get("audio_path") or out_path
        name = f"{spec.get('mode', 'stem')}.wav"
        self.files.register(file_id, written, name=name)
        return {
            "file_id": file_id,
            "filename": name,
            "content_type": "audio/wav",
            "mode": out.get("mode"),
            "method": out.get("method"),
            **self._probe(written),
            "warnings": out.get("warnings") or [],
        }

    # --- the one synchronous piece ---------------------------------------

    def mix(self, music_path: str, vocal_path: str, music_gain_db: float,
            vocal_gain_db: float, offset_s: float) -> dict:
        """ffmpeg, no GPU, so it does not go through the job queue.

        Worth being clear about what this is: two finished files laid on top
        of each other with gains and an offset. It is not stem-aware, it does
        not time-align anything, and it cannot make a spoken take land on the
        beat. It is the last step of "YuE2 wrote the music, AuK said the
        words, put them in one file".
        """
        file_id, out_path = self.files.path_for(".wav")
        audio.mix(music_path, vocal_path, out_path,
                  music_gain_db=music_gain_db, vocal_gain_db=vocal_gain_db, offset_s=offset_s)
        self.files.register(file_id, out_path, name="mix.wav")
        log.info(f"mixed {os.path.basename(music_path)} + {os.path.basename(vocal_path)} -> {file_id}")
        return {
            "file_id": file_id,
            "filename": "mix.wav",
            "content_type": "audio/wav",
            **self._probe(out_path),
            "music_gain_db": music_gain_db,
            "vocal_gain_db": vocal_gain_db,
            "offset_s": offset_s,
        }
