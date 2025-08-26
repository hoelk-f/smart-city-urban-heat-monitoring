# Multi-stage Dockerfile for Smart City Urban Heat Monitoring

# Stage 1: Build Angular application
FROM node:18 AS build
WORKDIR /app

# Install dependencies and build the Angular app with a base href
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build -- --configuration production --base-href /smart-city-urban-heat-monitoring/

# Stage 2: Serve app with Caddy
FROM caddy:alpine

# Copy Caddy configuration
COPY Caddyfile /etc/caddy/Caddyfile

# Copy built Angular files to Caddy's web root
COPY --from=build /app/dist/smart-city-urban-heat-monitoring /usr/share/caddy/smart-city-urban-heat-monitoring

EXPOSE 80
