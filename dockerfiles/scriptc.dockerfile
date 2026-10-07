FROM node:26.10.0-trixie-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential clang zlib1g-dev=1:1.3.dfsg+really1.3.1-1+b1 \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g --allow-scripts=scriptc scriptc@0.2.3 \
    && scriptc --version
