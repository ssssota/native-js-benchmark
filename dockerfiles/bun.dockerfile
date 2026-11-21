# The default variant is Debian-based.
FROM oven/bun:1.4.5
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tar \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/bun-canary-config.json scripts/host-bun-canary.ts scripts/prepare-bun-canary.ts scripts/process.ts /opt/bootstrap/
RUN bun /opt/bootstrap/prepare-bun-canary.ts /opt/native-js-dream \
    && version="$(bun -p "require('/opt/bootstrap/bun-canary-config.json').version")" \
    && ln -s "/opt/native-js-dream/build/tools/bun-canary-$version/bin/bun" /usr/local/bin/bun-canary
