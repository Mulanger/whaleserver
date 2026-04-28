FROM node:22-slim
WORKDIR /app

COPY package*.json ./
RUN npm ci --include=dev

COPY src ./src
COPY tsconfig.json ./

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]