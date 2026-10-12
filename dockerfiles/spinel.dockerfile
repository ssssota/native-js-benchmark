FROM node:26.10.0-trixie-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/dynamic-aot-config.json /tmp/dynamic-aot-config.json
RUN set -eu; \
    url="$(node -p "require('/tmp/dynamic-aot-config.json').spinel.url")"; \
    sha256="$(node -p "require('/tmp/dynamic-aot-config.json').spinel.sha256")"; \
    curl -fsSL "$url" -o /tmp/spinel.tar.xz; \
    echo "$sha256  /tmp/spinel.tar.xz" | sha256sum -c -; \
    mkdir -p /opt/spinel; \
    tar -xJf /tmp/spinel.tar.xz --strip-components=1 -C /opt/spinel; \
    rm /tmp/spinel.tar.xz
WORKDIR /opt/spinel
RUN make -j2 && ln -s /opt/spinel/bin/spinel /usr/local/bin/spinel
RUN spinel --version
WORKDIR /tmp
