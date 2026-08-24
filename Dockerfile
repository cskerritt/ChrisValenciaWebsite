# Build the Astro site, then run the Express server (serves dist/ + POST /api/book).
# Node 22 per package.json engines.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY astro.config.mjs tsconfig.json ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
