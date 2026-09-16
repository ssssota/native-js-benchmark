FROM node:24.21.0-trixie-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential clang-19 libssl-dev=3.5.7-1~deb13u2 \
    && rm -rf /var/lib/apt/lists/*

ENV PERRY_LLVM_CLANG=/usr/bin/clang-19

RUN npm install -g @perryts/perry@0.5.1520 \
    && perry --version
