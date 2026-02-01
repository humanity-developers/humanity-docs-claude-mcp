#!/bin/bash

# Humanity Protocol Docs MCP Server - Setup Script
# Builds the server and prints the command you need to register it with Claude Code.

set -e

echo "🚀 Humanity Protocol Docs MCP Server Setup"
echo "============================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    echo "   See https://nodejs.org for installation instructions."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) found"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install
echo ""

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build
echo ""

# Verify build
if [ ! -f "dist/index.js" ]; then
    echo "❌ Build failed. dist/index.js not found."
    exit 1
fi

echo "✅ Build successful"
echo ""

# Get absolute path
CURRENT_DIR=$(pwd)
SERVER_PATH="${CURRENT_DIR}/dist/index.js"

echo "📍 Server built at: ${SERVER_PATH}"
echo ""

# Test the server starts
echo "🧪 Testing server..."
timeout 2 node dist/index.js 2>&1 | grep -q "running on stdio" && echo "✅ Server starts successfully" || echo "⚠️  Could not verify server startup (this may be okay — check dist/index.js exists)"
echo ""

# Print registration command
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 NEXT STEP — Register with Claude Code"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Run this command in your terminal:"
echo ""
echo "  claude mcp add humanity-docs --scope user node ${SERVER_PATH}"
echo ""
echo "Then open Claude Code and run /mcp to verify the connection."
echo ""
echo "If the claude command is not available, see README.md for"
echo "manual configuration instructions."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
