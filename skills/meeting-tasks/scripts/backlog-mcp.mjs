// Backlog MCP（backlog-mcp-server）を起動する。plugin.json の mcpServers や、Gemini CLI・Codex の設定から node で呼ぶ。
// Windows では npx が npx.cmd なので、シェル経由で起動する（Mac・Linux はそのまま起動する）。
// node と同じフォルダにある npx が見つかるように、そのフォルダを PATH の先頭に足す。
import { spawn } from "node:child_process";
import path from "node:path";

const env = { ...process.env };
const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
env[pathKey] = [path.dirname(process.execPath), env[pathKey]].filter(Boolean).join(path.delimiter);

// シェル経由では引数を配列で渡すと Node.js が警告を出すので、Windows ではコマンドを 1 つの文字列で渡す
const isWindows = process.platform === "win32";
const child = isWindows
  ? spawn("npx -y backlog-mcp-server", { stdio: "inherit", env, shell: true })
  : spawn("npx", ["-y", "backlog-mcp-server"], { stdio: "inherit", env });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (err) => {
  console.error(`Backlog MCP を起動できませんでした: ${err.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
