#!/usr/bin/env bash
set -euo pipefail
# Linux x86_64 only. Binaries are pinned by version AND reviewed SHA-256.
tool_dir=$(mktemp -d)
trap 'rm -rf "$tool_dir"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz -o "$tool_dir/actionlint.tar.gz"
echo "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8  $tool_dir/actionlint.tar.gz" | sha256sum -c -
tar -xzf "$tool_dir/actionlint.tar.gz" -C "$tool_dir" actionlint
"$tool_dir/actionlint"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz -o "$tool_dir/gitleaks.tar.gz"
echo "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb  $tool_dir/gitleaks.tar.gz" | sha256sum -c -
tar -xzf "$tool_dir/gitleaks.tar.gz" -C "$tool_dir" gitleaks
# Redact all findings; never print secret values.
"$tool_dir/gitleaks" git --redact=100 --no-banner .
mkdir "$tool_dir/source"
git ls-files -z | tar --null -T - -cf - | tar -xf - -C "$tool_dir/source"
"$tool_dir/gitleaks" dir --redact=100 --no-banner "$tool_dir/source"
