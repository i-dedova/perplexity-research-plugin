#!/bin/bash
# Install ppx-research alias to ~/.claude/bin/
# Works for both marketplace and direct installs.

BIN_DIR="$HOME/.claude/bin"
mkdir -p "$BIN_DIR"

cat > "$BIN_DIR/ppx-research" << 'WRAPPER'
#!/bin/bash
# ppx-research — find plugin dynamically, run it
PLUGIN_JS=$(find "$HOME/.claude/plugins" -path "*/perplexity-research/*/bin/ppx-research.js" -newer "$HOME/.claude/plugins" 2>/dev/null | head -1)
if [ -z "$PLUGIN_JS" ]; then
  # Direct install fallback
  PLUGIN_JS="$HOME/.claude/plugins/perplexity-research/bin/ppx-research.js"
fi
if [ ! -f "$PLUGIN_JS" ]; then
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
