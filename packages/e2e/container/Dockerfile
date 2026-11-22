FROM node:26-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc

# The snapshot pins both the requested packages and their dependencies.
RUN rm /etc/apt/sources.list.d/debian.sources \
    && printf '%s\n' 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20261112T000000Z/ trixie main' > /etc/apt/sources.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl dbus-x11 fonts-dejavu-core fonts-liberation git herbstluftwm libasound2t64 libdbus-glib-1-2 libgbm1 libgtk-3-0t64 libnss3 libxt6t64 lsof x11-apps x11vnc xvfb xz-utils \
    && rm -rf /var/lib/apt/lists/*

ARG TARGETARCH
ARG PNPM_VERSION
RUN npm install --global "pnpm@${PNPM_VERSION}"

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

WORKDIR /workspace
COPY --chmod=755 entry.sh /opt/run-e2e
ENTRYPOINT ["/opt/run-e2e"]
