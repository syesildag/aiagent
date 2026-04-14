#!/usr/bin/env bash
# export-pdf.sh — Export an HTML presentation to PDF
#
# Usage:
#   bash scripts/export-pdf.sh <path-to-html> [output.pdf]
#
# Examples:
#   bash scripts/export-pdf.sh ./my-deck/index.html
#   bash scripts/export-pdf.sh ./presentation.html ./presentation.pdf
#
# What this does:
#   1. Starts a local server to serve the HTML (fonts and assets need HTTP)
#   2. Uses Playwright to screenshot each slide at 1920x1080
#   3. Combines all screenshots into a single PDF
#   4. Cleans up the server and temp files
#
# The PDF preserves colors, fonts, and layout — but not animations.
# Perfect for email attachments, printing, or embedding in documents.
set -euo pipefail

# ─── Colors ────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}ℹ${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*" >&2; }

# ─── Parse flags ──────────────────────────────────────────

# Default resolution: 1920x1080 (full HD, ~1-2MB per slide)
# Compact resolution: 1280x720 (HD, ~50-70% smaller files)
VIEWPORT_W=1920
VIEWPORT_H=1080
COMPACT=false

POSITIONAL=()
for arg in "$@"; do
    case $arg in
        --compact)
            COMPACT=true
            VIEWPORT_W=1280
            VIEWPORT_H=720
            ;;
        *)
            POSITIONAL+=("$arg")
            ;;
    esac
done
set -- "${POSITIONAL[@]}"

# ─── Input validation ─────────────────────────────────────

if [[ $# -lt 1 ]]; then
    err "Usage: bash scripts/export-pdf.sh <path-to-html> [output.pdf] [--compact]"
    err ""
    err "Examples:"
    err "  bash scripts/export-pdf.sh ./my-deck/index.html"
    err "  bash scripts/export-pdf.sh ./presentation.html ./slides.pdf"
    err "  bash scripts/export-pdf.sh ./presentation.html --compact   # smaller file size"
    exit 1
fi

INPUT_HTML="$1"
if [[ ! -f "$INPUT_HTML" ]]; then
    err "File not found: $INPUT_HTML"
    exit 1
fi

# Resolve to absolute path
INPUT_HTML=$(cd "$(dirname "$INPUT_HTML")" && pwd)/$(basename "$INPUT_HTML")

# Output PDF path: use second argument or derive from input name
if [[ $# -ge 2 ]]; then
    OUTPUT_PDF="$2"
else
    OUTPUT_PDF="$(dirname "$INPUT_HTML")/$(basename "$INPUT_HTML" .html).pdf"
fi

# Resolve output to absolute path
OUTPUT_DIR=$(dirname "$OUTPUT_PDF")
mkdir -p "$OUTPUT_DIR"
OUTPUT_PDF="$OUTPUT_DIR/$(basename "$OUTPUT_PDF")"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}║       Export Slides to PDF            ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"
echo ""

# ─── Step 1: Check dependencies ───────────────────────────

info "Checking dependencies..."

if ! command -v npx &>/dev/null; then
    err "Node.js is required but not installed."
    err ""
    err "Install Node.js:"
    err "  macOS:   brew install node"
    err "  or visit https://nodejs.org and download the installer"
    exit 1
fi

ok "Node.js found"

# ─── Step 2: Create the export script ─────────────────────

# We use a temporary Node.js script with Playwright to:
# 1. Start a local server (so fonts load correctly)
# 2. Navigate to each slide
# 3. Screenshot each slide at 1920x1080 (16:9 landscape)
# 4. Combine into a single PDF

TEMP_DIR=$(mktemp -d)
TEMP_SCRIPT="$TEMP_DIR/export-slides.mjs"

# Figure out which directory to serve (the folder containing the HTML)
SERVE_DIR=$(dirname "$INPUT_HTML")
HTML_FILENAME=$(basename "$INPUT_HTML")

# Copy the export script (export-slides.mjs lives alongside this script)
cp "$(dirname "$0")/export-slides.mjs" "$TEMP_SCRIPT"

# ─── Step 3: Install Playwright in temp directory ──────────
# We install Playwright locally in the temp dir so the Node script can import it.
# This avoids polluting global packages and ensures the script is self-contained.

info "Setting up Playwright (headless browser for screenshots)..."
info "This may take a moment on first run..."
echo ""

cd "$TEMP_DIR"

# Create a minimal package.json so npm install works
cat > "$TEMP_DIR/package.json" << 'PKG'
{ "name": "slide-export", "private": true, "type": "module" }
PKG

# Install Playwright into the temp directory
npm install playwright &>/dev/null || {
    err "Failed to install Playwright."
    err "Try running: npm install playwright"
    rm -rf "$TEMP_DIR"
    exit 1
}

# Ensure Chromium browser binary is downloaded
npx playwright install chromium 2>/dev/null || {
    err "Failed to install Chromium browser for Playwright."
    err "Try running manually: npx playwright install chromium"
    rm -rf "$TEMP_DIR"
    exit 1
}
ok "Playwright ready"
echo ""

# ─── Step 4: Run the export ───────────────────────────────

SCREENSHOT_DIR="$TEMP_DIR/screenshots"

info "Exporting slides to PDF..."
echo ""

# Run from the temp dir so Node can find the locally-installed playwright
if [[ "$COMPACT" == "true" ]]; then
    info "Using compact mode (1280×720) for smaller file size"
fi

node "$TEMP_SCRIPT" "$SERVE_DIR" "$HTML_FILENAME" "$OUTPUT_PDF" "$SCREENSHOT_DIR" "$VIEWPORT_W" "$VIEWPORT_H" || {
    err "PDF export failed."
    rm -rf "$TEMP_DIR"
    exit 1
}

# ─── Step 5: Cleanup and success ──────────────────────────

rm -rf "$TEMP_DIR"

echo ""
echo -e "${BOLD}════════════════════════════════════════${NC}"
ok "PDF exported successfully!"
echo ""
echo -e "  ${BOLD}File:${NC}  $OUTPUT_PDF"
echo ""
FILE_SIZE=$(du -h "$OUTPUT_PDF" | cut -f1 | xargs)
echo "  Size: $FILE_SIZE"
echo ""
echo "  This PDF works everywhere — email, Slack, Notion, print."
echo "  Note: Animations are not preserved (it's a static export)."
echo -e "${BOLD}════════════════════════════════════════${NC}"
echo ""

# Open the PDF automatically
if command -v open &>/dev/null; then
    open "$OUTPUT_PDF"
elif command -v xdg-open &>/dev/null; then
    xdg-open "$OUTPUT_PDF"
fi
