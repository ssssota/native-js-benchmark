FROM ubuntu:24.04@sha256:008173c23f95b170204355c12626cb5a965d779a7e1283b09e9cffbb1bf33ca3 AS hermes-runtime

# static-hermes-cli's Linux release is built against ICU 74. The benchmark
# image remains Debian-based for the other runtimes, so copy only the matching
# ICU shared libraries into an isolated directory.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libicu74=74.2-1ubuntu3.1 \
    && mkdir -p /opt/hermes-icu \
    && cp -a /usr/lib/*/libicu*.so.74* /opt/hermes-icu/ \
    && rm -rf /var/lib/apt/lists/*

FROM denoland/deno:debian-2.9.7 AS deno
FROM oven/bun:1.4.2 AS bun
FROM python:3.14.8-slim-trixie AS cpython
FROM ruby:4.0.7-slim-trixie AS cruby
FROM node:26.10.0-trixie-slim

# Shared runtime for every benchmark, including statically linked Hermes VM
# executables that still depend on the system ICU libraries.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libicu76=76.1-4 libyaml-0-2 libssl3t64 zlib1g libffi8 libreadline8t64 libgmp10 libcrypt1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deno /usr/bin/deno /usr/local/bin/deno
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=cpython /usr/local/bin/python3* /usr/local/bin/
COPY --from=cpython /usr/local/lib/python3.14 /usr/local/lib/python3.14
COPY --from=cpython /usr/local/lib/libpython3.14.so* /usr/local/lib/
COPY --from=cruby /usr/local/bin/ruby /usr/local/bin/ruby
COPY --from=cruby /usr/local/lib/ruby /usr/local/lib/ruby
COPY --from=cruby /usr/local/lib/libruby.so* /usr/local/lib/
RUN ldconfig && python3 -I -B -c 'import json, time' && ruby --disable-gems -rjson -e 'puts RUBY_VERSION'
COPY --from=hermes-runtime /opt/hermes-icu /opt/hermes-icu

ENV LD_LIBRARY_PATH="/opt/hermes-icu"
