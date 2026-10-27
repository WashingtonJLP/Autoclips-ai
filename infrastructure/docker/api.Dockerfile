FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci
COPY packages/database packages/database
COPY apps/api apps/api
RUN npm run db:generate && npm run build -w @autoclips/api
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
