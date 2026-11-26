// Verify bounded JPEG structure before serving bytes to the browser decoder.
function validJpeg(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 20 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8
  )
    return false;
  let offset = 2;
  let frame = false;
  let quantization = false;
  let huffman = false;
  let scan = false;

  while (offset + 1 < bytes.length) {
    if (bytes[offset++] !== 0xff) return false;
    const marker = bytes[offset++];
    if (marker === 0xd9)
      return (
        frame && quantization && huffman && scan && offset === bytes.length
      );
    if (offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    const end = offset + length;
    if (length < 2 || end > bytes.length) return false;

    if (marker === 0xc0 || marker === 0xc2) {
      if (frame || length < 11 || bytes[offset + 2] !== 8) return false;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      const components = bytes[offset + 7];
      if (
        !width ||
        !height ||
        width > 640 ||
        height > 640 ||
        ![1, 3].includes(components) ||
        length !== 8 + 3 * components
      )
        return false;
      frame = true;
    } else if (marker === 0xdb) {
      if (length < 67) return false;
      quantization = true;
    } else if (marker === 0xc4) {
      if (length < 20) return false;
      huffman = true;
    } else if (marker === 0xdd) {
      if (length !== 4) return false;
    } else if (marker === 0xda) {
      const components = bytes[offset + 2];
      if (
        !frame ||
        !quantization ||
        !huffman ||
        ![1, 2, 3].includes(components) ||
        length !== 6 + 2 * components
      )
        return false;
      let cursor = end;
      while (cursor + 1 < bytes.length) {
        if (bytes[cursor] !== 0xff) {
          cursor++;
          continue;
        }
        const next = bytes[cursor + 1];
        if (next !== 0 && (next < 0xd0 || next > 0xd7)) break;
        cursor += 2;
      }
      if (cursor <= end) return false;
      scan = true;
      offset = cursor;
      continue;
    } else if (marker !== 0xfe && (marker < 0xe0 || marker > 0xef)) {
      return false;
    }
    offset = end;
  }
  return false;
}

module.exports = { validJpeg };
