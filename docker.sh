#!/usr/bin/env bash

set -e

# echo "Cleaning up existing aiagent images..."
# docker rmi -f aiagent:latest || echo "No existing aiagent:latest image to remove."
# docker rmi -f localhost:6000/aiagent:latest || echo "No existing localhost:6000/aiagent:latest image to remove."

echo "Building Docker image..."
docker build -t aiagent .

# echo "Tagging image for local registry (localhost:6000)..."
# docker tag aiagent:latest localhost:6000/aiagent:latest

# echo "Pushing image to local registry..."
# docker push localhost:6000/aiagent:latest

echo "Build complete."