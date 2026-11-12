# Build do frontend React
FROM node:22-alpine AS frontend-build

WORKDIR /app/frontend

COPY frontend/package.json ./
RUN npm install --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

# Imagem única: Express serve a interface e a API na mesma origem.
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=10000

COPY backend/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY backend/server.js ./server.js
COPY backend/history-store.js ./history-store.js
COPY --from=frontend-build /app/frontend/dist ./public

EXPOSE 10000

CMD ["npm", "start"]
