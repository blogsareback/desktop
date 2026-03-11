#!/bin/bash

set -e

REPO="blogsareback/desktop"
APP="Blogs Are Back"

ARCH=$(uname -m)
OS=$(uname -s)

LATEST_JSON=$(curl -s "https://api.github.com/repos/$REPO/releases/latest")

get_download_url() {
  echo "$LATEST_JSON" | grep "browser_download_url" | grep "$1" | cut -d '"' -f 4
}

get_deb() {
  URL=$(get_download_url ".deb")
  if [ -z "$URL" ]; then echo "No .deb package found in latest release."; exit 1; fi
  echo "Downloading .deb package..."
  curl -LO "$URL"
  sudo dpkg -i "$(basename "$URL")" || sudo apt-get install -f -y
}

get_appimage() {
  URL=$(get_download_url ".AppImage")
  if [ -z "$URL" ]; then echo "No .AppImage found in latest release."; exit 1; fi
  FILENAME=$(basename "$URL")
  echo "Downloading AppImage..."
  curl -LO "$URL"
  chmod +x "$FILENAME"
  mkdir -p "$HOME/.local/bin"
  mv "$FILENAME" "$HOME/.local/bin/BlogsAreBack.AppImage"
  echo "Installed to ~/.local/bin/BlogsAreBack.AppImage"
}

detect_and_install() {
  echo "Installing $APP for $ARCH on $OS..."

  if [ "$OS" != "Linux" ]; then
    echo "This installer only supports Linux. Download for macOS or Windows at:"
    echo "https://github.com/$REPO/releases/latest"
    exit 1
  fi

  if command -v apt-get >/dev/null 2>&1; then
    get_deb
  else
    get_appimage
  fi

  echo "$APP installed successfully!"
}

detect_and_install
