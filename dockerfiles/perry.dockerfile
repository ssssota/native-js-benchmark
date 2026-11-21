FROM node:26.13.1-trixie-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential clang-19 libssl-dev=3.5.9-1~deb13u1 \
    && rm -rf /var/lib/apt/lists/*

ENV PERRY_LLVM_CLANG=/usr/bin/clang-19

RUN npm install -g @perryts/perry@0.5.1665 \
    && perry --version
