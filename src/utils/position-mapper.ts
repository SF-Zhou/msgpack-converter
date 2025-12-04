import JSONBig from 'json-bigint';

// Create a custom JSON parser that uses BigInt for large integers
const JSONBigNative = JSONBig({ useNativeBigInt: true });

/**
 * Represents a mapping between a JSON text range and its corresponding HEX byte range.
 */
export interface PositionMapping {
  // JSON text position (character indices in the JSON string)
  jsonStart: number;
  jsonEnd: number;
  // HEX byte position (byte indices in the msgpack data)
  hexStart: number;
  hexEnd: number;
  // Type of the mapped element
  type: 'key' | 'value' | 'container';
}

/**
 * Skip whitespace characters in a JSON string starting from a given position.
 */
function skipWhitespace(jsonString: string, pos: number): number {
  while (pos < jsonString.length && /\s/.test(jsonString[pos])) {
    pos++;
  }
  return pos;
}

/**
 * Skip whitespace and specified delimiter characters in a JSON string.
 */
function skipWhitespaceAndDelimiters(
  jsonString: string,
  pos: number,
  delimiters: string
): number {
  while (
    pos < jsonString.length &&
    (/\s/.test(jsonString[pos]) || delimiters.includes(jsonString[pos]))
  ) {
    pos++;
  }
  return pos;
}

/**
 * Parse a msgpack value and track the byte range it occupies.
 * Returns the decoded value and the end position.
 */
function parseMsgpackValue(
  data: Uint8Array,
  pos: number
): { value: unknown; endPos: number } {
  const byte = data[pos];

  // Positive fixint (0x00 - 0x7f)
  if (byte <= 0x7f) {
    return { value: byte, endPos: pos + 1 };
  }

  // Negative fixint (0xe0 - 0xff)
  if (byte >= 0xe0) {
    return { value: byte - 256, endPos: pos + 1 };
  }

  // fixmap (0x80 - 0x8f)
  if (byte >= 0x80 && byte <= 0x8f) {
    const count = byte & 0x0f;
    let currentPos = pos + 1;
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < count; i++) {
      const keyResult = parseMsgpackValue(data, currentPos);
      currentPos = keyResult.endPos;
      const valueResult = parseMsgpackValue(data, currentPos);
      currentPos = valueResult.endPos;
      obj[String(keyResult.value)] = valueResult.value;
    }
    return { value: obj, endPos: currentPos };
  }

  // fixarray (0x90 - 0x9f)
  if (byte >= 0x90 && byte <= 0x9f) {
    const count = byte & 0x0f;
    let currentPos = pos + 1;
    const arr: unknown[] = [];
    for (let i = 0; i < count; i++) {
      const result = parseMsgpackValue(data, currentPos);
      arr.push(result.value);
      currentPos = result.endPos;
    }
    return { value: arr, endPos: currentPos };
  }

  // fixstr (0xa0 - 0xbf)
  if (byte >= 0xa0 && byte <= 0xbf) {
    const length = byte & 0x1f;
    const strBytes = data.slice(pos + 1, pos + 1 + length);
    const str = new TextDecoder().decode(strBytes);
    return { value: str, endPos: pos + 1 + length };
  }

  // nil
  if (byte === 0xc0) {
    return { value: null, endPos: pos + 1 };
  }

  // false
  if (byte === 0xc2) {
    return { value: false, endPos: pos + 1 };
  }

  // true
  if (byte === 0xc3) {
    return { value: true, endPos: pos + 1 };
  }

  // bin 8
  if (byte === 0xc4) {
    const length = data[pos + 1];
    return { value: data.slice(pos + 2, pos + 2 + length), endPos: pos + 2 + length };
  }

  // bin 16
  if (byte === 0xc5) {
    const length = (data[pos + 1] << 8) | data[pos + 2];
    return { value: data.slice(pos + 3, pos + 3 + length), endPos: pos + 3 + length };
  }

  // bin 32
  if (byte === 0xc6) {
    const length =
      ((data[pos + 1] << 24) | (data[pos + 2] << 16) | (data[pos + 3] << 8) | data[pos + 4]) >>> 0;
    return { value: data.slice(pos + 5, pos + 5 + length), endPos: pos + 5 + length };
  }

  // float 32
  if (byte === 0xca) {
    const view = new DataView(data.buffer, data.byteOffset + pos + 1, 4);
    return { value: view.getFloat32(0, false), endPos: pos + 5 };
  }

  // float 64
  if (byte === 0xcb) {
    const view = new DataView(data.buffer, data.byteOffset + pos + 1, 8);
    return { value: view.getFloat64(0, false), endPos: pos + 9 };
  }

  // uint 8
  if (byte === 0xcc) {
    return { value: data[pos + 1], endPos: pos + 2 };
  }

  // uint 16
  if (byte === 0xcd) {
    const value = (data[pos + 1] << 8) | data[pos + 2];
    return { value, endPos: pos + 3 };
  }

  // uint 32
  if (byte === 0xce) {
    const value =
      ((data[pos + 1] << 24) | (data[pos + 2] << 16) | (data[pos + 3] << 8) | data[pos + 4]) >>> 0;
    return { value, endPos: pos + 5 };
  }

  // uint 64
  if (byte === 0xcf) {
    const view = new DataView(data.buffer, data.byteOffset + pos + 1, 8);
    const value = view.getBigUint64(0, false);
    return { value, endPos: pos + 9 };
  }

  // int 8
  if (byte === 0xd0) {
    const value = data[pos + 1];
    return { value: value > 127 ? value - 256 : value, endPos: pos + 2 };
  }

  // int 16
  if (byte === 0xd1) {
    const value = (data[pos + 1] << 8) | data[pos + 2];
    return { value: value > 32767 ? value - 65536 : value, endPos: pos + 3 };
  }

  // int 32
  if (byte === 0xd2) {
    const view = new DataView(data.buffer, data.byteOffset + pos + 1, 4);
    return { value: view.getInt32(0, false), endPos: pos + 5 };
  }

  // int 64
  if (byte === 0xd3) {
    const view = new DataView(data.buffer, data.byteOffset + pos + 1, 8);
    const value = view.getBigInt64(0, false);
    return { value, endPos: pos + 9 };
  }

  // str 8
  if (byte === 0xd9) {
    const length = data[pos + 1];
    const strBytes = data.slice(pos + 2, pos + 2 + length);
    const str = new TextDecoder().decode(strBytes);
    return { value: str, endPos: pos + 2 + length };
  }

  // str 16
  if (byte === 0xda) {
    const length = (data[pos + 1] << 8) | data[pos + 2];
    const strBytes = data.slice(pos + 3, pos + 3 + length);
    const str = new TextDecoder().decode(strBytes);
    return { value: str, endPos: pos + 3 + length };
  }

  // str 32
  if (byte === 0xdb) {
    const length =
      ((data[pos + 1] << 24) | (data[pos + 2] << 16) | (data[pos + 3] << 8) | data[pos + 4]) >>> 0;
    const strBytes = data.slice(pos + 5, pos + 5 + length);
    const str = new TextDecoder().decode(strBytes);
    return { value: str, endPos: pos + 5 + length };
  }

  // array 16
  if (byte === 0xdc) {
    const count = (data[pos + 1] << 8) | data[pos + 2];
    let currentPos = pos + 3;
    const arr: unknown[] = [];
    for (let i = 0; i < count; i++) {
      const result = parseMsgpackValue(data, currentPos);
      arr.push(result.value);
      currentPos = result.endPos;
    }
    return { value: arr, endPos: currentPos };
  }

  // array 32
  if (byte === 0xdd) {
    const count =
      ((data[pos + 1] << 24) | (data[pos + 2] << 16) | (data[pos + 3] << 8) | data[pos + 4]) >>> 0;
    let currentPos = pos + 5;
    const arr: unknown[] = [];
    for (let i = 0; i < count; i++) {
      const result = parseMsgpackValue(data, currentPos);
      arr.push(result.value);
      currentPos = result.endPos;
    }
    return { value: arr, endPos: currentPos };
  }

  // map 16
  if (byte === 0xde) {
    const count = (data[pos + 1] << 8) | data[pos + 2];
    let currentPos = pos + 3;
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < count; i++) {
      const keyResult = parseMsgpackValue(data, currentPos);
      currentPos = keyResult.endPos;
      const valueResult = parseMsgpackValue(data, currentPos);
      currentPos = valueResult.endPos;
      obj[String(keyResult.value)] = valueResult.value;
    }
    return { value: obj, endPos: currentPos };
  }

  // map 32
  if (byte === 0xdf) {
    const count =
      ((data[pos + 1] << 24) | (data[pos + 2] << 16) | (data[pos + 3] << 8) | data[pos + 4]) >>> 0;
    let currentPos = pos + 5;
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < count; i++) {
      const keyResult = parseMsgpackValue(data, currentPos);
      currentPos = keyResult.endPos;
      const valueResult = parseMsgpackValue(data, currentPos);
      currentPos = valueResult.endPos;
      obj[String(keyResult.value)] = valueResult.value;
    }
    return { value: obj, endPos: currentPos };
  }

  // fixext 1
  if (byte === 0xd4) {
    return { value: data.slice(pos, pos + 3), endPos: pos + 3 };
  }

  // fixext 2
  if (byte === 0xd5) {
    return { value: data.slice(pos, pos + 4), endPos: pos + 4 };
  }

  // fixext 4
  if (byte === 0xd6) {
    return { value: data.slice(pos, pos + 6), endPos: pos + 6 };
  }

  // fixext 8
  if (byte === 0xd7) {
    return { value: data.slice(pos, pos + 10), endPos: pos + 10 };
  }

  // fixext 16
  if (byte === 0xd8) {
    return { value: data.slice(pos, pos + 18), endPos: pos + 18 };
  }

  // ext 8
  if (byte === 0xc7) {
    const length = data[pos + 1];
    return { value: data.slice(pos, pos + 3 + length), endPos: pos + 3 + length };
  }

  // ext 16
  if (byte === 0xc8) {
    const length = (data[pos + 1] << 8) | data[pos + 2];
    return { value: data.slice(pos, pos + 4 + length), endPos: pos + 4 + length };
  }

  // ext 32
  if (byte === 0xc9) {
    const length =
      ((data[pos + 1] << 24) | (data[pos + 2] << 16) | (data[pos + 3] << 8) | data[pos + 4]) >>> 0;
    return { value: data.slice(pos, pos + 6 + length), endPos: pos + 6 + length };
  }

  throw new Error(`Unknown msgpack format byte: 0x${byte.toString(16)} at position ${pos}`);
}

/**
 * Build position mappings between msgpack bytes and JSON text positions.
 * This traverses the msgpack data and correlates it with the formatted JSON output.
 */
function buildMappings(
  data: Uint8Array,
  jsonString: string,
  mappings: PositionMapping[],
  hexPos: number,
  jsonPos: number
): { hexEnd: number; jsonEnd: number } {
  const byte = data[hexPos];

  // Skip whitespace in JSON
  jsonPos = skipWhitespace(jsonString, jsonPos);

  // Positive fixint (0x00 - 0x7f)
  if (byte <= 0x7f) {
    const valueStr = String(byte);
    const endJsonPos = jsonPos + valueStr.length;
    mappings.push({
      jsonStart: jsonPos,
      jsonEnd: endJsonPos,
      hexStart: hexPos,
      hexEnd: hexPos + 1,
      type: 'value',
    });
    return { hexEnd: hexPos + 1, jsonEnd: endJsonPos };
  }

  // Negative fixint (0xe0 - 0xff)
  if (byte >= 0xe0) {
    const value = byte - 256;
    const valueStr = String(value);
    const endJsonPos = jsonPos + valueStr.length;
    mappings.push({
      jsonStart: jsonPos,
      jsonEnd: endJsonPos,
      hexStart: hexPos,
      hexEnd: hexPos + 1,
      type: 'value',
    });
    return { hexEnd: hexPos + 1, jsonEnd: endJsonPos };
  }

  // fixmap (0x80 - 0x8f)
  if (byte >= 0x80 && byte <= 0x8f) {
    const count = byte & 0x0f;
    // Skip opening brace
    if (jsonString[jsonPos] === '{') {
      jsonPos++;
    }
    let currentHexPos = hexPos + 1;
    let currentJsonPos = jsonPos;

    for (let i = 0; i < count; i++) {
      // Skip whitespace and comma
      currentJsonPos = skipWhitespaceAndDelimiters(jsonString, currentJsonPos, ',');

      // Parse key
      const keyHexStart = currentHexPos;
      const keyResult = parseMsgpackValue(data, currentHexPos);
      currentHexPos = keyResult.endPos;

      // Find key in JSON (it's a quoted string)
      if (jsonString[currentJsonPos] === '"') {
        const keyStr = JSONBigNative.stringify(keyResult.value);
        const keyEndJsonPos = currentJsonPos + keyStr.length;
        mappings.push({
          jsonStart: currentJsonPos,
          jsonEnd: keyEndJsonPos,
          hexStart: keyHexStart,
          hexEnd: currentHexPos,
          type: 'key',
        });
        currentJsonPos = keyEndJsonPos;
      }

      // Skip colon and whitespace
      currentJsonPos = skipWhitespaceAndDelimiters(jsonString, currentJsonPos, ':');

      // Parse value recursively
      const valueResult = buildMappings(data, jsonString, mappings, currentHexPos, currentJsonPos);
      currentHexPos = valueResult.hexEnd;
      currentJsonPos = valueResult.jsonEnd;
    }

    // Skip closing brace
    currentJsonPos = skipWhitespace(jsonString, currentJsonPos);
    if (jsonString[currentJsonPos] === '}') {
      currentJsonPos++;
    }

    return { hexEnd: currentHexPos, jsonEnd: currentJsonPos };
  }

  // fixarray (0x90 - 0x9f)
  if (byte >= 0x90 && byte <= 0x9f) {
    const count = byte & 0x0f;
    // Skip opening bracket
    if (jsonString[jsonPos] === '[') {
      jsonPos++;
    }
    let currentHexPos = hexPos + 1;
    let currentJsonPos = jsonPos;

    for (let i = 0; i < count; i++) {
      // Skip whitespace and comma
      currentJsonPos = skipWhitespaceAndDelimiters(jsonString, currentJsonPos, ',');

      // Parse value recursively
      const valueResult = buildMappings(data, jsonString, mappings, currentHexPos, currentJsonPos);
      currentHexPos = valueResult.hexEnd;
      currentJsonPos = valueResult.jsonEnd;
    }

    // Skip closing bracket
    currentJsonPos = skipWhitespace(jsonString, currentJsonPos);
    if (jsonString[currentJsonPos] === ']') {
      currentJsonPos++;
    }

    return { hexEnd: currentHexPos, jsonEnd: currentJsonPos };
  }

  // fixstr (0xa0 - 0xbf)
  if (byte >= 0xa0 && byte <= 0xbf) {
    const length = byte & 0x1f;
    const strBytes = data.slice(hexPos + 1, hexPos + 1 + length);
    const str = new TextDecoder().decode(strBytes);
    const jsonStr = JSONBigNative.stringify(str);
    const endJsonPos = jsonPos + jsonStr.length;
    mappings.push({
      jsonStart: jsonPos,
      jsonEnd: endJsonPos,
      hexStart: hexPos,
      hexEnd: hexPos + 1 + length,
      type: 'value',
    });
    return { hexEnd: hexPos + 1 + length, jsonEnd: endJsonPos };
  }

  // nil
  if (byte === 0xc0) {
    const endJsonPos = jsonPos + 4; // "null"
    mappings.push({
      jsonStart: jsonPos,
      jsonEnd: endJsonPos,
      hexStart: hexPos,
      hexEnd: hexPos + 1,
      type: 'value',
    });
    return { hexEnd: hexPos + 1, jsonEnd: endJsonPos };
  }

  // false
  if (byte === 0xc2) {
    const endJsonPos = jsonPos + 5; // "false"
    mappings.push({
      jsonStart: jsonPos,
      jsonEnd: endJsonPos,
      hexStart: hexPos,
      hexEnd: hexPos + 1,
      type: 'value',
    });
    return { hexEnd: hexPos + 1, jsonEnd: endJsonPos };
  }

  // true
  if (byte === 0xc3) {
    const endJsonPos = jsonPos + 4; // "true"
    mappings.push({
      jsonStart: jsonPos,
      jsonEnd: endJsonPos,
      hexStart: hexPos,
      hexEnd: hexPos + 1,
      type: 'value',
    });
    return { hexEnd: hexPos + 1, jsonEnd: endJsonPos };
  }

  // float 32
  if (byte === 0xca) {
    const view = new DataView(data.buffer, data.byteOffset + hexPos + 1, 4);
    const value = view.getFloat32(0, false);
    const valueStr = JSONBigNative.stringify(value);
    const endJsonPos = jsonPos + valueStr.length;
    mappings.push({
      jsonStart: jsonPos,
      jsonEnd: endJsonPos,
      hexStart: hexPos,
      hexEnd: hexPos + 5,
      type: 'value',
    });
    return { hexEnd: hexPos + 5, jsonEnd: endJsonPos };
  }

  // float 64
  if (byte === 0xcb) {
    const view = new DataView(data.buffer, data.byteOffset + hexPos + 1, 8);
    const value = view.getFloat64(0, false);
    const valueStr = JSONBigNative.stringify(value);
    const endJsonPos = jsonPos + valueStr.length;
    mappings.push({
      jsonStart: jsonPos,
      jsonEnd: endJsonPos,
      hexStart: hexPos,
      hexEnd: hexPos + 9,
      type: 'value',
    });
    return { hexEnd: hexPos + 9, jsonEnd: endJsonPos };
  }

  // uint 8
  if (byte === 0xcc) {
    const value = data[hexPos + 1];
    const valueStr = String(value);
    const endJsonPos = jsonPos + valueStr.length;
    mappings.push({
      jsonStart: jsonPos,
      jsonEnd: endJsonPos,
      hexStart: hexPos,
      hexEnd: hexPos + 2,
      type: 'value',
    });
    return { hexEnd: hexPos + 2, jsonEnd: endJsonPos };
  }

  // uint 16
  if (byte === 0xcd) {
    const value = (data[hexPos + 1] << 8) | data[hexPos + 2];
    const valueStr = String(value);
    const endJsonPos = jsonPos + valueStr.length;
    mappings.push({
      jsonStart: jsonPos,
      jsonEnd: endJsonPos,
      hexStart: hexPos,
      hexEnd: hexPos + 3,
      type: 'value',
    });
    return { hexEnd: hexPos + 3, jsonEnd: endJsonPos };
  }

  // uint 32
  if (byte === 0xce) {
    const value =
      ((data[hexPos + 1] << 24) |
        (data[hexPos + 2] << 16) |
        (data[hexPos + 3] << 8) |
        data[hexPos + 4]) >>>
      0;
    const valueStr = String(value);
    const endJsonPos = jsonPos + valueStr.length;
    mappings.push({
      jsonStart: jsonPos,
      jsonEnd: endJsonPos,
      hexStart: hexPos,
      hexEnd: hexPos + 5,
      type: 'value',
    });
    return { hexEnd: hexPos + 5, jsonEnd: endJsonPos };
  }

  // uint 64
  if (byte === 0xcf) {
    const view = new DataView(data.buffer, data.byteOffset + hexPos + 1, 8);
    const value = view.getBigUint64(0, false);
    const valueStr = String(value);
    const endJsonPos = jsonPos + valueStr.length;
    mappings.push({
      jsonStart: jsonPos,
      jsonEnd: endJsonPos,
      hexStart: hexPos,
      hexEnd: hexPos + 9,
      type: 'value',
    });
    return { hexEnd: hexPos + 9, jsonEnd: endJsonPos };
  }

  // int 8
  if (byte === 0xd0) {
    const value = data[hexPos + 1];
    const signedValue = value > 127 ? value - 256 : value;
    const valueStr = String(signedValue);
    const endJsonPos = jsonPos + valueStr.length;
    mappings.push({
      jsonStart: jsonPos,
      jsonEnd: endJsonPos,
      hexStart: hexPos,
      hexEnd: hexPos + 2,
      type: 'value',
    });
    return { hexEnd: hexPos + 2, jsonEnd: endJsonPos };
  }

  // int 16
  if (byte === 0xd1) {
    const value = (data[hexPos + 1] << 8) | data[hexPos + 2];
    const signedValue = value > 32767 ? value - 65536 : value;
    const valueStr = String(signedValue);
    const endJsonPos = jsonPos + valueStr.length;
    mappings.push({
      jsonStart: jsonPos,
      jsonEnd: endJsonPos,
      hexStart: hexPos,
      hexEnd: hexPos + 3,
      type: 'value',
    });
    return { hexEnd: hexPos + 3, jsonEnd: endJsonPos };
  }

  // int 32
  if (byte === 0xd2) {
    const view = new DataView(data.buffer, data.byteOffset + hexPos + 1, 4);
    const value = view.getInt32(0, false);
    const valueStr = String(value);
    const endJsonPos = jsonPos + valueStr.length;
    mappings.push({
      jsonStart: jsonPos,
      jsonEnd: endJsonPos,
      hexStart: hexPos,
      hexEnd: hexPos + 5,
      type: 'value',
    });
    return { hexEnd: hexPos + 5, jsonEnd: endJsonPos };
  }

  // int 64
  if (byte === 0xd3) {
    const view = new DataView(data.buffer, data.byteOffset + hexPos + 1, 8);
    const value = view.getBigInt64(0, false);
    const valueStr = String(value);
    const endJsonPos = jsonPos + valueStr.length;
    mappings.push({
      jsonStart: jsonPos,
      jsonEnd: endJsonPos,
      hexStart: hexPos,
      hexEnd: hexPos + 9,
      type: 'value',
    });
    return { hexEnd: hexPos + 9, jsonEnd: endJsonPos };
  }

  // str 8
  if (byte === 0xd9) {
    const length = data[hexPos + 1];
    const strBytes = data.slice(hexPos + 2, hexPos + 2 + length);
    const str = new TextDecoder().decode(strBytes);
    const jsonStr = JSONBigNative.stringify(str);
    const endJsonPos = jsonPos + jsonStr.length;
    mappings.push({
      jsonStart: jsonPos,
      jsonEnd: endJsonPos,
      hexStart: hexPos,
      hexEnd: hexPos + 2 + length,
      type: 'value',
    });
    return { hexEnd: hexPos + 2 + length, jsonEnd: endJsonPos };
  }

  // str 16
  if (byte === 0xda) {
    const length = (data[hexPos + 1] << 8) | data[hexPos + 2];
    const strBytes = data.slice(hexPos + 3, hexPos + 3 + length);
    const str = new TextDecoder().decode(strBytes);
    const jsonStr = JSONBigNative.stringify(str);
    const endJsonPos = jsonPos + jsonStr.length;
    mappings.push({
      jsonStart: jsonPos,
      jsonEnd: endJsonPos,
      hexStart: hexPos,
      hexEnd: hexPos + 3 + length,
      type: 'value',
    });
    return { hexEnd: hexPos + 3 + length, jsonEnd: endJsonPos };
  }

  // str 32
  if (byte === 0xdb) {
    const length =
      ((data[hexPos + 1] << 24) |
        (data[hexPos + 2] << 16) |
        (data[hexPos + 3] << 8) |
        data[hexPos + 4]) >>>
      0;
    const strBytes = data.slice(hexPos + 5, hexPos + 5 + length);
    const str = new TextDecoder().decode(strBytes);
    const jsonStr = JSONBigNative.stringify(str);
    const endJsonPos = jsonPos + jsonStr.length;
    mappings.push({
      jsonStart: jsonPos,
      jsonEnd: endJsonPos,
      hexStart: hexPos,
      hexEnd: hexPos + 5 + length,
      type: 'value',
    });
    return { hexEnd: hexPos + 5 + length, jsonEnd: endJsonPos };
  }

  // array 16
  if (byte === 0xdc) {
    const count = (data[hexPos + 1] << 8) | data[hexPos + 2];
    // Skip opening bracket
    if (jsonString[jsonPos] === '[') {
      jsonPos++;
    }
    let currentHexPos = hexPos + 3;
    let currentJsonPos = jsonPos;

    for (let i = 0; i < count; i++) {
      // Skip whitespace and comma
      currentJsonPos = skipWhitespaceAndDelimiters(jsonString, currentJsonPos, ',');

      // Parse value recursively
      const valueResult = buildMappings(data, jsonString, mappings, currentHexPos, currentJsonPos);
      currentHexPos = valueResult.hexEnd;
      currentJsonPos = valueResult.jsonEnd;
    }

    // Skip closing bracket
    currentJsonPos = skipWhitespace(jsonString, currentJsonPos);
    if (jsonString[currentJsonPos] === ']') {
      currentJsonPos++;
    }

    return { hexEnd: currentHexPos, jsonEnd: currentJsonPos };
  }

  // array 32
  if (byte === 0xdd) {
    const count =
      ((data[hexPos + 1] << 24) |
        (data[hexPos + 2] << 16) |
        (data[hexPos + 3] << 8) |
        data[hexPos + 4]) >>>
      0;
    // Skip opening bracket
    if (jsonString[jsonPos] === '[') {
      jsonPos++;
    }
    let currentHexPos = hexPos + 5;
    let currentJsonPos = jsonPos;

    for (let i = 0; i < count; i++) {
      // Skip whitespace and comma
      currentJsonPos = skipWhitespaceAndDelimiters(jsonString, currentJsonPos, ',');

      // Parse value recursively
      const valueResult = buildMappings(data, jsonString, mappings, currentHexPos, currentJsonPos);
      currentHexPos = valueResult.hexEnd;
      currentJsonPos = valueResult.jsonEnd;
    }

    // Skip closing bracket
    currentJsonPos = skipWhitespace(jsonString, currentJsonPos);
    if (jsonString[currentJsonPos] === ']') {
      currentJsonPos++;
    }

    return { hexEnd: currentHexPos, jsonEnd: currentJsonPos };
  }

  // map 16
  if (byte === 0xde) {
    const count = (data[hexPos + 1] << 8) | data[hexPos + 2];
    // Skip opening brace
    if (jsonString[jsonPos] === '{') {
      jsonPos++;
    }
    let currentHexPos = hexPos + 3;
    let currentJsonPos = jsonPos;

    for (let i = 0; i < count; i++) {
      // Skip whitespace and comma
      currentJsonPos = skipWhitespaceAndDelimiters(jsonString, currentJsonPos, ',');

      // Parse key
      const keyHexStart = currentHexPos;
      const keyResult = parseMsgpackValue(data, currentHexPos);
      currentHexPos = keyResult.endPos;

      // Find key in JSON (it's a quoted string)
      if (jsonString[currentJsonPos] === '"') {
        const keyStr = JSONBigNative.stringify(keyResult.value);
        const keyEndJsonPos = currentJsonPos + keyStr.length;
        mappings.push({
          jsonStart: currentJsonPos,
          jsonEnd: keyEndJsonPos,
          hexStart: keyHexStart,
          hexEnd: currentHexPos,
          type: 'key',
        });
        currentJsonPos = keyEndJsonPos;
      }

      // Skip colon and whitespace
      currentJsonPos = skipWhitespaceAndDelimiters(jsonString, currentJsonPos, ':');

      // Parse value recursively
      const valueResult = buildMappings(data, jsonString, mappings, currentHexPos, currentJsonPos);
      currentHexPos = valueResult.hexEnd;
      currentJsonPos = valueResult.jsonEnd;
    }

    // Skip closing brace
    currentJsonPos = skipWhitespace(jsonString, currentJsonPos);
    if (jsonString[currentJsonPos] === '}') {
      currentJsonPos++;
    }

    return { hexEnd: currentHexPos, jsonEnd: currentJsonPos };
  }

  // map 32
  if (byte === 0xdf) {
    const count =
      ((data[hexPos + 1] << 24) |
        (data[hexPos + 2] << 16) |
        (data[hexPos + 3] << 8) |
        data[hexPos + 4]) >>>
      0;
    // Skip opening brace
    if (jsonString[jsonPos] === '{') {
      jsonPos++;
    }
    let currentHexPos = hexPos + 5;
    let currentJsonPos = jsonPos;

    for (let i = 0; i < count; i++) {
      // Skip whitespace and comma
      currentJsonPos = skipWhitespaceAndDelimiters(jsonString, currentJsonPos, ',');

      // Parse key
      const keyHexStart = currentHexPos;
      const keyResult = parseMsgpackValue(data, currentHexPos);
      currentHexPos = keyResult.endPos;

      // Find key in JSON (it's a quoted string)
      if (jsonString[currentJsonPos] === '"') {
        const keyStr = JSONBigNative.stringify(keyResult.value);
        const keyEndJsonPos = currentJsonPos + keyStr.length;
        mappings.push({
          jsonStart: currentJsonPos,
          jsonEnd: keyEndJsonPos,
          hexStart: keyHexStart,
          hexEnd: currentHexPos,
          type: 'key',
        });
        currentJsonPos = keyEndJsonPos;
      }

      // Skip colon and whitespace
      currentJsonPos = skipWhitespaceAndDelimiters(jsonString, currentJsonPos, ':');

      // Parse value recursively
      const valueResult = buildMappings(data, jsonString, mappings, currentHexPos, currentJsonPos);
      currentHexPos = valueResult.hexEnd;
      currentJsonPos = valueResult.jsonEnd;
    }

    // Skip closing brace
    currentJsonPos = skipWhitespace(jsonString, currentJsonPos);
    if (jsonString[currentJsonPos] === '}') {
      currentJsonPos++;
    }

    return { hexEnd: currentHexPos, jsonEnd: currentJsonPos };
  }

  // For other types (bin, ext), we create a basic mapping
  const result = parseMsgpackValue(data, hexPos);
  // Skip to end of any remaining structure
  return { hexEnd: result.endPos, jsonEnd: jsonPos };
}

/**
 * Creates position mappings between msgpack bytes and JSON text.
 *
 * @param msgpackData - The raw msgpack bytes
 * @param jsonString - The pretty-printed JSON string
 * @returns An array of position mappings
 */
export function createPositionMappings(
  msgpackData: Uint8Array,
  jsonString: string
): PositionMapping[] {
  const mappings: PositionMapping[] = [];
  try {
    buildMappings(msgpackData, jsonString, mappings, 0, 0);
  } catch {
    // If mapping fails, return empty array
    return [];
  }
  return mappings;
}

/**
 * Finds the hex byte range that corresponds to a given JSON text selection.
 *
 * @param mappings - The position mappings
 * @param jsonSelStart - Start of the JSON selection (character index)
 * @param jsonSelEnd - End of the JSON selection (character index)
 * @returns The hex byte range, or null if no match is found
 */
export function findHexRangeForJsonSelection(
  mappings: PositionMapping[],
  jsonSelStart: number,
  jsonSelEnd: number
): { hexStart: number; hexEnd: number } | null {
  // Find all mappings that overlap with the selection
  const overlapping = mappings.filter((m) => {
    return m.jsonStart < jsonSelEnd && m.jsonEnd > jsonSelStart;
  });

  if (overlapping.length === 0) {
    return null;
  }

  // Return the union of all overlapping hex ranges
  const hexStart = Math.min(...overlapping.map((m) => m.hexStart));
  const hexEnd = Math.max(...overlapping.map((m) => m.hexEnd));

  return { hexStart, hexEnd };
}

/**
 * Converts byte range to character range in the space-separated hex string.
 * Each byte takes 3 characters (2 hex digits + 1 space), except the last byte.
 *
 * @param hexStart - Start byte index
 * @param hexEnd - End byte index (exclusive)
 * @returns Character range in the hex string
 */
export function byteRangeToHexCharRange(
  hexStart: number,
  hexEnd: number
): { charStart: number; charEnd: number } {
  // Each byte is 2 hex chars + 1 space = 3 chars, except the last has no trailing space
  // Byte 0: chars 0-2 (e.g., "81 ")
  // Byte 1: chars 3-5 (e.g., "A5 ")
  // etc.
  const charStart = hexStart * 3;
  const charEnd = hexEnd * 3 - 1; // -1 to not include trailing space of last byte
  return { charStart, charEnd };
}
