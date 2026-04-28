FROM node:22-slim AS build
WORKDIR /app
COPY api-server/package*.json ./
RUN npm ci --ignore-scripts
COPY api-server/ ./
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./
EXPOSE 3000
CMD ["node", "dist/index.js"]