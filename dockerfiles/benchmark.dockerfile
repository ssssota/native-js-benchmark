FROM denoland/deno:debian-2.9.6 AS deno
FROM oven/bun:1.4.2 AS bun
FROM node:24.21.0-trixie-slim

# Shared runtime for every benchmark, including statically linked Hermes VM
# executables that still depend on the system ICU libraries.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libicu76=76.1-4 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deno /usr/bin/deno /usr/local/bin/deno
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
