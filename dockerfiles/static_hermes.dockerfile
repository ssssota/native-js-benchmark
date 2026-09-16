FROM debian:13.6-slim

# Commit from facebook/hermes static_h; do not build a moving branch.
ARG HERMES_COMMIT=9a41742f5ffbd5e7f9e7bc36b51b5e9c4e14111e

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates build-essential clang-19 cmake git ninja-build \
        libicu-dev python3 tzdata libreadline-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /hermes
RUN git init source \
    && git -C source remote add origin https://github.com/facebook/hermes.git \
    && git -C source fetch --depth 1 origin "${HERMES_COMMIT}" \
    && git -C source checkout --detach "${HERMES_COMMIT}" \
    && test "$(git -C source rev-parse HEAD)" = "${HERMES_COMMIT}"

RUN cmake -S source -B build -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_C_COMPILER=clang-19 \
        -DCMAKE_CXX_COMPILER=clang++-19 \
    && cmake --build build --target shermes-dep \
    && build/bin/shermes --version

# Keep source headers and build libraries: shermes uses them when compiling JS.
# This revision's -static-link is unsupported on Linux; generated programs use
# shared Hermes libraries. Include those dependencies in binary-size comparisons.
ENV PATH="/hermes/build/bin:${PATH}"
