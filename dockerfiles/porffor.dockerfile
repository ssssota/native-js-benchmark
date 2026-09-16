FROM debian:13.6-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl build-essential clang \
    && rm -rf /var/lib/apt/lists/*

# Pin both the release and the architecture-specific archive checksum.
RUN set -eu; \
    case "$(dpkg --print-architecture)" in \
        amd64) arch=x64; sha256=eb0ea557fc9fbcbaf16d81d9090b6fcf5010ede444dc151b94f7c528e1328b82 ;; \
        arm64) arch=arm64; sha256=ed5f80ef01fd0a930d3ff5d95cd082530e76fbff193d41950c27b35141420b0a ;; \
        *) echo 'Unsupported architecture' >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/CanadaHonk/porffor/releases/download/alpha-6/porffor-linux-${arch}.tar.gz" -o /tmp/porffor.tar.gz; \
    echo "${sha256}  /tmp/porffor.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/porffor.tar.gz -C /usr/local/bin porf; \
    chmod +x /usr/local/bin/porf; \
    rm /tmp/porffor.tar.gz; \
    porf --version
