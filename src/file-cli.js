import { readFileSync } from "node:fs";

// Pass a runtime input path explicitly; keep it external to compiled binaries.
const path = process.argv[2];
if (!path) {
  console.error("Usage: file-cli <input.txt>");
  process.exitCode = 1;
} else {
  const text = readFileSync(path, "utf8");
  // Lines are newline-delimited records, including an unterminated final line.
  let lines = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lines++;
  }
  if (text.length > 0 && text[text.length - 1] !== "\n") lines++;
  const trimmed = text.trim();
  const words = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  console.log(JSON.stringify({ lines: lines, words: words }));
}
