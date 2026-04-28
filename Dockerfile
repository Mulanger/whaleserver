FROM node:22-slim
WORKDIR /app

COPY api-server/package*.json ./
RUN npm ci --include=dev

COPY api-server/src ./src
COPY api-server/tsconfig.json ./

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]