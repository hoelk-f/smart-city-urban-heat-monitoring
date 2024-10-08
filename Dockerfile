# Step 1: Use Node.js image to build and serve Angular App
FROM node:18 AS angular-build

# Set working directory inside the container
WORKDIR /app

# Copy Angular project files into the container
COPY . .

# Install Angular dependencies
RUN npm install

# Build the Angular application for production
RUN npm run build --prod

# Step 2: Set up Python environment and include Node.js for Angular serving
FROM python:3.9-slim

# Set working directory inside the final container
WORKDIR /app

# Install Node.js and npm in the Python container
RUN apt-get update && apt-get install -y curl \
    && curl -sL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs

# Verify installation (optional, just for debugging)
RUN node -v && npm -v

# Copy the entire Angular application and Python script
COPY --from=angular-build /app /app

# Copy CSV files and update script to the assets directory
COPY src/assets/fetch_weatherdata.py /app/src/assets/fetch_weatherdata.py
COPY src/assets/sensors.csv /app/src/assets/sensors.csv

# Install necessary Python packages
RUN pip install pandas numpy requests

# Install Angular CLI globally to serve the application
RUN npm install -g @angular/cli

# Expose the port for the Angular app (default is 4200 for ng serve)
EXPOSE 4200

# Run both Angular and the Python script concurrently
CMD ["sh", "-c", "python /app/src/assets/fetch_weatherdata.py & ng serve --host 0.0.0.0 --port 4200"]