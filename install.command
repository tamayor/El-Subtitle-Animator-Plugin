#!/bin/bash
# Installs the Subtitle Animator panel into DaVinci Resolve Studio.
# Run it from Terminal with:   bash install.command
# It asks for your Mac password because Resolve reads plugins from a system folder.
# bash "$HOME/Documents/Subtitle Animator Plugin/install.command"
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
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

echo "Installing to: $DEST"
if [ -d "$OLD_DEST" ]; then
    sudo rm -rf "$OLD_DEST"
fi
sudo mkdir -p "$DEST"
sudo rsync -a --delete --exclude 'install.command' --exclude 'README.txt' "$HERE/" "$DEST/"
sudo cp "$NODE" "$DEST/WorkflowIntegration.node"
sudo chown -R "$(whoami)" "$DEST"

echo
echo "Done. Quit DaVinci Resolve completely and reopen it, then choose:"
echo "  Workspace > Workflow Integrations > El Subtitle Animator"
