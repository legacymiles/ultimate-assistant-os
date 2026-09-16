"""Everything this server does to audio that is not a model: probing a file,
converting an upload to the wav the speech model wants, and mixing a vocal
take onto a backing track.

All of it is ffmpeg through subprocess. There is no DSP in this file and no
numpy dependency for it, because ffmpeg is already a hard requirement of the
SheetSage2 environment (it wants 6.1) and shelling out keeps the sample-rate
conversion, the decoding of whatever container the browser sent, and the mix
in one well-tested tool instead of three half-written ones.

If ffmpeg is missing, every function here raises with a message that says so.
Nothing silently degrades: a mix without ffmpeg is not a mix.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import wave

log = logging.getLogger("music.audio")


class FfmpegMissing(RuntimeError):
    pass


def ffmpeg_path() -> str | None:
    return shutil.which("ffmpeg")


def ffprobe_path() -> str | None:
    return shutil.which("ffprobe")


def _ffmpeg() -> str:
    exe = ffmpeg_path()
    if not exe:
        raise FfmpegMissing(
            "ffmpeg is not on PATH. It is needed to decode uploads, resample voice "
            "references and mix tracks. Install it (apt install ffmpeg, or the 6.1 "
            "build the SheetSage2 environment wants) and restart the server."
        )
    return exe


def run(args: list[str], timeout: int = 900) -> subprocess.CompletedProcess:
    """Run a command, raising with the tail of stderr when it fails.

    ffmpeg writes its banner and progress to stderr even on success, so the
    error message keeps only the last few lines — enough to see "Invalid data
    found when processing input" without pasting a page of build flags.
    """
    proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        tail = "\n".join((proc.stderr or "").strip().splitlines()[-6:])
        raise RuntimeError(f"{os.path.basename(args[0])} failed (exit {proc.returncode}): {tail}")
    return proc


def probe(path: str) -> dict:
    """{duration_s, sample_rate, channels, codec} — values are None if unknown.

    ffprobe first; if it is not installed we can still read a plain wav header
    with the standard library, which covers the common case of a browser that
    recorded straight to wav. Anything else stays None rather than guessed.
    """
    out = {"duration_s": None, "sample_rate": None, "channels": None, "codec": None}
    exe = ffprobe_path()
    if exe:
        try:
            proc = run([
                exe, "-v", "error", "-select_streams", "a:0",
                "-show_entries", "stream=sample_rate,channels,codec_name:format=duration",
                "-of", "json", path,
            ], timeout=60)
            data = json.loads(proc.stdout or "{}")
            stream = (data.get("streams") or [{}])[0]
            fmt = data.get("format") or {}
            if stream.get("sample_rate"):
                out["sample_rate"] = int(stream["sample_rate"])
            if stream.get("channels") is not None:
                out["channels"] = int(stream["channels"])
            out["codec"] = stream.get("codec_name")
            if fmt.get("duration"):
                out["duration_s"] = round(float(fmt["duration"]), 3)
            return out
        except Exception as exc:
            log.debug(f"ffprobe failed on {path}: {exc}")
    try:
        with wave.open(path, "rb") as handle:
            rate = handle.getframerate()
            out["sample_rate"] = rate
            out["channels"] = handle.getnchannels()
            out["codec"] = "pcm"
            if rate:
                out["duration_s"] = round(handle.getnframes() / float(rate), 3)
    except Exception:
        pass
    return out


def to_wav(src: str, dst: str, sample_rate: int = 16000, mono: bool = True) -> str:
    """Decode anything ffmpeg understands into 16-bit PCM wav."""
    args = [_ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", "-i", src,
            "-vn", "-acodec", "pcm_s16le", "-ar", str(sample_rate)]
    if mono:
        args += ["-ac", "1"]
    args.append(dst)
    run(args)
    return dst


def mix(music: str, vocal: str, dst: str,
        music_gain_db: float = 0.0, vocal_gain_db: float = 0.0, offset_s: float = 0.0) -> str:
    """Lay a vocal over a backing track and write a wav.

    offset_s > 0 delays the vocal, offset_s < 0 delays the music (there is no
    such thing as a negative delay, so a negative offset means "the vocal is
    early", which is the same as starting the music later).

    amix is used with normalize=0 on purpose. The default normalisation
    divides every input by the number of inputs, which quietly drops both
    tracks by 6 dB and makes the result sound wrong compared to the stems;
    with it off, the gains the caller asked for are the gains they get, and
    clipping is theirs to avoid.
    """
    delay_ms = int(round(abs(offset_s) * 1000))
    music_chain = [f"volume={music_gain_db}dB"]
    vocal_chain = [f"volume={vocal_gain_db}dB"]
    if delay_ms:
        if offset_s > 0:
            vocal_chain.insert(0, f"adelay={delay_ms}:all=1")
        else:
            music_chain.insert(0, f"adelay={delay_ms}:all=1")
    graph = (
        "[0:a]" + ",".join(music_chain) + "[m];"
        "[1:a]" + ",".join(vocal_chain) + "[v];"
        "[m][v]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[out]"
    )
    run([_ffmpeg(), "-y", "-hide_banner", "-loglevel", "error",
         "-i", music, "-i", vocal, "-filter_complex", graph,
         "-map", "[out]", "-acodec", "pcm_s16le", dst])
    return dst
