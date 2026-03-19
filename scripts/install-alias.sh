#!/bin/bash
# Install ppx-research alias to ~/.claude/bin/
# Works for both marketplace and direct installs.
# Cross-platform: macOS (BSD), Linux (GNU), Windows (Git Bash)

BIN_DIR="$HOME/.claude/bin"
mkdir -p "$BIN_DIR"

cat > "$BIN_DIR/ppx-research" << 'WRAPPER'
#!/bin/bash
# ppx-research — find plugin dynamically, run it
# Checks cache (marketplace install) then direct install path

# Find most recently modified ppx-research.js in plugin dirs
PLUGIN_JS=""
for dir in "$HOME/.claude/plugins/cache"/*/perplexity-research/*/bin \
           "$HOME/.claude/plugins/perplexity-research/bin"; do
  if [ -f "$dir/ppx-research.js" ]; then
    PLUGIN_JS="$dir/ppx-research.js"
    break
  fi
done

if [ -z "$PLUGIN_JS" ] || [ ! -f "$PLUGIN_JS" ]; then
  echo "Error: perplexity-research plugin not found. Install with:"
  echo "  /plugin marketplace add i-dedova/perplexity-research-plugin"
  echo "  /plugin install perplexity-research@i-dedova-perplexity-research-plugin"
  exit 1
fi
exec node "$PLUGIN_JS" "$@"
WRAPPER

chmod +x "$BIN_DIR/ppx-research"

# Add to PATH if not already there
if ! echo "$PATH" | grep -q "$BIN_DIR"; then
  for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    if [ -f "$rc" ] && ! grep -q '.claude/bin' "$rc"; then
      echo '' >> "$rc"
      echo '# Claude Code plugin aliases' >> "$rc"
      echo 'export PATH="$HOME/.claude/bin:$PATH"' >> "$rc"
    fi
  done
  export PATH="$BIN_DIR:$PATH"
fi

echo "✓ ppx-research alias installed to $BIN_DIR/ppx-research"
echo "  Restart your terminal or run: export PATH=\"\$HOME/.claude/bin:\$PATH\""
