# 24/7 Queue worker — runs the queue's executors on the VPS so tasks keep
# going with the owner's PC off. Build context: tools/queue-worker (after
# `node tools/queue-worker/build.mjs` produced dist/worker.mjs).
FROM node:24-bookworm-slim

# ffmpeg/ffprobe for H3 video recreation (scene detection, keyframes);
# python3 + yt-dlp for importing social video links (yt-dlp uses node as its JS runtime).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl tini \
 && curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    YTDLP_PATH=/usr/local/bin/yt-dlp \
    TMPDIR=/tmp/queue247

WORKDIR /app
COPY dist/ ./dist/
RUN mkdir -p /tmp/queue247 && chown -R node:node /tmp/queue247 /app
USER node

# tini forwards SIGTERM so the worker hands its tasks back cleanly on restart.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/worker.mjs"]
