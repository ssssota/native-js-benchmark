FROM node:26.10.0-trixie-slim

RUN npm install -g --no-audit --no-fund postject@1.0.0-alpha.6 \
    && postject --help
