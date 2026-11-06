#!/bin/bash
# Installs the El Subtitle Animator panel into DaVinci Resolve Studio.
#
# Copy and paste this into Terminal (or double-click this file in Finder):
#   bash "$HOME/Documents/El Subtitle Animator Plugin Main/El Subtitle Animator Plugin/Install El Subtitle Animator.command"
#
# Keep the two folders together in one main folder, wherever you put it:
#   El Subtitle Animator Plugin Main/
#     El Subtitle Animator Plugin/   the code (this file is in here)
#     El Subtitle Animator/          your presets, sounds, previews and fonts
# If you move or rename the main folder, run this installer again so the plugin finds your data.
# It asks for your Mac password because Resolve reads plugins from a system folder.
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
MAIN="$(dirname "$HERE")"
DATA="$MAIN/El Subtitle Animator"
ROOT="/Library/Application Support/Blackmagic Design/DaVinci Resolve"
OLD_DEST="$ROOT/Workflow Integration Plugins/com.wmseditors.subtitleanimator"
DEST="$ROOT/Workflow Integration Plugins/com.el.subtitleanimator"
NODE="$ROOT/Developer/Workflow Integrations/Examples/SamplePlugin/WorkflowIntegration.node"

if [ ! -f "$NODE" ]; then
    echo "Could not find Blackmagic's WorkflowIntegration.node at:"
    echo "  $NODE"
    echo "Is DaVinci Resolve Studio installed?"
    exit 1
fi

echo "Main folder:  $MAIN"
echo "Data folder:  $DATA"
echo "Installing to: $DEST"
mkdir -p "$DATA"
if [ -d "$OLD_DEST" ]; then
    sudo rm -rf "$OLD_DEST"
fi
sudo mkdir -p "$DEST"
# Only what the plugin needs at runtime: manifest.xml, package.json, main.js and src/ (dev-only files left by
# older installs are removed from the plugin folder).
sudo rsync -a --delete --delete-excluded \
    --exclude '.git' --exclude '.gitignore' --exclude '.DS_Store' --exclude '__pycache__' \
    --exclude 'node_modules' --exclude '_archive' --exclude '_debug' --exclude 'tools' --exclude 'mcp' \
    --exclude '*.command' --exclude '*.md' --exclude 'README.txt' --exclude 'eslint.config.mjs' \
    --exclude 'package-lock.json' \
    "$HERE/" "$DEST/"
sudo cp "$NODE" "$DEST/WorkflowIntegration.node"
# Tells the installed plugin where the data folder and the code folder are (read by src/main/config.js).
json_str() { local s="${1//\\/\\\\}"; printf "\"%s\"" "${s//\"/\\\"}"; }
printf "{\n  \"mainDir\": %s,\n  \"dataDir\": %s,\n  \"codeDir\": %s\n}\n" "$(json_str "$MAIN")" "$(json_str "$DATA")" "$(json_str "$HERE")" \
    | sudo tee "$DEST/data-location.json" > /dev/null
sudo chown -R "$(whoami)" "$DEST"

echo
echo "Done. Quit DaVinci Resolve completely and reopen it, then choose:"
echo "  Workspace > Workflow Integrations > El Subtitle Animator"
