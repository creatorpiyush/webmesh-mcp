#!/usr/bin/env bash
set -e

echo "=== [Pre-release] 1. Formatting code with Prettier ==="
npx prettier --write 'src/**/*.ts'

echo "=== [Pre-release] 2. Running TypeScript typecheck ==="
npm run typecheck

echo "=== [Pre-release] 3. Running test suite ==="
npm test

echo "=== [Pre-release] 4. Building production bundle (dist/) ==="
npm run build

echo "=== [Pre-release] 5. Validating package payload ==="
npm pack --dry-run

echo "🚀 All pre-release checks passed! Ready to publish via 'npm publish'."
