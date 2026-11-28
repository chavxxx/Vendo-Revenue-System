FROM node:22-bookworm
WORKDIR /app
ENV NODE_ENV=production
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node
ENV PRISMA_SCHEMA_ENGINE_BINARY=/app/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1

RUN apt-get update && apt-get install -y --no-install-recommends git curl openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && git config --global --add safe.directory '*'

COPY package.json ./
COPY node_modules ./node_modules
COPY dist ./dist
COPY prisma ./prisma
COPY version.json* ./dist/

EXPOSE 3000
CMD ["sh", "-c", "./node_modules/.bin/prisma generate && ./node_modules/.bin/prisma db push && node dist/server.js"]
