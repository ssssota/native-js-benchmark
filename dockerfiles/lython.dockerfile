FROM node:26.10.0-trixie-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg cmake ninja-build build-essential python3 \
    && curl -fsSL https://apt.llvm.org/llvm-snapshot.gpg.key -o /usr/share/keyrings/llvm.asc \
    && gpg --show-keys --with-colons /usr/share/keyrings/llvm.asc | grep -q '6084F3CF814B57C1CF12EFD515CF4D18AF4F7421' \
    && echo 'deb [signed-by=/usr/share/keyrings/llvm.asc] https://apt.llvm.org/trixie/ llvm-toolchain-trixie-23 main' > /etc/apt/sources.list.d/llvm.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends clang-23 lld-23 llvm-23-dev libmlir-23-dev mlir-23-tools \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/usr/lib/llvm-23/bin:${PATH}"
COPY scripts/dynamic-aot-config.json /tmp/dynamic-aot-config.json
RUN set -eu; \
    url="$(node -p "require('/tmp/dynamic-aot-config.json').lython.url")"; \
    sha256="$(node -p "require('/tmp/dynamic-aot-config.json').lython.sha256")"; \
    curl -fsSL "$url" -o /tmp/lython.tar.gz; \
    echo "$sha256  /tmp/lython.tar.gz" | sha256sum -c -; \
    mkdir -p /opt/lython; \
    tar -xzf /tmp/lython.tar.gz --strip-components=1 -C /opt/lython; \
    rm /tmp/lython.tar.gz
RUN cmake -S /opt/lython -B /opt/lython/build -G Ninja \
        -DCMAKE_BUILD_TYPE=Release -DLYTHON_BUILD_TESTS=OFF \
        -DLLVM_DIR=/usr/lib/llvm-23/lib/cmake/llvm -DMLIR_DIR=/usr/lib/llvm-23/lib/cmake/mlir \
        -DCMAKE_C_COMPILER=clang-23 -DCMAKE_CXX_COMPILER=clang++-23 \
    && cmake --build /opt/lython/build --target lyc -j2 \
    && ln -s /opt/lython/build/bin/lyc /usr/local/bin/lyc
RUN lyc --version
WORKDIR /tmp
