# Multi-stage Dockerfile for Smart City Urban Heat Monitoring

# Stage 1: Build Angular application
FROM node:18 AS build
WORKDIR /app

# Install dependencies and build the Angular app with a base href
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build -- --configuration production --base-href /smart-city-urban-heat-monitoring/

# Stage 2: Serve app with Nginx
FROM nginx:alpine
COPY --from=build /app/dist/smart-city-urban-heat-monitoring /usr/share/nginx/html/smart-city-urban-heat-monitoring
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
