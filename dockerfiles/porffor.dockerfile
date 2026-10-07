FROM debian:13.6-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl build-essential clang \
    && rm -rf /var/lib/apt/lists/*

# Pin both the release and the architecture-specific archive checksum.
RUN set -eu; \
    case "$(dpkg --print-architecture)" in \
        amd64) arch=x64; sha256=ac0977ab33ab313718d651ff120413fe545458a2db119bfc190068d9ebbc3802 ;; \
        arm64) arch=arm64; sha256=da4b5b500a6332bdc6808891efe08f6b1cc6fe577c0c343de323116d806fb3cd ;; \
        *) echo 'Unsupported architecture' >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/CanadaHonk/porffor/releases/download/alpha-15/porffor-linux-${arch}.tar.gz" -o /tmp/porffor.tar.gz; \
    echo "${sha256}  /tmp/porffor.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/porffor.tar.gz -C /usr/local/bin porf; \
    chmod +x /usr/local/bin/porf; \
    rm /tmp/porffor.tar.gz; \
    porf --version
