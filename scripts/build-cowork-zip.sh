#!/usr/bin/env bash
# Cowork（Claude Desktop）にアップロードするプラグインの zip を作る（Git Bash で実行する）。
# Cowork ではユーザー設定を入力できず、プラグインの Backlog の接続が必ず失敗するので、
# plugin.json から mcpServers と userConfig を外す。中身はコミット済みのもの（HEAD）を使う。
#
# 使い方: scripts/build-cowork-zip.sh [出力する zip] [settings.md]
#   settings.md を渡すと、references/settings.md をその内容に差し替える（組織の初期値を入れた zip を作るとき）
set -euo pipefail
cd "$(dirname "$0")/.."
top=$(git rev-parse --show-toplevel)
prefix=$(git rev-parse --show-prefix)  # リポジトリの中でのこのフォルダの位置（いちばん上なら空）

out="${1:-create-minutes-plugin.zip}"
settings="${2:-}"

manifest=$(git show "HEAD:${prefix}.claude-plugin/plugin.json" | node -e '
const p = JSON.parse(require("fs").readFileSync(0, "utf8"));
delete p.mcpServers;
delete p.userConfig;
process.stdout.write(JSON.stringify(p, null, 2));')

args=(--format=zip --add-virtual-file=".claude-plugin/plugin.json:$manifest")
paths=(skills)
if [ -n "$settings" ]; then
  args+=(--add-virtual-file="skills/create-minutes/references/settings.md:$(cat "$settings")")
  paths+=(":(exclude)skills/create-minutes/references/settings.md")
fi

# サブフォルダの中で git archive すると、追加したファイルにだけフォルダ名が付いてしまうので、
# リポジトリのいちばん上から、このフォルダのツリーを渡して作る
git -C "$top" archive "${args[@]}" "HEAD:$prefix" -- "${paths[@]}" > "$out"
echo "$out を作りました"
