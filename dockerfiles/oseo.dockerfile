FROM node:24.21.0-trixie-slim

# Oseo's supported Linux execution target is AMD64. Use the Mac host backend
# on Apple Silicon; AArch64 Linux is only an upstream inspection target.
RUN test "$(dpkg --print-architecture)" = amd64 \
    || { echo 'Oseo Docker execution requires linux/amd64; use --backend host on macOS arm64.' >&2; exit 1; }

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl xz-utils git \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://github.com/aubepkg/aube/releases/download/v2.5.0/aube-v2.5.0-x86_64-unknown-linux-gnu.tar.gz -o /tmp/aube.tar.gz \
    && echo '15c5371d4f847da83dd51b4d182cd0928dcd52a9d5cea36d07fb44f3776ee72e  /tmp/aube.tar.gz' | sha256sum -c - \
    && tar -xzf /tmp/aube.tar.gz -C /usr/local/bin aube \
    && rm /tmp/aube.tar.gz

RUN curl -fsSL https://ziglang.org/download/0.16.0/zig-x86_64-linux-0.16.0.tar.xz -o /tmp/zig.tar.xz \
    && echo '70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00  /tmp/zig.tar.xz' | sha256sum -c - \
    && mkdir -p /opt/zig \
    && tar -xJf /tmp/zig.tar.xz --strip-components=1 -C /opt/zig \
    && ln -s /opt/zig/zig /usr/local/bin/zig \
    && rm /tmp/zig.tar.xz

COPY scripts/oseo-config.json /tmp/oseo-config.json
RUN set -eu; \
    revision="$(node -p "require('/tmp/oseo-config.json').revision")"; \
    sha256="$(node -p "require('/tmp/oseo-config.json').sha256")"; \
    curl -fsSL "https://codeload.github.com/dahlia/oseo/tar.gz/${revision}" -o /tmp/oseo.tar.gz; \
    echo "${sha256}  /tmp/oseo.tar.gz" | sha256sum -c -; \
    mkdir -p /opt/oseo; \
    tar -xzf /tmp/oseo.tar.gz --strip-components=1 -C /opt/oseo; \
    rm /tmp/oseo.tar.gz /tmp/oseo-config.json

WORKDIR /opt/oseo
RUN aube install --frozen-lockfile \
    && aube exec -- tsdown --workspace

COPY scripts/oseo-compile.mjs /opt/oseo-compile.mjs
RUN node /opt/oseo-compile.mjs /opt/oseo --version
WORKDIR /tmp
