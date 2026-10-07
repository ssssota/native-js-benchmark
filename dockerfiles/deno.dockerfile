FROM denoland/deno:debian-2.9.7

# Keep both denort downloads in an image layer, not a disposable container.
ENV DENO_DIR=/deno-dir
COPY dockerfiles/compile-probe.js /tmp/compile-probe.js
RUN deno compile --engine v8 --no-config --no-npm --output /tmp/probe-v8 /tmp/compile-probe.js \
    && deno compile --engine quickjs --no-config --no-npm --output /tmp/probe-quickjs /tmp/compile-probe.js \
    && rm /tmp/probe-v8 /tmp/probe-quickjs /tmp/compile-probe.js
