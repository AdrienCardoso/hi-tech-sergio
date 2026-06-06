#!/usr/bin/env bash
# Создать репозиторий на GitHub и запушить (после gh auth login)
set -e
cd "$(dirname "$0")/.."

if ! gh auth status &>/dev/null; then
  echo "Сначала войди в GitHub:"
  echo "  gh auth login -h github.com -p https -w"
  exit 1
fi

gh repo create hi-tech-sergio --public --source=. --remote=origin --push \
  --description "HI-TECH SERGIO — audio visualizer with MilkDrop"

echo ""
echo "Готово. Репозиторий:"
gh repo view --web 2>/dev/null || gh repo view
