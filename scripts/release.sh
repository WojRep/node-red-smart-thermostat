#!/bin/bash
# Release script for @wrepinski/node-red-smart-thermostat
# Usage: ./scripts/release.sh "Commit message description"

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
PACKAGE_NAME=$(node -p "require('./package.json').name")

echo -e "${YELLOW}=== Release Script for ${PACKAGE_NAME} v${VERSION} ===${NC}"
echo ""

# Check if there are changes to commit
if git diff --cached --quiet && git diff --quiet; then
    echo -e "${RED}Error: No changes to commit${NC}"
    exit 1
fi

# Stage all changes if not already staged
if ! git diff --cached --quiet; then
    echo -e "${GREEN}Using already staged changes${NC}"
else
    echo -e "${YELLOW}Staging all changes...${NC}"
    git add -A
fi

# Get commit message from argument or use default
if [ -n "$1" ]; then
    COMMIT_MSG="$1"
else
    COMMIT_MSG="Release v${VERSION}"
fi

echo ""
echo -e "${YELLOW}Step 1: Creating commit...${NC}"
git commit -m "$(cat <<EOF
${COMMIT_MSG}
EOF
)"
echo -e "${GREEN}✓ Commit created${NC}"

echo ""
echo -e "${YELLOW}Step 2: Pushing to GitHub...${NC}"
git push origin main
echo -e "${GREEN}✓ Pushed to GitHub${NC}"

echo ""
echo -e "${YELLOW}Step 3: Building npm package...${NC}"
rm -f *.tgz 2>/dev/null || true
npm pack
PACKAGE_FILE=$(ls *.tgz 2>/dev/null | head -1)
echo -e "${GREEN}✓ Package built: ${PACKAGE_FILE}${NC}"

echo ""
echo -e "${YELLOW}Step 4: Creating GitHub Release with package...${NC}"
# Create GitHub release with the .tgz file attached
gh release create "v${VERSION}" "${PACKAGE_FILE}" \
    --title "v${VERSION}" \
    --notes "${COMMIT_MSG}

## Installation

### Via npm (recommended)
\`\`\`bash
npm install ${PACKAGE_NAME}
\`\`\`

### Manual installation
Download \`${PACKAGE_FILE}\` and run:
\`\`\`bash
cd ~/.node-red
npm install /path/to/${PACKAGE_FILE}
\`\`\`
"
echo -e "${GREEN}✓ GitHub Release created with package attached${NC}"

echo ""
echo -e "${YELLOW}Step 5: Publishing to npm...${NC}"
echo -e "${YELLOW}Running: npm publish --access public${NC}"
npm publish --access public
echo -e "${GREEN}✓ Published to npmjs.com${NC}"

echo ""
echo -e "${GREEN}=== Release Complete! ===${NC}"
echo ""
echo "Summary:"
echo "  - Version: v${VERSION}"
echo "  - Package: ${PACKAGE_FILE}"
echo "  - GitHub: https://github.com/WojRep/node-red-smart-thermostat/releases/tag/v${VERSION}"
echo "  - npm: https://www.npmjs.com/package/${PACKAGE_NAME}"
echo ""
echo -e "${YELLOW}Note: Node-RED flows library will auto-update from npm within ~1 hour${NC}"
echo "  - https://flows.nodered.org/node/${PACKAGE_NAME}"
echo ""
