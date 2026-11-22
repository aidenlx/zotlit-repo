FROM node:26-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc

# The snapshot pins both the requested packages and their dependencies.
RUN rm /etc/apt/sources.list.d/debian.sources \
    && printf '%s\n' 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20261112T000000Z/ trixie main' > /etc/apt/sources.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        dbus-x11 \
        fonts-dejavu-core \
        fonts-liberation \
        git \
        herbstluftwm \
        libasound2t64 \
        libdbus-glib-1-2 \
        libgbm1 \
        libglib2.0-bin \
        libgtk-3-0t64 \
        libnss3 \
        libxt6t64 \
        lsof \
        x11-apps \
        x11vnc \
        xvfb \
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

ARG TARGETARCH
ARG OBSIDIAN_VERSION
RUN set -eu; \
    case "$TARGETARCH" in \
      arm64) suffix=-arm64; sha=acc219e57e2630c4936e7655126572b62167ea02c2e66f8c25c948ad072b4e70 ;; \
      amd64) suffix=; sha=09074f0635ecf366307d808d0fec06c01a87a0bcc66da6d34126ceece0eb8519 ;; \
    esac; \
    base="https://github.com/obsidianmd/obsidian-releases/releases/download/v${OBSIDIAN_VERSION}"; \
    curl --fail --silent --show-error --location --retry 3 "$base/obsidian-${OBSIDIAN_VERSION}${suffix}.tar.gz" -o /tmp/installer.tar.gz; \
    echo "$sha  /tmp/installer.tar.gz" | sha256sum -c -; \
    mkdir /opt/obsidian; \
    tar -xzf /tmp/installer.tar.gz -C /opt/obsidian --strip-components=1; \
    rm /tmp/installer.tar.gz

# The installer carries this release's app. Verify the app separately.
RUN echo '42bf7f34782752f159d63c17ac6bac4ad01dd55709578f9879f76f8295abb2eb  /opt/obsidian/resources/obsidian.asar' | sha256sum -c -

ARG ZOTERO_VERSION
RUN set -eu; \
    case "$TARGETARCH" in \
      arm64) target=arm64; sha=3ef4eece2d4ee8db82e44cc203e41638824d3e8587b99f0b509efd2053e97c3a ;; \
      amd64) target=x86_64; sha=fad10b2bee0b6178248a0ffb7b4add0bc2b1e71088f47d5549423e1cc80034b8 ;; \
    esac; \
    curl --fail --silent --show-error --location --retry 3 "https://download.zotero.org/client/release/${ZOTERO_VERSION}/Zotero-${ZOTERO_VERSION}_linux-${target}.tar.xz" -o /tmp/zotero.tar.xz; \
    echo "$sha  /tmp/zotero.tar.xz" | sha256sum -c -; \
    mkdir /opt/zotero; \
    tar -xJf /tmp/zotero.tar.xz -C /opt/zotero --strip-components=1; \
    rm /tmp/zotero.tar.xz
ENV ZOTERO_APP=/opt/zotero

ARG PNPM_VERSION
RUN --mount=type=cache,target=/root/.npm npm install --global "pnpm@${PNPM_VERSION}"
RUN install -d -o node -g node -m 0775 /workspace /pnpm-store

USER node
WORKDIR /workspace
COPY --chmod=755 entry.sh /opt/run-e2e
ENTRYPOINT ["/opt/run-e2e"]
