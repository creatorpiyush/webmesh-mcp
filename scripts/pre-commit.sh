#!/usr/bin/env bash
set -e

echo "=== [Pre-commit] 1. Formatting code with Prettier ==="
npx prettier --write 'src/**/*.ts'

echo "=== [Pre-commit] 2. Type checking with TypeScript ==="
npm run typecheck

echo "=== [Pre-commit] 3. Running tests ==="
npm test

echo "✅ Pre-commit checks passed successfully!"
