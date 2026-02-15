# Deployment Guide

## Overview

This guide covers deploying the AI Agent system to production environments including Docker, Kubernetes, and traditional server deployments.

## Prerequisites

- Node.js 18+ or Docker
- PostgreSQL 15+ with pgvector extension
- SSL certificates (for HTTPS)
- LLM provider access (Ollama, OpenAI, or GitHub Copilot)

---

## Local Development

### Install Dependencies

```bash
npm install
```

### Setup Database

```bash
# Create database
createdb aiagent

# Run migrations
npm run migrate
```

### Configure Environment

```bash
cp .env.example .env
# Edit .env with your settings
```

### Start Development Server

```bash
npm run dev
```

Server runs at `https://localhost:3000`

---

## Production Build

### Build TypeScript

```bash
npm run build
```

Output in `dist/` directory.

### Start Production Server

```bash
npm start
```

### Environment Variables

```bash
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
DB_HOST=your-db-host
DB_NAME=aiagent
DB_USER=aiagent_user
DB_PASSWORD=secure_password
HMAC_SECRET_KEY=your_secure_key
LLM_PROVIDER=openai
OPENAI_API_KEY=your_api_key
```

---

## Docker Deployment

### Dockerfile

```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Production image
FROM node:18-alpine

WORKDIR /app

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

### Build Image

```bash
docker build -t aiagent:latest .
```

### Run Container

```bash
docker run -d \
  --name aiagent \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e DB_HOST=postgres \
  -e DB_USER=aiagent \
  -e DB_PASSWORD=password \
  -e OPENAI_API_KEY=your_key \
  --restart unless-stopped \
  aiagent:latest
```

---

## Docker Compose

### docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: aiagent-postgres
    environment:
      POSTGRES_DB: aiagent
      POSTGRES_USER: aiagent
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./database/migrations:/docker-entrypoint-initdb.d
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U aiagent"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  aiagent:
    build: .
    container_name: aiagent-app
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      NODE_ENV: production
      PORT: 3000
      HOST: 0.0.0.0
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: aiagent
      DB_USER: aiagent
      DB_PASSWORD: ${DB_PASSWORD}
      HMAC_SECRET_KEY: ${HMAC_SECRET_KEY}
      LLM_PROVIDER: ${LLM_PROVIDER}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      OLLAMA_HOST: ${OLLAMA_HOST}
    ports:
      - "3000:3000"
    volumes:
      - ./mcp-servers.json:/app/mcp-servers.json:ro
      - ./server.cert:/app/server.cert:ro
      - ./server.key:/app/server.key:ro
    restart: unless-stopped

  ollama:
    image: ollama/ollama:latest
    container_name: aiagent-ollama
    volumes:
      - ollama_data:/root/.ollama
    ports:
      - "11434:11434"
    restart: unless-stopped

volumes:
  postgres_data:
  ollama_data:
```

### Start Services

```bash
# Create .env file
cp .env.example .env

# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

---

## Kubernetes Deployment

### Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: aiagent
```

### ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: aiagent-config
  namespace: aiagent
data:
  NODE_ENV: "production"
  PORT: "3000"
  HOST: "0.0.0.0"
  DB_HOST: "postgres-service"
  DB_PORT: "5432"
  DB_NAME: "aiagent"
  LLM_PROVIDER: "openai"
  MAX_LLM_ITERATIONS: "2"
  CONVERSATION_HISTORY_WINDOW_SIZE: "10"
```

### Secret

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: aiagent-secrets
  namespace: aiagent
type: Opaque
stringData:
  DB_USER: "aiagent"
  DB_PASSWORD: "your_secure_password"
  HMAC_SECRET_KEY: "your_secure_hmac_key"
  OPENAI_API_KEY: "your_openai_api_key"
```

### PostgreSQL Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: aiagent
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: pgvector/pgvector:pg16
        ports:
        - containerPort: 5432
        env:
        - name: POSTGRES_DB
          value: aiagent
        - name: POSTGRES_USER
          valueFrom:
            secretKeyRef:
              name: aiagent-secrets
              key: DB_USER
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: aiagent-secrets
              key: DB_PASSWORD
        volumeMounts:
        - name: postgres-storage
          mountPath: /var/lib/postgresql/data
      volumes:
      - name: postgres-storage
        persistentVolumeClaim:
          claimName: postgres-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: postgres-service
  namespace: aiagent
spec:
  selector:
    app: postgres
  ports:
  - port: 5432
    targetPort: 5432
```

### Application Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aiagent
  namespace: aiagent
spec:
  replicas: 3
  selector:
    matchLabels:
      app: aiagent
  template:
    metadata:
      labels:
        app: aiagent
    spec:
      containers:
      - name: aiagent
        image: your-registry/aiagent:latest
        ports:
        - containerPort: 3000
        envFrom:
        - configMapRef:
            name: aiagent-config
        - secretRef:
            name: aiagent-secrets
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
            scheme: HTTPS
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
            scheme: HTTPS
          initialDelaySeconds: 10
          periodSeconds: 5
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: aiagent-service
  namespace: aiagent
spec:
  selector:
    app: aiagent
  ports:
  - port: 443
    targetPort: 3000
  type: LoadBalancer
```

### Deploy to Kubernetes

```bash
# Create namespace
kubectl apply -f k8s/namespace.yaml

# Create secrets
kubectl apply -f k8s/secrets.yaml

# Create configmap
kubectl apply -f k8s/configmap.yaml

# Deploy database
kubectl apply -f k8s/postgres.yaml

# Deploy application
kubectl apply -f k8s/deployment.yaml

# Check status
kubectl get pods -n aiagent
kubectl logs -f deployment/aiagent -n aiagent
```

---

## SSL Certificates

### Generate Self-Signed Certificate (Development)

```bash
openssl req -x509 -newkey rsa:4096 \
  -keyout server.key \
  -out server.cert \
  -days 365 \
  -nodes \
  -subj "/CN=localhost"
```

### Let's Encrypt (Production)

```bash
# Install certbot
sudo apt-get install certbot

# Generate certificate
sudo certbot certonly --standalone \
  -d your-domain.com \
  -d www.your-domain.com

# Copy certificates
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem ./server.cert
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem ./server.key
```

### Auto-Renewal

```bash
# Add to crontab
0 0 * * * certbot renew --quiet && systemctl restart aiagent
```

---

## Database Setup

### Install PostgreSQL with pgvector

```bash
# Ubuntu/Debian
sudo apt-get install postgresql-15 postgresql-contrib

# Install pgvector
cd /tmp
git clone https://github.com/pgvector/pgvector.git
cd pgvector
make
sudo make install
```

### Create Database

```sql
-- Create user
CREATE USER aiagent WITH PASSWORD 'your_secure_password';

-- Create database
CREATE DATABASE aiagent OWNER aiagent;

-- Connect to database
\c aiagent

-- Enable pgvector extension
CREATE EXTENSION vector;

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE aiagent TO aiagent;
```

### Run Migrations

```bash
npm run migrate
```

### Backup Database

```bash
# Backup
pg_dump -U aiagent -h localhost aiagent > backup.sql

# Restore
psql -U aiagent -h localhost aiagent < backup.sql
```

---

## Reverse Proxy (Nginx)

### nginx.conf

```nginx
upstream aiagent {
    server localhost:3000;
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass https://aiagent;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Test and Reload

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## Process Management (PM2)

### Install PM2

```bash
npm install -g pm2
```

### ecosystem.config.js

```javascript
module.exports = {
  apps: [{
    name: 'aiagent',
    script: 'dist/index.js',
    instances: 2,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    max_memory_restart: '1G',
    autorestart: true
  }]
};
```

### Start with PM2

```bash
# Start
pm2 start ecosystem.config.js

# Status
pm2 status

# Logs
pm2 logs

# Restart
pm2 restart aiagent

# Stop
pm2 stop aiagent

# Startup script
pm2 startup
pm2 save
```

---

## Monitoring

### Health Check Endpoint

Add to `src/index.ts`:

```typescript
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});
```

### Prometheus Metrics

```typescript
import promClient from 'prom-client';

const register = new promClient.Registry();

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

### Grafana Dashboard

```bash
# Add Prometheus datasource
# Import dashboard ID: 11159 (Node.js Application)
```

---

## Troubleshooting

### Check Logs

```bash
# Docker
docker logs aiagent

# PM2
pm2 logs aiagent

# Kubernetes
kubectl logs -f deployment/aiagent -n aiagent
```

### Database Connection Issues

```bash
# Test connection
psql -U aiagent -h localhost -d aiagent

# Check running processes
ps aux | grep postgres

# Check port
netstat -tulpn | grep 5432
```

### SSL Certificate Issues

```bash
# Test certificate
openssl s_client -connect localhost:3000

# Check expiration
openssl x509 -in server.cert -noout -dates
```

### Memory Issues

```bash
# Check memory usage
docker stats
pm2 monit

# Increase Node.js heap
NODE_OPTIONS="--max-old-space-size=4096" npm start
```

---

## Security Checklist

- [ ] Use strong HMAC_SECRET_KEY (32+ characters)
- [ ] Enable HTTPS with valid SSL certificate
- [ ] Use environment variables for secrets
- [ ] Enable rate limiting
- [ ] Set secure session timeout
- [ ] Use non-root user in Docker
- [ ] Keep dependencies updated
- [ ] Enable CORS with specific origins
- [ ] Use Helmet.js for security headers
- [ ] Implement request validation
- [ ] Enable database connection pooling
- [ ] Set up firewall rules
- [ ] Regular security audits
- [ ] Monitor for vulnerabilities

---

## Performance Optimization

### Database Indexing

```sql
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX idx_conversations_user_id ON conversations(user_id);
```

### Connection Pooling

```bash
DB_POOL_MAX=20
DB_POOL_IDLE_TIMEOUT_MS=30000
DB_POOL_CONNECTION_TIMEOUT_MS=2000
```

### Caching

```bash
EMBEDDING_CACHE_ENABLED=true
EMBEDDING_CACHE_TTL=3600000
```

### Clustering

Use PM2 cluster mode or Kubernetes replicas for horizontal scaling.

---

## Related Documentation

- [Configuration](CONFIGURATION.md)
- [Authentication](AUTHENTICATION.md)
- [Error Handling](ERROR_HANDLING.md)
- [Testing Guide](TESTING_GUIDE.md)
