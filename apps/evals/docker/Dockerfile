# The evals' sandbox: where model-written code runs (docs/decisions/010-evals.md).
#
# Containers from this image run with no network, as the host's non-root user, with a
# read-only root filesystem, the project directory as the only writable mount, and memory,
# CPU and process limits (apps/evals/src/sandbox/session-container.ts). Everything a fixture
# needs is installed here, at build time, because nothing can be installed at run time.
#
# Node 22, as in the WebContainer. Pinned by the multi-arch index digest, so the same image
# runs on an arm64 laptop and on amd64 CI.
FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c

ENV NODE_ENV=development \
    npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false

# Fixture dependencies at /work/node_modules: a project mounted at /work/project finds them
# by Node's usual walk up the directory tree, for ES modules and CommonJS alike.
WORKDIR /work
COPY deps/package.json deps/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force && mkdir /work/project

# From here on npm is offline: the sandbox has no network, so npm fails at once with "no
# cached response" instead of retrying the registry until a command times out.
ENV npm_config_offline=true

WORKDIR /work/project
