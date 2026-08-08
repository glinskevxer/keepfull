# The image the yard machine runs.
#
# Two stages, because better-sqlite3 needs a toolchain to build and nothing
# needs that toolchain afterwards. The runtime stage carries node, the compiled
# javascript and the production dependencies, and nothing else.

FROM node:20.18.1-bookworm-slim AS build
WORKDIR /app

# python3 and a compiler, for the native sqlite binding
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Reinstall with the toolchain still present, so the native binding that ends up
# in the runtime image is one that was actually built here.
RUN npm ci --omit=dev --no-audit --no-fund


FROM node:20.18.1-bookworm-slim AS runtime
WORKDIR /app

# Set by the build so a running container can say what it is.
ARG GIT_COMMIT=""
ARG BUILT_AT=""
ENV GIT_COMMIT=$GIT_COMMIT BUILT_AT=$BUILT_AT

ENV NODE_ENV=production \
    DATABASE_PATH=/var/lib/keepfull/keepfull.db \
    HOST=0.0.0.0 \
    PORT=8080

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# The database lives outside the image. A container that writes its data into
# its own layer loses it on the next deploy, which is a lesson this yard has
# already paid for once with a different tool.
RUN mkdir -p /var/lib/keepfull && chown -R node:node /var/lib/keepfull
VOLUME ["/var/lib/keepfull"]

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "dist/health-probe.js"]

CMD ["node", "dist/api/main.js"]
