# Helm Chart Refactor: aiagent

## Summary
This document describes the changes made to the Helm chart and deployment scripts for multi-client support and improved configuration.

## Changes

### 1. Refactored Helm Values
- Moved service configuration under `aiagent:` in `values.yaml`:
  ```yaml
  aiagent:
    port: 3000
    targetPort: 3000
    image:
      repository: localhost:6000/aiagent
      tag: latest
  ```
- Updated all Helm templates to use `.Values.aiagent.*` for port, targetPort, and image.

### 2. Ingress TLS Secret
- Ingress now references a TLS secret named `aiagent-tls` for HTTPS termination.
- Added instructions for generating and applying the TLS secret per namespace.

### 3. Deployment Script Refactor
- Refactored `src/scripts/helm.sh` to use a `clients` array and loop for namespace creation, TLS secret generation, Helm install/upgrade, and cleanup.

### 4. Service YAML Fix
- Corrected indentation for `port` and `targetPort` under the `ports` list in `aiagent-service.yaml`.

## How to Use
- Update `values.yaml` for configuration.
- Run `src/scripts/helm.sh` to deploy for all clients.
- Ensure TLS secrets are created for each namespace.

## Example TLS Secret Creation
```
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout aiagent-tls.key -out aiagent-tls.crt \
  -subj "/CN=manisa.aiagent.local"
kubectl create secret tls aiagent-tls --cert=aiagent-tls.crt --key=aiagent-tls.key -n manisa
```

## Notes
- Only use the official NGINX Ingress controller (`nginx-ingress-ingress-nginx-controller`).
- Always use the correct Host header and port when testing Ingress externally.
