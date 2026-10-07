FROM ubuntu:24.04@sha256:008173c23f95b170204355c12626cb5a965d779a7e1283b09e9cffbb1bf33ca3 AS hermes-icu

RUN apt-get update \
    && apt-get install -y --no-install-recommends libicu74=74.2-1ubuntu3.1 \
    && mkdir -p /opt/hermes-icu \
    && cp -a /usr/lib/*/libicu*.so.74* /opt/hermes-icu/ \
    && rm -rf /var/lib/apt/lists/*

FROM debian:13.6-slim

# static-hermes-cli publishes Linux artifacts for Ubuntu 24.04. Keep the
# release and each supported archive checksum fixed so Docker does not build a
# moving Hermes checkout or download an unverified compiler.
ARG STATIC_HERMES_VERSION=2026.10.1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl build-essential clang=1:19.0-63 libicu-dev=76.1-4 \
        libreadline-dev tzdata \
    && rm -rf /var/lib/apt/lists/*

COPY --from=hermes-icu /opt/hermes-icu /opt/hermes-icu
ENV LD_LIBRARY_PATH="/hermes/lib"

RUN set -eu; \
    case "$(dpkg --print-architecture)" in \
        amd64) hermes_arch=x64; sha256=f56458bbe335e50f52090748432e94ffb9ee3d75eeb6103b73d2850141d5c71e ;; \
        arm64) hermes_arch=arm64; sha256=ad9106b49e8e7f7fdad24adc5d76b4e9a9d7bb9cf6a5c0d0336ff425f0a587ea ;; \
        *) echo 'Unsupported architecture' >&2; exit 1 ;; \
    esac; \
    archive="/tmp/static-hermes.tar.gz"; \
    curl -fsSL "https://github.com/ssssota/static-hermes-cli/releases/download/v${STATIC_HERMES_VERSION}/static-hermes-${STATIC_HERMES_VERSION}-linux-${hermes_arch}.tar.gz" -o "${archive}"; \
    echo "${sha256}  ${archive}" | sha256sum -c -; \
    mkdir -p /hermes; \
    tar -xzf "${archive}" -C /hermes --strip-components=1; \
    cp -a /opt/hermes-icu/libicu*.so.74* /hermes/lib/; \
    ln -sf libicuuc.so.74 /hermes/lib/libicuuc.so; \
    ln -sf libicui18n.so.74 /hermes/lib/libicui18n.so; \
    ln -sf libicudata.so.74 /hermes/lib/libicudata.so; \
    test -x /hermes/bin/shermes; \
    grep -Fq "${STATIC_HERMES_VERSION}" /hermes/manifest.json; \
    rm "${archive}"

RUN /hermes/bin/shermes --version

ENV PATH="/hermes/bin:${PATH}"
