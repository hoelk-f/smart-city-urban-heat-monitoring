# Dockerfile

# Step 1: Use Node.js image to build and serve Angular App
FROM node:18 AS angular-build

# Set working directory inside the container
WORKDIR /app

# Copy Angular project files into the container
COPY . .

# Install Angular dependencies
RUN npm install

# Install Angular CLI globally
RUN npm install -g @angular/cli

# Build the Angular application for production
RUN npm run build --prod

# Expose the port for the Angular app (default is 4200 for ng serve)
EXPOSE 4200

# Serve the Angular application
CMD ["ng", "serve", "--host", "0.0.0.0", "--port", "4200"]
