FROM node:22-slim AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist ./dist
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]