FROM node:20-alpine

# Create app directory
WORKDIR /app

# Force rebuild: 2025-10-22 - Fixed health check compatibility issues with Coolify
# Updated Dockerfile to ensure proper deployment on Coolify platform

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy app source
COPY bot.js .
COPY index.html .
COPY .env.example .
COPY modules/ ./modules/

# Expose port
EXPOSE 3000

# Health check endpoint available at /health
# Coolify will handle health monitoring

# Run the bot
CMD ["node", "bot.js"]
