FROM node:26.13.1-trixie-slim

RUN npm install -g --no-audit --no-fund postject@1.0.0-alpha.6 \
    && postject --help
