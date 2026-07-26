#!/usr/bin/env bash
set -e

BGUTIL_VERSION="1.3.1"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BGUTIL_DIR="$ROOT_DIR/bgutil-ytdlp-pot-provider"
PLUGIN_DIR="$ROOT_DIR/yt-dlp-plugins"

echo "[SETUP] Fetching bgutil-ytdlp-pot-provider server (${BGUTIL_VERSION})..."
if [ ! -d "$BGUTIL_DIR" ]; then
  git clone --single-branch --branch "$BGUTIL_VERSION" https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git "$BGUTIL_DIR"
fi

echo "[SETUP] Building server (script mode, invoked per-request by yt-dlp)..."
cd "$BGUTIL_DIR/server"
npm ci
npx tsc

echo "[SETUP] Installing PO Token provider plugin for yt-dlp..."
mkdir -p "$PLUGIN_DIR"
curl -sL "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${BGUTIL_VERSION}/bgutil-ytdlp-pot-provider.zip" -o "$PLUGIN_DIR/bgutil-ytdlp-pot-provider.zip"

echo "[SETUP] Done. Server home: $BGUTIL_DIR/server"
echo "[SETUP] Plugin dir: $PLUGIN_DIR"

