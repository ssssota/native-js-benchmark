FROM debian:13.7-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl build-essential clang \
    && rm -rf /var/lib/apt/lists/*

# Pin both the release and the architecture-specific archive checksum.
RUN set -eu; \
    case "$(dpkg --print-architecture)" in \
        amd64) arch=x64; sha256=3aad90352f8596ade39428fe636b00deb75ae9558a63bb0b7b9b5ab707f85ef9 ;; \
        arm64) arch=arm64; sha256=9453deda3607e16475a25a16308ef60cd869c5fcba8eee309da14bd12d0437ed ;; \
        *) echo 'Unsupported architecture' >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/CanadaHonk/porffor/releases/download/alpha-25/porffor-linux-${arch}.tar.gz" -o /tmp/porffor.tar.gz; \
    echo "${sha256}  /tmp/porffor.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/porffor.tar.gz -C /usr/local/bin porf; \
    chmod +x /usr/local/bin/porf; \
    rm /tmp/porffor.tar.gz; \
    porf --version
