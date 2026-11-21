FROM node:26.13.1-trixie-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential clang zlib1g-dev=1:1.3.dfsg+really1.3.1-1+deb13u1 \
    && rm -rf /var/lib/apt/lists/*

# 0.4.15 ships runtime ABI v48 but its compiler requires v51.
RUN npm install -g --allow-scripts=scriptc scriptc@0.4.14 \
    && scriptc --version
