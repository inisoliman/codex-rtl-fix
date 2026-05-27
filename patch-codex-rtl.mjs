import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MARKER = "codex-rtl-runtime-fix v3";
const DEFAULT_RUNTIME_PATH = path.join(__dirname, "rtl-runtime-fix.js");
const BLOCK_SIZE = 4 * 1024 * 1024;

const args = parseArgs(process.argv.slice(2));
const asarPath = args.asar;
const runtimePath = args.runtime || DEFAULT_RUNTIME_PATH;

if (!asarPath) usage("Missing --asar <path>.");
if (!fs.existsSync(asarPath)) usage(`ASAR file does not exist: ${asarPath}`);
if (!fs.existsSync(runtimePath)) usage(`Runtime file does not exist: ${runtimePath}`);

const runtimeSource = fs.readFileSync(runtimePath, "utf8");
if (!runtimeSource.includes(MARKER)) {
  usage(`Runtime file does not contain expected marker: ${MARKER}`);
}

const archive = readAsar(asarPath);
const indexHtml = readFileFromAsar(archive, "webview/index.html").toString("utf8");
const entryScriptPath = findEntryScriptPath(indexHtml, archive.header);
const entryScript = readFileFromAsar(archive, entryScriptPath).toString("utf8");

if (entryScript.includes(MARKER)) {
  console.log(`RTL runtime already present in ${entryScriptPath}. Nothing to patch.`);
  process.exit(0);
}

const patch = [
  "",
  `;/* ${MARKER} */`,
  runtimeSource,
  `//# sourceURL=${path.basename(runtimePath)}`,
  "",
].join("\n");

archive.replacements.set(entryScriptPath, Buffer.from(`${entryScript}${patch}`, "utf8"));

if (args["dry-run"]) {
  console.log(`Dry run OK. Would append RTL runtime to ${entryScriptPath}.`);
  process.exit(0);
}

writePatchedAsar(archive, asarPath);
console.log(`Patched ${asarPath}`);
console.log(`Injected RTL runtime into ${entryScriptPath}`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      parsed["dry-run"] = true;
      continue;
    }
    if (arg === "--asar" || arg === "--runtime") {
      parsed[arg.slice(2)] = argv[++index];
      continue;
    }
    usage(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function usage(message) {
  if (message) console.error(message);
  console.error("Usage: node patch-codex-rtl.mjs --asar <app.asar> [--runtime rtl-runtime-fix.js] [--dry-run]");
  process.exit(1);
}

function readAsar(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const prefix = Buffer.alloc(16);
    fs.readSync(fd, prefix, 0, prefix.length, 0);

    const pickleHeaderSize = prefix.readUInt32LE(0);
    const headerPickleSize = prefix.readUInt32LE(4);
    const headerSize = prefix.readUInt32LE(8);
    const jsonSize = prefix.readUInt32LE(12);

    if (pickleHeaderSize !== 4 || headerPickleSize < 8 || headerSize < 4 || jsonSize < 2) {
      throw new Error("Unsupported ASAR header.");
    }

    const jsonBuffer = Buffer.alloc(jsonSize);
    fs.readSync(fd, jsonBuffer, 0, jsonSize, 16);

    return {
      filePath,
      header: JSON.parse(jsonBuffer.toString("utf8")),
      dataStart: 8 + headerPickleSize,
      replacements: new Map(),
    };
  } finally {
    fs.closeSync(fd);
  }
}

function getEntry(header, filePath) {
  const parts = filePath.split("/");
  let current = header;
  for (const part of parts) {
    current = current.files?.[part];
    if (!current) throw new Error(`Could not find ${filePath} in ASAR.`);
  }
  if (current.files) throw new Error(`${filePath} is a directory.`);
  return current;
}

function readFileFromAsar(archive, filePath) {
  if (archive.replacements.has(filePath)) return archive.replacements.get(filePath);

  const entry = getEntry(archive.header, filePath);
  if (entry.unpacked) {
    throw new Error(`${filePath} is unpacked; this patcher only reads packed web assets.`);
  }

  const buffer = Buffer.alloc(entry.size);
  const fd = fs.openSync(archive.filePath, "r");
  try {
    fs.readSync(fd, buffer, 0, entry.size, archive.dataStart + Number(entry.offset || 0));
  } finally {
    fs.closeSync(fd);
  }
  return buffer;
}

function findEntryScriptPath(indexHtml, header) {
  const scriptMatches = Array.from(indexHtml.matchAll(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["'][^>]*>/gi));
  const candidates = scriptMatches
    .map((match) => match[1].replace(/^\.\//, "webview/"))
    .filter((candidate) => candidate.startsWith("webview/assets/") && candidate.endsWith(".js"));

  for (const candidate of candidates) {
    try {
      getEntry(header, candidate);
      return candidate;
    } catch {
      // Try the next script.
    }
  }

  throw new Error("Could not locate the main webview module script in webview/index.html.");
}

function cloneHeaderWithOffsets(archive) {
  const cloned = structuredClone(archive.header);
  const files = [];
  let offset = 0;

  function visit(node, prefix = "") {
    if (!node.files) return;

    for (const [name, child] of Object.entries(node.files)) {
      const filePath = prefix ? `${prefix}/${name}` : name;

      if (child.files) {
        visit(child, filePath);
        continue;
      }

      if (child.unpacked) continue;

      const replacement = archive.replacements.get(filePath);
      const size = replacement ? replacement.length : child.size;
      child.size = size;
      child.offset = String(offset);

      if (replacement) {
        child.integrity = integrityForBuffer(replacement);
      }

      files.push({ path: filePath, entry: child, replacement });
      offset += size;
    }
  }

  visit(cloned);
  return { header: cloned, files };
}

function integrityForBuffer(buffer) {
  const blocks = [];
  for (let start = 0; start < buffer.length; start += BLOCK_SIZE) {
    blocks.push(sha256(buffer.subarray(start, Math.min(start + BLOCK_SIZE, buffer.length))));
  }

  return {
    algorithm: "SHA256",
    hash: sha256(buffer),
    blockSize: BLOCK_SIZE,
    blocks,
  };
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function makeHeaderBuffer(header) {
  const jsonBuffer = Buffer.from(JSON.stringify(header), "utf8");
  const headerSizeWithoutPadding = 4 + jsonBuffer.length;
  const paddingSize = (4 - (headerSizeWithoutPadding % 4)) % 4;
  const headerSize = headerSizeWithoutPadding + paddingSize;
  const headerPickleSize = 4 + headerSize;

  const buffer = Buffer.alloc(8 + headerPickleSize);
  buffer.writeUInt32LE(4, 0);
  buffer.writeUInt32LE(headerPickleSize, 4);
  buffer.writeUInt32LE(headerSize, 8);
  buffer.writeUInt32LE(jsonBuffer.length, 12);
  jsonBuffer.copy(buffer, 16);
  return buffer;
}

function writePatchedAsar(archive, destinationPath) {
  const { header, files } = cloneHeaderWithOffsets(archive);
  const headerBuffer = makeHeaderBuffer(header);
  const tempPath = `${destinationPath}.tmp-${process.pid}-${Date.now()}`;
  const out = fs.openSync(tempPath, "w");
  const input = fs.openSync(archive.filePath, "r");

  try {
    fs.writeSync(out, headerBuffer);

    for (const file of files) {
      if (file.replacement) {
        fs.writeSync(out, file.replacement);
        continue;
      }

      const entry = getEntry(archive.header, file.path);
      copyRange(input, out, archive.dataStart + Number(entry.offset || 0), entry.size);
    }
  } finally {
    fs.closeSync(input);
    fs.closeSync(out);
  }

  fs.renameSync(tempPath, destinationPath);
}

function copyRange(inputFd, outputFd, start, size) {
  const buffer = Buffer.allocUnsafe(Math.min(BLOCK_SIZE, Math.max(1, size)));
  let remaining = size;
  let offset = start;

  while (remaining > 0) {
    const length = Math.min(buffer.length, remaining);
    const bytesRead = fs.readSync(inputFd, buffer, 0, length, offset);
    if (bytesRead <= 0) throw new Error("Unexpected end of ASAR while copying file data.");
    fs.writeSync(outputFd, buffer, 0, bytesRead);
    remaining -= bytesRead;
    offset += bytesRead;
  }
}
