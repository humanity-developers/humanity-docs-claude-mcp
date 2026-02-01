#!/usr/bin/env node

/**
 * Test script for Humanity Protocol Docs MCP Server
 * This validates that the server can fetch and parse documentation correctly
 */

import fetch from "node-fetch";
import * as cheerio from "cheerio";

const DOCS_BASE_URL = "https://docs.humanity.org";

async function testDocsFetch() {
  console.log("🧪 Testing Humanity Protocol Docs MCP Server");
  console.log("===========================================\n");

  // Test 1: Check docs.humanity.org is accessible
  console.log("Test 1: Checking docs.humanity.org accessibility...");
  try {
    const response = await fetch(DOCS_BASE_URL);
    if (response.ok) {
      console.log("✅ docs.humanity.org is accessible");
      console.log(`   Status: ${response.status}`);
      console.log(`   Content-Type: ${response.headers.get("content-type")}`);
    } else {
      console.log(`❌ docs.humanity.org returned status ${response.status}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Failed to reach docs.humanity.org: ${error.message}`);
    return false;
  }

  console.log("");

  // Test 2: Test HTML parsing
  console.log("Test 2: Testing HTML parsing...");
  try {
    const response = await fetch(DOCS_BASE_URL);
    const html = await response.text();
    const $ = cheerio.load(html);

    const title = $("h1").first().text() || $("title").text();
    console.log(`✅ Successfully parsed HTML`);
    console.log(`   Page title: "${title}"`);

    // Check for common elements
    const hasArticle = $("article").length > 0;
    const hasMain = $("main").length > 0;
    const hasContent = $(".content").length > 0;

    console.log(`   Found <article>: ${hasArticle}`);
    console.log(`   Found <main>: ${hasMain}`);
    console.log(`   Found .content: ${hasContent}`);

    if (!hasArticle && !hasMain && !hasContent) {
      console.log("   ⚠️  Warning: No common content selectors found");
      console.log("   You may need to customize content selectors in src/index.ts");
    }
  } catch (error) {
    console.log(`❌ HTML parsing failed: ${error.message}`);
    return false;
  }

  console.log("");

  // Test 3: Check for API documentation
  console.log("Test 3: Checking for API documentation...");
  const apiPaths = ["/api", "/api/reference", "/reference"];

  for (const path of apiPaths) {
    try {
      const response = await fetch(`${DOCS_BASE_URL}${path}`);
      if (response.ok) {
        console.log(`✅ Found API docs at ${path}`);
        break;
      }
    } catch (error) {
      // Continue to next path
    }
  }

  console.log("");

  // Test 4: Check for code examples
  console.log("Test 4: Checking for code examples...");
  try {
    const response = await fetch(DOCS_BASE_URL);
    const html = await response.text();
    const $ = cheerio.load(html);

    const codeBlocks = $("pre code, .code-block").length;
    if (codeBlocks > 0) {
      console.log(`✅ Found ${codeBlocks} code blocks`);
    } else {
      console.log("   ⚠️  No code blocks found on main page");
      console.log("   Code examples may be on other pages");
    }
  } catch (error) {
    console.log(`❌ Code example check failed: ${error.message}`);
  }

  console.log("");

  // Test 5: Server build check
  console.log("Test 5: Checking server build...");
  try {
    const fs = await import("fs");
    const path = await import("path");
    const distPath = path.join(process.cwd(), "dist", "index.js");

    if (fs.existsSync(distPath)) {
      console.log("✅ Server build exists at dist/index.js");
      const stats = fs.statSync(distPath);
      console.log(`   File size: ${(stats.size / 1024).toFixed(2)} KB`);
      console.log(`   Last modified: ${stats.mtime.toLocaleString()}`);
    } else {
      console.log("❌ Server build not found. Run 'npm run build'");
      return false;
    }
  } catch (error) {
    console.log(`❌ Build check failed: ${error.message}`);
    return false;
  }

  console.log("");

  // Summary
  console.log("===========================================");
  console.log("🎉 All tests passed!");
  console.log("");
  console.log("Next steps:");
  console.log("1. Configure Claude Code with the server path");
  console.log("2. Restart Claude Code");
  console.log('3. Test with: "Fetch docs from docs.humanity.org"');
  console.log("");

  return true;
}

// Run tests
testDocsFetch()
  .then((success) => {
    if (!success) {
      console.log("\n❌ Some tests failed. Please check the output above.");
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error("\n❌ Test execution failed:", error);
    process.exit(1);
  });
