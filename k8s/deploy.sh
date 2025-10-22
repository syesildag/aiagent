#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
#set -e

# Optional Docker build: pass --build to enable
BUILD_IMAGE=false
for arg in "$@"; do
  if [[ "$arg" == "--build" ]]; then
    BUILD_IMAGE=true
  fi
done

if $BUILD_IMAGE; then
  echo "Building Docker image..."
  docker build -t aiagent ../
  echo "Docker image built successfully."
fi

# Source clients array from clients.list
source "$(dirname "$0")/clients.list"

for ns in "${clients[@]}"; do
  echo "Processing namespace: $ns"

  # Create namespace if it doesn't exist
  kubectl get namespace $ns >/dev/null 2>&1 || kubectl create namespace $ns

  # Create generic secret if not exists
  if ! kubectl get secret ${ns}-default-values -n $ns >/dev/null 2>&1; then
    kubectl create secret generic ${ns}-default-values \
      --from-literal=username=serkan \
      --from-literal=password=yesildag \
      -n $ns
  fi

  # Generate TLS cert/key for each client
  openssl req -x509 -nodes -days 365 -newkey rsa:4096 \
  -keyout ${ns}-aiagent-tls.key -out ${ns}-aiagent-tls.crt \
  -subj "/CN=${ns}.aiagent.local" \
  -addext "subjectAltName=DNS:${ns}.aiagent.local"

  # Create TLS secret if not exists
  if ! kubectl get secret ${ns}-aiagent-tls -n $ns >/dev/null 2>&1; then
    kubectl create secret tls ${ns}-aiagent-tls --cert=${ns}-aiagent-tls.crt --key=${ns}-aiagent-tls.key -n $ns
  fi

  # Helm install/upgrade
  helm upgrade --install aiagent ./helm/aiagent --namespace $ns

  # Clean up cert/key files
  rm ${ns}-aiagent-tls.crt ${ns}-aiagent-tls.key
done

#helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
#helm repo update
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx --namespace ingress-nginx --create-namespace