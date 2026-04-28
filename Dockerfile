FROM node:22-slim
WORKDIR /app

COPY api-server/package*.json ./
RUN npm ci --omit=dev --prefer-offline

COPY api-server/src ./src
COPY api-server/tsconfig.json ./
RUN npm run build

RUN rm -rf src tsconfig.json node_modules

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]