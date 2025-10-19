#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
#set -e

#kind delete cluster --name desktop || true

# Create kind cluster
#kind create cluster --name desktop --config ./kind-config.yaml

clients=(manisa izmir)

for ns in "${clients[@]}"; do
  echo "Processing namespace: $ns"

  # Create namespace if it doesn't exist
  kubectl get namespace $ns >/dev/null 2>&1 || kubectl create namespace $ns

  # Generate TLS cert/key for each client
  openssl req -x509 -nodes -days 365 -newkey rsa:4096 \
  -keyout ${ns}-aiagent-tls.key -out ${ns}-aiagent-tls.crt \
  -subj "/CN=${ns}.aiagent.local" \
  -addext "subjectAltName=DNS:${ns}.aiagent.local"

  # Create TLS secret if not exists
  if ! kubectl get secret ${ns}-aiagent-tls -n $ns >/dev/null 2>&1; then
    kubectl create secret tls ${ns}-aiagent-tls \
      --cert=${ns}-aiagent-tls.crt \<
      --key=${ns}-aiagent-tls.key \
      -n $ns
  fi

  # Helm install/upgrade
  helm upgrade --install aiagent ./helm/aiagent --namespace $ns

  # Clean up cert/key files
  rm ${ns}-aiagent-tls.crt ${ns}-aiagent-tls.key
done

#helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
#helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx --version 4.13.3 --namespace ingress-nginx --create-namespace