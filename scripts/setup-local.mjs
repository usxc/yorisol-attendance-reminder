import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rootDir = process.cwd();
const rl = readline.createInterface({ input, output });

const subdomain = (await rl.question("Yorisoar subdomain: ")).trim();
rl.close();

if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(subdomain)) {
  throw new Error("サブドメインは1〜63文字の英数字とハイフンで、先頭と末尾は英数字にしてください。");
}

function replacePlaceholders(text) {
  return text.replaceAll("__YORISOL_SUBDOMAIN__", subdomain);
}

function writeFromTemplate(templatePath, outputPath) {
  const template = fs.readFileSync(templatePath, "utf8");
  const generated = replacePlaceholders(template);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, generated, "utf8");

  console.log(`Generated: ${path.relative(rootDir, outputPath)}`);
}

writeFromTemplate(
  path.join(rootDir, "manifest.template.json"),
  path.join(rootDir, "manifest.json")
);

writeFromTemplate(
  path.join(rootDir, "config", "config.template.js"),
  path.join(rootDir, "config", "config.local.js")
);

console.log("");
console.log("ローカル設定ファイルを生成しました。");
console.log("manifest.json と config/config.local.js はGitにコミットしないでください。");
