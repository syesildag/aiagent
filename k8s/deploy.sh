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

# Read release number from release file
BASE_DIR="$(dirname "$0")"
RELEASE_FILE="$BASE_DIR/release"
RELEASE=$(cat "$RELEASE_FILE")

# Parse MAJOR.MINOR.PATCH from release file
IFS='.' read -r MAJOR MINOR PATCH <<< "$RELEASE"

if $BUILD_IMAGE; then
  echo "Building Docker image with tag: $MAJOR.$MINOR.$PATCH..."
  docker build -t syesildag/aiagent:$MAJOR.$MINOR.$PATCH ../
  echo "Docker image built successfully."
  docker push syesildag/aiagent:$MAJOR.$MINOR.$PATCH
  # Increment PATCH, roll over to MINOR and MAJOR as needed
  PATCH=$((PATCH + 1))
  if [ "$PATCH" -ge 100 ]; then
    PATCH=0
    MINOR=$((MINOR + 1))
  fi
  if [ "$MINOR" -ge 100 ]; then
    MINOR=0
    MAJOR=$((MAJOR + 1))
  fi
  echo "$MAJOR.$MINOR.$PATCH" > "$RELEASE_FILE"
fi

# Always update values.yaml and Chart.yaml to match the release version
CHART_YAML="$BASE_DIR/helm/aiagent/Chart.yaml"
VALUES_YAML="$BASE_DIR/helm/aiagent/values.yaml"
echo "Updating Helm values.yaml and Chart.yaml to version $RELEASE..."
# Update aiagent.image.tag in values.yaml (match any indentation)
sed -i '' "s/^[[:space:]]*tag:.*/    tag: $RELEASE/" "$VALUES_YAML"
# Update version in Chart.yaml
sed -i '' "s/^version:.*/version: $RELEASE/" "$CHART_YAML"

# Source clients array from clients.list
source "$BASE_DIR/clients.list"

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