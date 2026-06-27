# syntax=docker/dockerfile:1
# Build the Expo web export and serve it with nginx (same-origin /api proxy).
# Mirrors the agent-chat-ui pattern; built for arm64 in CI like the other images.

FROM node:22-slim AS builder
WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Build the static web bundle. The relative /api base keeps the image
# deployment-independent (nginx proxies it to langgraph-api at runtime).
COPY . .
ENV EXPO_PUBLIC_API_URL=/api
RUN npx expo export -p web --output-dir dist

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
