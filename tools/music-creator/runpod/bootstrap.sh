#!/usr/bin/env bash
#
# bootstrap.sh - make a RunPod Pod ready to run tools/music-creator/server.
#
#   bash bootstrap.sh                 everything (first run: about an hour;
#                                     ~30 GB of weights plus three Python envs)
#   bash bootstrap.sh --skip-auk      songs and transcription only
#   bash bootstrap.sh --no-weights    environments only, download nothing
#   bash bootstrap.sh --weights-only  downloads only, touch no environment
#   bash bootstrap.sh --help
#
# Runs ON the pod, as root, on an Ubuntu + NVIDIA CUDA image. Run it again
# after every pod stop/start: the volume keeps the venvs, weights and caches,
# but apt packages (the three Pythons, ffmpeg, git) are on the container disk
# and are wiped with it. A re-run reinstalls those in a few minutes and
# downloads no weights - every step checks before it does anything.
#
# Three Python versions, because the models disagree and no amount of pip will
# change their minds:
#
#   YuE2        Python 3.12          ->  $VOLUME/YuE/.venv
#   AuK         Python 3.10          ->  $VOLUME/AuK/.venv
#   SheetSage2  Python 3.11 + FFmpeg 6.1 with its shared libraries
#                                    ->  $VOLUME/venvs/sheetsage
#
# The server itself runs IN the YuE2 venv, and --yue2-python is deliberately
# not passed, so yue2 imports in the server's own interpreter and the model
# stays resident between songs instead of being reloaded for each one. AuK and
# SheetSage2 are reached with --auk-python and --sheetsage-python, and their
# jobs unload a resident YuE2 before the worker starts. With --skip-yue2 the
# server falls back to its own small venv. (Full reasoning at "which
# interpreter runs the server", below.)
#
# EVERYTHING PERSISTENT GOES ON THE NETWORK VOLUME ($VOLUME, default
# /workspace): the venvs, the Hugging Face cache, the checkpoints, pip's cache,
# TMPDIR and the server's --data-dir. The container disk is wiped when the pod
# restarts, so anything expensive that lands there gets paid for twice.
#
# This script never fakes a success. If a step fails it says which step, and
# stops.
#
set -Eeuo pipefail   # -E so the ERR trap also fires inside functions

# --- options ---------------------------------------------------------------

VOLUME="${VOLUME:-/workspace}"
PORT="${MUSIC_PORT:-8770}"
SKIP_YUE2="${SKIP_YUE2:-0}"
SKIP_AUK="${SKIP_AUK:-0}"
SKIP_SHEETSAGE="${SKIP_SHEETSAGE:-0}"
DO_ENV=1
DO_WEIGHTS=1
AUK_FLASH="${AUK_FLASH:-0}"

usage() {
    sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
    cat <<'USAGE'

Options
  --volume PATH        network volume mount point (default /workspace, or $VOLUME)
  --port N             port the server will listen on (default 8770)
  --skip-yue2          do not install or download YuE2 (no song generation)
  --skip-auk           do not install or download AuK (no speech / voice cloning)
  --skip-sheetsage     do not install or download SheetSage2 (no transcription,
                       so no cover/mashup workflow)
  --auk-flash          also fetch AuK-Flash, the optional 4-step checkpoint
  --no-weights         set up environments, download no model weights
  --weights-only       download weights, set up no environments
  --help               this text

Environment
  VOLUME, MUSIC_PORT, MUSIC_TOKEN, SKIP_YUE2, SKIP_AUK, SKIP_SHEETSAGE,
  AUK_FLASH, FFMPEG_URL  (all optional; flags win over environment)
USAGE
}

while [ $# -gt 0 ]; do
    case "$1" in
        --volume) VOLUME="$2"; shift 2 ;;
        --port) PORT="$2"; shift 2 ;;
        --skip-yue2) SKIP_YUE2=1; shift ;;
        --skip-auk) SKIP_AUK=1; shift ;;
        --skip-sheetsage) SKIP_SHEETSAGE=1; shift ;;
        --auk-flash) AUK_FLASH=1; shift ;;
        --no-weights) DO_WEIGHTS=0; shift ;;
        --weights-only) DO_ENV=0; shift ;;
        --help|-h) usage; exit 0 ;;
        *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
    esac
done

if [ "$DO_ENV" = 0 ] && [ "$DO_WEIGHTS" = 0 ]; then
    echo "--no-weights and --weights-only together leave nothing to do." >&2
    exit 2
fi

# --- paths on the volume ---------------------------------------------------

HF_HOME="$VOLUME/hf"
DATA_DIR="$VOLUME/data"
VENV_DIR="$VOLUME/venvs"
SERVER_VENV="$VENV_DIR/server"
SHEET_VENV="$VENV_DIR/sheetsage"
YUE_DIR="$VOLUME/YuE"
YUE_VENV="$YUE_DIR/.venv"
AUK_DIR="$VOLUME/AuK"
AUK_VENV="$AUK_DIR/.venv"
SHEET_DIR="$VOLUME/models/SheetSage2"
FFMPEG_DIR="$VOLUME/ffmpeg-6.1"
STAMPS="$VOLUME/.stamps"
SERVER_DST="$VOLUME/music-creator"
TOKEN_FILE="$VOLUME/music-token"
START_SCRIPT="$VOLUME/start-music-server.sh"
LOG_FILE="$VOLUME/server.log"

# Where this checkout is: runpod/bootstrap.sh -> tools/music-creator
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_SRC="$(cd "$HERE/.." && pwd)"

export HF_HOME
export PIP_CACHE_DIR="$VOLUME/pip-cache"
export TMPDIR="$VOLUME/tmp"
export DEBIAN_FRONTEND=noninteractive
export PIP_DISABLE_PIP_VERSION_CHECK=1

# --- logging and failure ---------------------------------------------------

STEP="startup"
START_TS=$(date +%s)

log()  { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
step() { STEP="$*"; printf '\n[%s] == %s\n' "$(date -u +%H:%M:%S)" "$*"; }
skip() { printf '[%s]    skip: %s\n' "$(date -u +%H:%M:%S)" "$*"; }
warn() { printf '[%s] ** %s\n' "$(date -u +%H:%M:%S)" "$*"; }

on_error() {
    local code=$?
    printf '\n'
    printf 'FAILED: %s\n' "$STEP"
    printf '  exit code %s (bootstrap.sh line %s)\n' "$code" "${BASH_LINENO[0]:-?}"
    printf '  Nothing was faked and nothing was cleaned up. Fix the cause and run\n'
    printf '  this script again - completed steps are detected and skipped.\n'
    exit "$code"
}
trap on_error ERR

stamp_done() { [ -f "$STAMPS/$1" ]; }
mark_done()  { mkdir -p "$STAMPS"; date -u +%Y-%m-%dT%H:%M:%SZ > "$STAMPS/$1"; }

APT_UPDATED=0
apt_install() {
    if [ "$APT_UPDATED" = 0 ]; then
        log "apt-get update"
        apt-get update -qq
        APT_UPDATED=1
    fi
    log "apt-get install $*"
    apt-get install -y -qq --no-install-recommends "$@" >/dev/null
}

# --- preflight -------------------------------------------------------------

step "preflight"
log "volume    $VOLUME"
log "HF_HOME   $HF_HOME"
log "server    $SERVER_SRC (this checkout)"

if [ "$(id -u)" != 0 ]; then
    warn "not running as root; apt-get steps will fail if anything is missing"
fi

if [ ! -d "$VOLUME" ]; then
    echo "No such directory: $VOLUME" >&2
    echo "On a RunPod Pod the network volume is usually mounted at /workspace." >&2
    echo "Attach one, or pass --volume /the/real/path. Do not point this at the" >&2
    echo "container disk: it is wiped when the pod restarts." >&2
    exit 1
fi
mkdir -p "$VOLUME/.write-test" && rmdir "$VOLUME/.write-test"
mkdir -p "$HF_HOME" "$DATA_DIR" "$VENV_DIR" "$PIP_CACHE_DIR" "$TMPDIR" "$STAMPS" "$VOLUME/models"

FREE_GB=$(df -BG --output=avail "$VOLUME" 2>/dev/null | tail -1 | tr -dc '0-9' || echo "")
if [ -n "$FREE_GB" ]; then
    log "free on volume: ${FREE_GB} GB"
    if [ "$FREE_GB" -lt 60 ] && [ "$DO_WEIGHTS" = 1 ]; then
        warn "a full install wants roughly 60 GB (about 30 GB of weights plus three"
        warn "Python environments); ${FREE_GB} GB free may not be enough"
    fi
fi

VRAM_MB=""
if command -v nvidia-smi >/dev/null 2>&1; then
    VRAM_MB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -dc '0-9' || echo "")
    log "gpu: $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1) ${VRAM_MB:-?} MiB"
else
    warn "nvidia-smi not found: this box has no visible GPU. The server will still"
    warn "start and /health will still answer, but every job will fail."
fi

# AuK peaks around 24.8 GiB. On a 24 GB card it only fits with cpu_offload.
# (--keep-loaded is decided further down, where it is known which interpreter
# runs the server, because that is what decides whether anything is resident.)
CPU_OFFLOAD=""
if [ -n "$VRAM_MB" ] && [ "$VRAM_MB" -lt 26000 ]; then
    CPU_OFFLOAD="--cpu-offload"
    warn "AuK peaks around 24.8 GiB and this card has ${VRAM_MB} MiB;"
    warn "adding --cpu-offload to the start command. It saves about a third, and is slower."
fi

# The token. Generated once and kept on the volume so a restart keeps the same
# value and .env.local on the website stays correct.
if [ -z "${MUSIC_TOKEN:-}" ]; then
    if [ -s "$TOKEN_FILE" ]; then
        MUSIC_TOKEN="$(cat "$TOKEN_FILE")"
        log "token: reusing the one in $TOKEN_FILE"
    else
        MUSIC_TOKEN="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
        printf '%s' "$MUSIC_TOKEN" > "$TOKEN_FILE"
        chmod 600 "$TOKEN_FILE"
        log "token: generated a new one and wrote $TOKEN_FILE"
    fi
else
    printf '%s' "$MUSIC_TOKEN" > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
    log "token: taken from \$MUSIC_TOKEN and written to $TOKEN_FILE"
fi

# --- system packages -------------------------------------------------------

ensure_python() {
    # ensure_python 3.12 -> prints the interpreter path
    local want="$1" bin="python$1"
    if command -v "$bin" >/dev/null 2>&1; then
        echo "$(command -v "$bin")"
        return 0
    fi
    log "$bin not present, installing it" >&2
    if ! apt-get install -y -qq --no-install-recommends "$bin" "$bin-venv" "$bin-dev" >/dev/null 2>&1; then
        log "not in the image's apt sources; adding ppa:deadsnakes/ppa" >&2
        apt_install software-properties-common >&2
        add-apt-repository -y ppa:deadsnakes/ppa >/dev/null 2>&1
        apt-get update -qq
        apt-get install -y -qq --no-install-recommends "$bin" "$bin-venv" "$bin-dev" >/dev/null
    fi
    command -v "$bin" >/dev/null 2>&1 || { echo "python$want still not on PATH after install" >&2; return 1; }
    echo "$(command -v "$bin")"
}

ensure_venv() {
    # ensure_venv <interpreter> <dir>
    local py="$1" dir="$2"
    if [ -x "$dir/bin/python" ]; then
        skip "venv exists: $dir"
    else
        log "creating venv $dir with $py"
        "$py" -m venv "$dir"
    fi
    local key
    key="pip-$(echo "$dir" | tr '/' '_')"
    if ! stamp_done "$key"; then
        "$dir/bin/python" -m pip install -q --upgrade pip setuptools wheel
        mark_done "$key"
    fi
}

if [ "$DO_ENV" = 1 ]; then
    step "system packages"
    NEED=()
    for pkg_cmd in "git:git" "curl:curl" "xz-utils:xz" "tar:tar" "build-essential:gcc" "pkg-config:pkg-config" "ca-certificates:update-ca-certificates"; do
        pkg="${pkg_cmd%%:*}"; cmd="${pkg_cmd##*:}"
        command -v "$cmd" >/dev/null 2>&1 || NEED+=("$pkg")
    done
    command -v ffmpeg >/dev/null 2>&1 || NEED+=("ffmpeg")
    if [ "${#NEED[@]}" -gt 0 ]; then
        apt_install "${NEED[@]}"
    else
        skip "git, curl, tar, xz, a compiler and ffmpeg are already here"
    fi
fi

# --- FFmpeg 6.1 for SheetSage2 --------------------------------------------
#
# SheetSage2 wants FFmpeg 6.1 *and* its shared libraries (libavcodec and
# friends), which the ffmpeg apt package on Ubuntu 22.04 is too old to supply
# (4.4). Rather than argue with apt, a shared-libs build is unpacked onto the
# volume and put in front of PATH / LD_LIBRARY_PATH for everything the server
# starts. If the image already ships 6.x, nothing is downloaded.

FFMPEG_PATH_PREFIX=""
FFMPEG_LIB_PREFIX=""
ffmpeg_major() {
    local exe="$1"
    "$exe" -version 2>/dev/null | head -1 | sed -n 's/^ffmpeg version [^0-9]*\([0-9]\+\).*/\1/p'
}

if [ "$DO_ENV" = 1 ] && [ "$SKIP_SHEETSAGE" = 0 ]; then
    step "FFmpeg 6.1 (SheetSage2 needs it, with shared libraries)"
    SYS_MAJOR="$(ffmpeg_major "$(command -v ffmpeg || echo /bin/false)" || true)"
    if [ -x "$FFMPEG_DIR/bin/ffmpeg" ]; then
        skip "already on the volume: $FFMPEG_DIR"
        FFMPEG_PATH_PREFIX="$FFMPEG_DIR/bin"
        FFMPEG_LIB_PREFIX="$FFMPEG_DIR/lib"
    elif [ -n "$SYS_MAJOR" ] && [ "$SYS_MAJOR" -ge 6 ]; then
        skip "the image already has ffmpeg $SYS_MAJOR.x with its libraries"
    else
        FFMPEG_URL="${FFMPEG_URL:-https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n6.1-latest-linux64-gpl-shared-6.1.tar.xz}"
        log "system ffmpeg is ${SYS_MAJOR:-absent}; fetching a 6.1 shared build"
        log "$FFMPEG_URL"
        mkdir -p "$TMPDIR/ffmpeg-dl"
        if curl -fL --retry 3 -o "$TMPDIR/ffmpeg-dl/ffmpeg.tar.xz" "$FFMPEG_URL"; then
            rm -rf "$TMPDIR/ffmpeg-dl/x" && mkdir -p "$TMPDIR/ffmpeg-dl/x"
            tar -xJf "$TMPDIR/ffmpeg-dl/ffmpeg.tar.xz" -C "$TMPDIR/ffmpeg-dl/x" --strip-components=1
            mkdir -p "$FFMPEG_DIR"
            cp -a "$TMPDIR/ffmpeg-dl/x/." "$FFMPEG_DIR/"
            rm -rf "$TMPDIR/ffmpeg-dl"
            [ -x "$FFMPEG_DIR/bin/ffmpeg" ] || { echo "the archive contained no bin/ffmpeg" >&2; exit 1; }
            FFMPEG_PATH_PREFIX="$FFMPEG_DIR/bin"
            FFMPEG_LIB_PREFIX="$FFMPEG_DIR/lib"
            log "installed $("$FFMPEG_DIR/bin/ffmpeg" -version | head -1)"
        else
            warn "could not download an FFmpeg 6.1 build from that URL."
            warn "The upstream project renames its release assets from time to time."
            warn "Pick the current linux64 *gpl-shared* 6.1 asset from"
            warn "  https://github.com/BtbN/FFmpeg-Builds/releases"
            warn "and re-run with FFMPEG_URL=<that url>, or use --skip-sheetsage."
            warn "Continuing: songs and speech do not need FFmpeg 6.1, transcription does."
        fi
    fi
fi

# --- the server's own environment ------------------------------------------

if [ "$DO_ENV" = 1 ]; then
    step "server code and venv"

    # The container disk is wiped on restart, so the server tree is copied onto
    # the volume and the start script runs that copy. data/ and __pycache__ are
    # left behind on purpose.
    mkdir -p "$SERVER_DST"
    tar -C "$SERVER_SRC" --exclude=data --exclude=__pycache__ --exclude='*.pyc' -cf - . \
        | tar -C "$SERVER_DST" -xf -
    log "server code copied to $SERVER_DST"

    BASE_PY="$(command -v python3 || true)"
    [ -n "$BASE_PY" ] || BASE_PY="$(ensure_python 3.11)"
    ensure_venv "$BASE_PY" "$SERVER_VENV"
    if "$SERVER_VENV/bin/python" -c "import aiohttp" >/dev/null 2>&1 \
        && [ -x "$SERVER_VENV/bin/hf" ]; then
        skip "aiohttp and the huggingface_hub CLI are installed"
    else
        "$SERVER_VENV/bin/python" -m pip install -q -r "$SERVER_DST/requirements.txt" "huggingface_hub[cli]>=0.34"
        log "installed aiohttp and the huggingface_hub CLI"
    fi
fi

HF="$SERVER_VENV/bin/hf"

hf_available() {
    if [ ! -x "$HF" ]; then
        echo "The huggingface_hub CLI is missing ($HF)." >&2
        echo "Run this script once without --weights-only so the server venv gets built." >&2
        return 1
    fi
}

hf_cached() {
    # hf_cached <repo id> - true when it is already in $HF_HOME/hub
    local folder="models--${1//\//--}"
    [ -d "$HF_HOME/hub/$folder" ]
}

fetch_cached() {
    # fetch_cached <repo id> <what it is for>
    local repo="$1" why="$2"
    if hf_cached "$repo"; then
        skip "$repo already in the cache"
        return 0
    fi
    log "downloading $repo ($why) into $HF_HOME"
    "$HF" download "$repo"
}

fetch_local() {
    # fetch_local <repo id> <target dir> <a file that proves it landed>
    local repo="$1" dir="$2" sentinel="$3"
    if [ -e "$dir/$sentinel" ]; then
        skip "$repo already at $dir"
        return 0
    fi
    log "downloading $repo into $dir"
    mkdir -p "$dir"
    "$HF" download "$repo" --local-dir "$dir"
    [ -e "$dir/$sentinel" ] || { echo "$repo downloaded but $dir/$sentinel is missing" >&2; exit 1; }
}

# --- YuE2 (Python 3.12) ----------------------------------------------------

if [ "$SKIP_YUE2" = 0 ]; then
    if [ "$DO_ENV" = 1 ]; then
        step "YuE2 code and venv (Python 3.12)"
        if [ -d "$YUE_DIR/.git" ]; then
            skip "$YUE_DIR is already a checkout (git -C $YUE_DIR pull to update)"
        else
            log "cloning multimodal-art-projection/YuE"
            git clone --depth 1 https://github.com/multimodal-art-projection/YuE.git "$YUE_DIR"
        fi
        PY312="$(ensure_python 3.12)"
        ensure_venv "$PY312" "$YUE_VENV"
        if "$YUE_VENV/bin/python" -c "import yue2" >/dev/null 2>&1; then
            skip "the yue2 package imports in $YUE_VENV"
        else
            log "pip install . in $YUE_DIR (this pulls torch; expect several minutes)"
            ( cd "$YUE_DIR" && "$YUE_VENV/bin/python" -m pip install . )
            "$YUE_VENV/bin/python" -c "import yue2" >/dev/null 2>&1 \
                || { echo "yue2 still does not import after pip install ." >&2; exit 1; }
        fi
        # The server itself runs in THIS venv, so that yue2 imports in the
        # server's own interpreter and the model stays resident between songs.
        # See "which interpreter runs the server" below.
        if "$YUE_VENV/bin/python" -c "import aiohttp" >/dev/null 2>&1; then
            skip "aiohttp is already in the YuE2 venv"
        else
            log "installing the server's own requirements into the YuE2 venv"
            "$YUE_VENV/bin/python" -m pip install -q -r "$SERVER_DST/requirements.txt"
        fi
    fi
    if [ "$DO_WEIGHTS" = 1 ]; then
        step "YuE2 weights (CC BY-NC 4.0 - non-commercial only)"
        hf_available
        fetch_cached "m-a-p/YuE2-3B" "the generator"
        fetch_cached "m-a-p/YuE2-Vae" "the listening decoder"
    fi
else
    step "YuE2"; skip "--skip-yue2: no song generation on this pod"
fi

# --- AuK (Python 3.10) -----------------------------------------------------

if [ "$SKIP_AUK" = 0 ]; then
    if [ "$DO_ENV" = 1 ]; then
        step "AuK code and venv (Python 3.10)"
        if [ -d "$AUK_DIR/.git" ]; then
            skip "$AUK_DIR is already a checkout (git -C $AUK_DIR pull to update)"
        else
            log "cloning Tencent-Hunyuan/AuK"
            git clone --depth 1 https://github.com/Tencent-Hunyuan/AuK.git "$AUK_DIR"
        fi
        PY310="$(ensure_python 3.10)"
        ensure_venv "$PY310" "$AUK_VENV"
        if "$AUK_VENV/bin/python" -c "import auk" >/dev/null 2>&1; then
            skip "the auk package imports in $AUK_VENV"
        else
            log "pip install -e \".[gradio]\" in $AUK_DIR (pulls torch; several minutes)"
            ( cd "$AUK_DIR" && "$AUK_VENV/bin/python" -m pip install -e ".[gradio]" )
            "$AUK_VENV/bin/python" -c "import auk" >/dev/null 2>&1 \
                || { echo "auk still does not import after pip install -e ." >&2; exit 1; }
        fi
    fi
    if [ "$DO_WEIGHTS" = 1 ]; then
        step "AuK weights (MIT)"
        hf_available
        fetch_local "tencent/AuK" "$AUK_DIR/ckpts/AuK" "auk_base.safetensors"
        if [ "$AUK_FLASH" = 1 ]; then
            fetch_local "tencent/AuK-Flash" "$AUK_DIR/ckpts/AuK-Flash" "config.yaml"
        else
            skip "AuK-Flash (the optional 4-step checkpoint); pass --auk-flash to fetch it"
        fi
        fetch_cached "Qwen/Qwen2.5-Omni-3B" "AuK loads it as part of its stack"
    fi
else
    step "AuK"; skip "--skip-auk: no speech or voice cloning on this pod"
fi

# --- SheetSage2 (Python 3.11 + FFmpeg 6.1) ---------------------------------

if [ "$SKIP_SHEETSAGE" = 0 ]; then
    if [ "$DO_WEIGHTS" = 1 ]; then
        step "SheetSage2 weights"
        hf_available
        # Downloaded before the venv is filled, because its own requirements.txt
        # is inside the repo.
        fetch_local "m-a-p/SheetSage2" "$SHEET_DIR" "requirements.txt"
        log "MERT-v2-FullSong is not fetched here: SheetSage2 loads it itself on first use"
    fi
    if [ "$DO_ENV" = 1 ]; then
        step "SheetSage2 venv (Python 3.11)"
        PY311="$(ensure_python 3.11)"
        ensure_venv "$PY311" "$SHEET_VENV"
        if [ ! -f "$SHEET_DIR/requirements.txt" ]; then
            warn "no $SHEET_DIR/requirements.txt yet (weights not downloaded), so the"
            warn "SheetSage2 venv is left empty. Re-run without --no-weights to finish it."
        elif stamp_done "sheetsage-deps" \
            && "$SHEET_VENV/bin/python" -c "import torch, transformers" >/dev/null 2>&1; then
            skip "SheetSage2 dependencies are installed"
        else
            log "pip install -r $SHEET_DIR/requirements.txt"
            "$SHEET_VENV/bin/python" -m pip install -r "$SHEET_DIR/requirements.txt"
            log "pinning torch 2.8.0 / torchaudio 2.8.0 (cu126)"
            "$SHEET_VENV/bin/python" -m pip install \
                torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu126
            log "pinning huggingface-hub 0.36.0"
            "$SHEET_VENV/bin/python" -m pip install huggingface-hub==0.36.0
            "$SHEET_VENV/bin/python" -c "import torch, transformers" >/dev/null 2>&1 \
                || { echo "torch/transformers do not import in $SHEET_VENV" >&2; exit 1; }
            mark_done "sheetsage-deps"
        fi
    fi
else
    step "SheetSage2"; skip "--skip-sheetsage: no transcription, so no cover workflow"
fi

if [ "$DO_ENV" = 0 ]; then
    step "done (--weights-only)"
    log "weights are on the volume. Run this script without --weights-only to build"
    log "the environments and write $START_SCRIPT."
    exit 0
fi

# --- the start command -----------------------------------------------------

step "start script"

# Which interpreter runs the server
# --------------------------------
# The YuE2 venv, when YuE2 is installed - and then --yue2-python is deliberately
# NOT passed. engines.py picks the mode like this:
#
#     def yue2_mode(self):
#         if _interpreter(self.args.yue2_python):
#             return "subprocess"
#         return "inprocess" if module_available("yue2") else None
#
# so passing the flag forces subprocess mode even when yue2 imports fine, and
# subprocess mode reloads a 7.3 GB model for EVERY song. Songs are the thing
# this server exists for, so YuE2 gets the in-process path: loaded once, cached
# in Engines._yue2, and reused by every later song job.
#
# AuK and SheetSage2 keep their own interpreters. They have to: AuK wants 3.10,
# SheetSage2 pins transformers versions that fight with YuE2's, and both of
# those jobs call free_gpu(keep=None) before spawning the worker, so a resident
# YuE2 is unloaded first rather than sitting next to a second 24 GB process.
RUN_PYTHON="$SERVER_VENV/bin/python"
RUN_WHY="the server's own small venv"
if [ "$SKIP_YUE2" = 0 ] && [ -x "$YUE_VENV/bin/python" ] \
    && "$YUE_VENV/bin/python" -c "import yue2, aiohttp" >/dev/null 2>&1; then
    RUN_PYTHON="$YUE_VENV/bin/python"
    RUN_WHY="the YuE2 venv, so YuE2 loads in-process and stays resident between songs"
elif [ "$SKIP_YUE2" = 0 ]; then
    warn "the YuE2 venv cannot import both yue2 and aiohttp, so the server will run"
    warn "from $SERVER_VENV and reach YuE2 through --yue2-python (a reload per song)."
    warn "Re-run this script to finish that venv."
fi
log "server interpreter: $RUN_PYTHON"
log "  ($RUN_WHY)"

# --keep-loaded, decided by what can actually be resident here
# -----------------------------------------------------------
# In this layout only YuE2 is ever resident in the server process; AuK and
# SheetSage2 are subprocesses, which never populate Engines._auk. So:
#
#   'one'  keeps YuE2 loaded across consecutive song jobs - free_gpu(keep=
#          "yue2") unloads only the OTHER engines, and release_after_job()
#          frees nothing unless --keep-loaded is 'none'. This is the fast path
#          for songs, and it still unloads YuE2 before an AuK subprocess
#          starts, which is what stops the two 24 GB processes colliding.
#   'both' would add nothing (AuK cannot be resident anyway) and would make
#          free_gpu() return immediately, so a resident YuE2 (~24 GB) would
#          still be on the card while an AuK subprocess loads ~24.8 GiB. That
#          is ~49 GiB, which an A6000 (49140 MiB) does not have once anything
#          else is allocated. It is only safe on an 80 GB card, where it saves
#          a YuE2 reload after a speech job.
KEEP_LOADED="one"
if [ "$RUN_PYTHON" = "$YUE_VENV/bin/python" ] && [ -n "$VRAM_MB" ] && [ "$VRAM_MB" -ge 60000 ]; then
    KEEP_LOADED="both"
    log "${VRAM_MB} MiB: --keep-loaded both (YuE2 can stay resident even while an AuK subprocess runs)"
elif [ "$RUN_PYTHON" = "$YUE_VENV/bin/python" ]; then
    log "--keep-loaded one: YuE2 stays resident between songs, and is unloaded before an AuK job"
else
    log "--keep-loaded one (nothing runs in-process here, so this setting changes nothing)"
fi

SERVER_ARGS=(--host 0.0.0.0 --port "$PORT" --data-dir "$DATA_DIR" --keep-loaded "$KEEP_LOADED")
[ -n "$CPU_OFFLOAD" ] && SERVER_ARGS+=("$CPU_OFFLOAD")

# Only if the fast path above is not available: reach YuE2 in its own venv.
if [ "$SKIP_YUE2" = 0 ] && [ "$RUN_PYTHON" != "$YUE_VENV/bin/python" ] \
    && [ -x "$YUE_VENV/bin/python" ]; then
    SERVER_ARGS+=(--yue2-python "$YUE_VENV/bin/python")
fi
if [ "$SKIP_AUK" = 0 ] && [ -x "$AUK_VENV/bin/python" ]; then
    SERVER_ARGS+=(--auk-python "$AUK_VENV/bin/python"
                  --auk-ckpt "$AUK_DIR/ckpts/AuK/auk_base.safetensors"
                  --auk-config "$AUK_DIR/ckpts/AuK/config.yaml")
    if [ -f "$AUK_DIR/ckpts/AuK-Flash/config.yaml" ]; then
        FLASH_CKPT="$AUK_DIR/ckpts/AuK-Flash/auk_flash.safetensors"
        SERVER_ARGS+=(--auk-flash-ckpt "$FLASH_CKPT"
                      --auk-flash-config "$AUK_DIR/ckpts/AuK-Flash/config.yaml")
    fi
fi
if [ "$SKIP_SHEETSAGE" = 0 ] && [ -x "$SHEET_VENV/bin/python" ]; then
    SERVER_ARGS+=(--sheetsage-python "$SHEET_VENV/bin/python" --sheetsage-dir "$SHEET_DIR")
fi

# Two renderings of the same argument list: one to paste into the start script
# (four spaces, line continuations) and one to print for a human. The token is
# left as a shell variable in both, so it never lands in a log or a screenshot.
render_args() {
    # render_args <indent> - one flag (with its value) per line, "\" continued
    local indent="$1" out="" line="" a
    for a in "${SERVER_ARGS[@]}"; do
        case "$a" in
            --*)
                [ -n "$line" ] && out+="${indent}${line} \\"$'\n'
                line="$a"
                ;;
            *) line+=" \"$a\"" ;;
        esac
    done
    [ -n "$line" ] && out+="${indent}${line} \\"$'\n'
    printf '%s' "$out"
}

ARGS_BLOCK="$(render_args '    ')"
ARGS_PRINT="$(render_args '      ')"

cat > "$START_SCRIPT" <<EOF
#!/usr/bin/env bash
#
# start-music-server.sh - generated by bootstrap.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ).
# Re-run bootstrap.sh to regenerate it after changing what is installed.
#
#   bash $START_SCRIPT           start it in the background and return
#   bash $START_SCRIPT status    is it running, and on what pid
#   bash $START_SCRIPT stop      stop it
#
set -euo pipefail

VOLUME="$VOLUME"
export HF_HOME="$HF_HOME"
export TMPDIR="$TMPDIR"
export PIP_CACHE_DIR="$PIP_CACHE_DIR"
EOF

if [ -n "$FFMPEG_PATH_PREFIX" ]; then
    cat >> "$START_SCRIPT" <<EOF
# FFmpeg 6.1 first on PATH: SheetSage2 needs it, and every worker the server
# spawns inherits this environment.
export PATH="$FFMPEG_PATH_PREFIX:\$PATH"
export LD_LIBRARY_PATH="$FFMPEG_LIB_PREFIX:\${LD_LIBRARY_PATH:-}"
EOF
fi

cat >> "$START_SCRIPT" <<EOF

PYTHON="$RUN_PYTHON"
SERVER="$SERVER_DST/server/server.py"
LOG="$LOG_FILE"
PIDFILE="$VOLUME/music-server.pid"

if ! "\$PYTHON" -c "import sys" >/dev/null 2>&1; then
    echo "\$PYTHON does not run." >&2
    echo "The venvs are on the volume but the interpreters they were built from" >&2
    echo "(python3.10 / 3.11 / 3.12, apt packages) live on the container disk, which" >&2
    echo "is wiped when the pod restarts. Run bootstrap.sh again: it reinstalls them" >&2
    echo "in a few minutes and downloads nothing." >&2
    exit 1
fi

MUSIC_TOKEN="\${MUSIC_TOKEN:-\$(cat "$TOKEN_FILE" 2>/dev/null || true)}"
if [ -z "\$MUSIC_TOKEN" ]; then
    echo "No token in the MUSIC_TOKEN environment variable, and $TOKEN_FILE is empty." >&2
    echo "Without one, anyone who finds the proxy URL can spend your GPU time." >&2
    exit 1
fi

running_pid() {
    [ -f "\$PIDFILE" ] || return 1
    local pid; pid="\$(cat "\$PIDFILE")"
    [ -n "\$pid" ] && kill -0 "\$pid" 2>/dev/null && { echo "\$pid"; return 0; }
    return 1
}

case "\${1:-start}" in
    status)
        if pid=\$(running_pid); then echo "running, pid \$pid"; else echo "not running"; fi
        exit 0
        ;;
    stop)
        if pid=\$(running_pid); then
            kill "\$pid" && echo "stopped pid \$pid"
        else
            echo "not running"
        fi
        rm -f "\$PIDFILE"
        exit 0
        ;;
    start) ;;
    *) echo "usage: \$0 [start|status|stop]" >&2; exit 2 ;;
esac

if pid=\$(running_pid); then
    echo "already running, pid \$pid  (tail -f \$LOG)"
    exit 0
fi

# AuK and YuE2 resolve some of their own relative paths against the working
# directory, and the server passes its own cwd to every worker it spawns.
cd "$AUK_DIR" 2>/dev/null || cd "$VOLUME"

# setsid + nohup so it survives the SSH session ending, which is how you will
# normally be talking to this pod.
setsid nohup "\$PYTHON" "\$SERVER" \\
${ARGS_BLOCK}
    --token "\$MUSIC_TOKEN" \\
    >> "\$LOG" 2>&1 < /dev/null &

echo \$! > "\$PIDFILE"
echo "started pid \$(cat "\$PIDFILE"), port $PORT, logging to \$LOG"
echo "tail -f \$LOG"
EOF

chmod +x "$START_SCRIPT"
log "wrote $START_SCRIPT"

# --- self-test -------------------------------------------------------------

step "self-test (the server's own report; nothing is loaded onto the card)"
if [ -n "$FFMPEG_PATH_PREFIX" ]; then
    export PATH="$FFMPEG_PATH_PREFIX:$PATH"
    export LD_LIBRARY_PATH="$FFMPEG_LIB_PREFIX:${LD_LIBRARY_PATH:-}"
fi
echo
set +e
"$RUN_PYTHON" "$SERVER_DST/server/server.py" "${SERVER_ARGS[@]}" --self-test
SELFTEST_RC=$?
set -e
echo

# --- what to do next -------------------------------------------------------

ELAPSED=$(( $(date +%s) - START_TS ))
step "done in $((ELAPSED / 60))m $((ELAPSED % 60))s"

if [ "$SELFTEST_RC" != 0 ]; then
    warn "the self-test exited $SELFTEST_RC - read its lines above before starting the server"
fi

cat <<EOF

Start the server:

    bash $START_SCRIPT

or, by hand, exactly what that script runs:

    export HF_HOME="$HF_HOME"
    $RUN_PYTHON $SERVER_DST/server/server.py \\
${ARGS_PRINT}
      --token "\$MUSIC_TOKEN"

--keep-loaded is $KEEP_LOADED for this card. 'both' keeps YuE2 (~24 GB) and AuK
(~24.8 GiB) resident at once, which needs a little under 49 GiB of reported
VRAM - an RTX A6000 (49140 MiB) has it, an A40 or L40S (46068 MiB) does not,
whatever the marketing says. 'one' swaps them, and costs a model load whenever
you alternate between song and speech jobs.

Then on the website, in .env.local:

    MUSIC_SERVER_URL=https://<pod id>-$PORT.proxy.runpod.net
    MUSIC_TOKEN=$MUSIC_TOKEN

Check it from your laptop:

    curl https://<pod id>-$PORT.proxy.runpod.net/health

The pod bills for every second it is RUNNING, generating or not. Stop it when
you are finished.

After a stop/start, run this script again before starting the server. The
volume keeps the venvs, the weights and the caches, but apt packages - the
three Pythons, ffmpeg, git - live on the container disk and are wiped with it.
The re-run reinstalls those in a few minutes and downloads no weights at all.
EOF
