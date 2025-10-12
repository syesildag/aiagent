# Use official Node.js 24.9 on Alpine 3.22
FROM node:24.9-alpine3.22

# Set working directory
WORKDIR /app

# Install system dependencies (for node-gyp, if needed)
RUN apk add --no-cache python3 make g++ openssl

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Expose port (default: 443 for HTTPS, or 3000 if you use HTTP)
EXPOSE 3000

# Set environment variables (override with docker run -e or .env file)
ENV NODE_ENV=development

# Start the server
CMD ["npm", "run", "migrateDev"]
