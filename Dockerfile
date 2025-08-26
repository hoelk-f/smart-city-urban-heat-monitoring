# Dockerfile

# Stage 1: Build the Angular application
FROM node:18 AS build

# Set working directory inside the container
WORKDIR /app

# Install dependencies based on the lock file for reproducible builds
COPY package*.json ./
RUN npm ci

# Install Angular CLI globally
RUN npm install -g @angular/cli

# Copy the rest of the project files
COPY . .

# Build the Angular app with the configured base href
RUN ng build --configuration production --base-href /smart-city-urban-heat-monitoring/

# Stage 2: Serve the built application
FROM node:18-alpine AS runtime
WORKDIR /usr/share/app

# Copy built files from the previous stage
COPY --from=build /app/dist/smart-city-urban-heat-monitoring ./

# Install a simple HTTP server to serve static content
RUN npm install -g http-server

# Expose the port used by the HTTP server
EXPOSE 4200

# Run the HTTP server
CMD ["http-server", ".", "-p", "4200"]

