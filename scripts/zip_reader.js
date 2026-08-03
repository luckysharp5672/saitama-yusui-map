/**
 * zip_reader.js
 * 依存パッケージ無しでZIPアーカイブを読むための最小限のリーダー。
 * 「End of Central Directory」→「Central Directory」→「Local File Header」の順に
 * たどって、指定したファイル名のエントリだけをメモリに展開する。
 * 対応: 無圧縮(method 0) / DEFLATE(method 8, Node組み込みのzlibでinflate)。
 */

const zlib = require("zlib");

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

/** ファイル末尾からEnd of Central Directoryレコードを探す */
function findEOCD(buffer) {
  const maxCommentLength = 65535;
  const searchStart = Math.max(0, buffer.length - maxCommentLength - 22);
  for (let i = buffer.length - 22; i >= searchStart; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      return {
        entryCount: buffer.readUInt16LE(i + 10),
        centralDirSize: buffer.readUInt32LE(i + 12),
        centralDirOffset: buffer.readUInt32LE(i + 16)
      };
    }
  }
  throw new Error("End of Central Directory record が見つかりません（ZIPとして不正、または64bit ZIP64形式の可能性）");
}

/** Central Directory を辿り、{fileName, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset} の配列を返す */
function listEntries(buffer) {
  const eocd = findEOCD(buffer);
  const entries = [];
  let offset = eocd.centralDirOffset;
  for (let i = 0; i < eocd.entryCount; i++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error(`Central Directory のシグネチャが不正です（offset=${offset}）`);
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);

    entries.push({ fileName, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

/** 指定したエントリの中身を展開してBufferで返す */
function extractEntry(buffer, entry) {
  const off = entry.localHeaderOffset;
  if (buffer.readUInt32LE(off) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`Local File Header のシグネチャが不正です（${entry.fileName}, offset=${off}）`);
  }
  const fileNameLength = buffer.readUInt16LE(off + 26);
  const extraLength = buffer.readUInt16LE(off + 28);
  const dataStart = off + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) return Buffer.from(compressed);
  if (entry.compressionMethod === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`未対応の圧縮方式です（method=${entry.compressionMethod}, ${entry.fileName}）`);
}

module.exports = { listEntries, extractEntry };
