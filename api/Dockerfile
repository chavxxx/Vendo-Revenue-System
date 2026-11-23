FROM node:22-bookworm
WORKDIR /app
ENV NODE_ENV=production
RUN command -v openssl
COPY package.json ./
COPY node_modules ./node_modules
COPY dist ./dist
COPY prisma ./prisma
EXPOSE 3000
CMD ["sh", "-c", "./node_modules/.bin/prisma db push && node dist/server.js"]
