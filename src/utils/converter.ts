import { encode, decode, ExtensionCodec } from '@msgpack/msgpack';
import JSONBig from 'json-bigint';

// Create a custom JSON parser that uses BigInt for large integers
// useNativeBigInt: true uses native BigInt for values exceeding safe integer limits
// Without alwaysParseAsBig, small integers remain as regular numbers, allowing
// msgpack to use compact encodings (fixint, uint8, etc.) instead of uint64
const JSONBigNative = JSONBig({ useNativeBigInt: true });

// Extension codec to handle BigInt in msgpack
const extensionCodec = new ExtensionCodec();

// Maximum value that can be encoded as uint32 in msgpack
const UINT32_MAX = 0xffffffff;
// Minimum value that can be encoded as int32 in msgpack
const INT32_MIN = -2147483648;

/**
 * Wrapper class to force a number to be encoded as float64 in msgpack.
 * This is used when the original JSON explicitly included a decimal point or exponent.
 */
class Float64 {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}

/**
 * Wrapper class to mark a decoded float64 value.
 * This allows us to distinguish float64 values from integers when serializing to JSON.
 */
class DecodedFloat64 {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}

/**
 * Parse JSON and wrap float values (numbers with decimal point or exponent) in Float64.
 * This preserves the original representation for msgpack encoding.
 */
function parseJsonWithFloats(jsonString: string): unknown {
  // Pattern for numbers with decimal point or exponent
  // Lookbehind ensures we're after a JSON delimiter (not in a string) OR at start of string
  // Using a character set that includes [ { : , whitespace, and ^ for start of string
  const floatPattern =
    /(?<=^|[{[:,\s])(-?(?:0|[1-9]\d*)(?:\.\d+)(?:[eE][+-]?\d+)?|-?(?:0|[1-9]\d*)(?:[eE][+-]?\d+))(?=[}\],\s]|$)/g;

  // Check if there are any float patterns
  if (!floatPattern.test(jsonString)) {
    return JSONBigNative.parse(jsonString);
  }

  // Reset regex state
  floatPattern.lastIndex = 0;

  // Build a modified JSON where floats are wrapped in special objects
  const floatMarker = '__MSGPACK_FLOAT64__';
  let modifiedJson = '';
  let lastIndex = 0;

  let matchResult;
  while ((matchResult = floatPattern.exec(jsonString)) !== null) {
    modifiedJson += jsonString.slice(lastIndex, matchResult.index);
    modifiedJson += `{"${floatMarker}":${matchResult[0]}}`;
    lastIndex = matchResult.index + matchResult[0].length;
  }
  modifiedJson += jsonString.slice(lastIndex);

  // Parse the modified JSON
  const parsed = JSONBigNative.parse(modifiedJson);

  // Post-process to unwrap floats
  function unwrapFloats(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map(unwrapFloats);
    }

    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      // Check if this is a float marker object
      if (floatMarker in obj && Object.keys(obj).length === 1) {
        return new Float64(Number(obj[floatMarker]));
      }
      // Recursively process object properties
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(obj)) {
        result[key] = unwrapFloats(val);
      }
      return result;
    }

    return value;
  }

  return unwrapFloats(parsed);
}

/**
 * Custom msgpack encoder that handles Float64 wrapper class.
 * Uses the standard encode function for most types, but encodes Float64 as float64 format.
 */
function encodeValue(value: unknown, output: number[]): void {
  if (value === null) {
    output.push(0xc0);
  } else if (value === true) {
    output.push(0xc3);
  } else if (value === false) {
    output.push(0xc2);
  } else if (value instanceof Float64) {
    // Encode as float64: 0xcb followed by 8 bytes big-endian
    output.push(0xcb);
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setFloat64(0, value.value, false);
    const bytes = new Uint8Array(buffer);
    for (const b of bytes) output.push(b);
  } else if (typeof value === 'number') {
    // Use standard msgpack encoding for numbers
    const encoded = encode(value);
    for (const b of encoded) output.push(b);
  } else if (typeof value === 'bigint') {
    // Use standard msgpack encoding for BigInt
    const encoded = encode(value, { useBigInt64: true });
    for (const b of encoded) output.push(b);
  } else if (typeof value === 'string') {
    // Use standard msgpack encoding for strings
    const encoded = encode(value);
    for (const b of encoded) output.push(b);
  } else if (Array.isArray(value)) {
    // Encode array header
    if (value.length <= 15) {
      output.push(0x90 | value.length);
    } else if (value.length <= 0xffff) {
      output.push(0xdc, (value.length >> 8) & 0xff, value.length & 0xff);
    } else {
      output.push(
        0xdd,
        (value.length >> 24) & 0xff,
        (value.length >> 16) & 0xff,
        (value.length >> 8) & 0xff,
        value.length & 0xff
      );
    }
    // Encode array elements
    for (const item of value) {
      encodeValue(item, output);
    }
  } else if (typeof value === 'object') {
    // Encode object (map)
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length <= 15) {
      output.push(0x80 | entries.length);
    } else if (entries.length <= 0xffff) {
      output.push(0xde, (entries.length >> 8) & 0xff, entries.length & 0xff);
    } else {
      output.push(
        0xdf,
        (entries.length >> 24) & 0xff,
        (entries.length >> 16) & 0xff,
        (entries.length >> 8) & 0xff,
        entries.length & 0xff
      );
    }
    // Encode key-value pairs
    for (const [key, val] of entries) {
      encodeValue(key, output);
      encodeValue(val, output);
    }
  }
}

/**
 * Custom encode function that handles Float64 wrapper class.
 */
function encodeWithFloats(data: unknown): Uint8Array {
  const output: number[] = [];
  encodeValue(data, output);
  return new Uint8Array(output);
}

/**
 * Recursively transform integers that exceed 32-bit range to BigInt.
 * This ensures they are encoded as int64/uint64 in msgpack instead of float64.
 * Small integers remain as Numbers for compact msgpack encoding.
 * Float64 instances are preserved as-is.
 */
function transformLargeIntegers(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  // Preserve Float64 instances
  if (value instanceof Float64) {
    return value;
  }

  // Convert Numbers that exceed 32-bit integer range to BigInt
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value > UINT32_MAX || value < INT32_MIN) {
      return BigInt(value);
    }
    return value;
  }

  // Recursively process arrays
  if (Array.isArray(value)) {
    return value.map(transformLargeIntegers);
  }

  // Recursively process objects
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = transformLargeIntegers(val);
    }
    return result;
  }

  // Return other types as-is (strings, booleans, BigInt, etc.)
  return value;
}

/**
 * Extract error message from various error types
 * Handles Error instances, json-bigint error objects, and unknown types
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  // json-bigint throws objects with name, message, at, and text properties
  if (
    error !== null &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return 'Unknown error';
}

/**
 * Read a string value from msgpack data at the given position.
 * Returns the string value and the end position.
 */
function readMsgpackString(data: Uint8Array, pos: number): { value: string; endPos: number } {
  const byte = data[pos];

  // fixstr (0xa0 - 0xbf)
  if (byte >= 0xa0 && byte <= 0xbf) {
    const length = byte & 0x1f;
    const strBytes = data.slice(pos + 1, pos + 1 + length);
    return { value: new TextDecoder().decode(strBytes), endPos: pos + 1 + length };
  }

  // str 8 (0xd9)
  if (byte === 0xd9) {
    const length = data[pos + 1];
    const strBytes = data.slice(pos + 2, pos + 2 + length);
    return { value: new TextDecoder().decode(strBytes), endPos: pos + 2 + length };
  }

  // str 16 (0xda)
  if (byte === 0xda) {
    const length = (data[pos + 1] << 8) | data[pos + 2];
    const strBytes = data.slice(pos + 3, pos + 3 + length);
    return { value: new TextDecoder().decode(strBytes), endPos: pos + 3 + length };
  }

  // str 32 (0xdb)
  if (byte === 0xdb) {
    const length =
      ((data[pos + 1] << 24) | (data[pos + 2] << 16) | (data[pos + 3] << 8) | data[pos + 4]) >>> 0;
    const strBytes = data.slice(pos + 5, pos + 5 + length);
    return { value: new TextDecoder().decode(strBytes), endPos: pos + 5 + length };
  }

  // Not a string, return empty
  return { value: '', endPos: pos };
}

/**
 * Skip a msgpack value and return the end position.
 */
function skipMsgpackValue(data: Uint8Array, pos: number): number {
  const byte = data[pos];

  // Positive fixint (0x00 - 0x7f)
  if (byte <= 0x7f) return pos + 1;
  // Negative fixint (0xe0 - 0xff)
  if (byte >= 0xe0) return pos + 1;

  // fixmap (0x80 - 0x8f)
  if (byte >= 0x80 && byte <= 0x8f) {
    const count = byte & 0x0f;
    let currentPos = pos + 1;
    for (let i = 0; i < count; i++) {
      currentPos = skipMsgpackValue(data, currentPos); // key
      currentPos = skipMsgpackValue(data, currentPos); // value
    }
    return currentPos;
  }

  // fixarray (0x90 - 0x9f)
  if (byte >= 0x90 && byte <= 0x9f) {
    const count = byte & 0x0f;
    let currentPos = pos + 1;
    for (let i = 0; i < count; i++) {
      currentPos = skipMsgpackValue(data, currentPos);
    }
    return currentPos;
  }

  // fixstr (0xa0 - 0xbf)
  if (byte >= 0xa0 && byte <= 0xbf) {
    const length = byte & 0x1f;
    return pos + 1 + length;
  }

  // nil (0xc0)
  if (byte === 0xc0) return pos + 1;
  // false (0xc2)
  if (byte === 0xc2) return pos + 1;
  // true (0xc3)
  if (byte === 0xc3) return pos + 1;

  // bin 8 (0xc4)
  if (byte === 0xc4) return pos + 2 + data[pos + 1];
  // bin 16 (0xc5)
  if (byte === 0xc5) return pos + 3 + ((data[pos + 1] << 8) | data[pos + 2]);
  // bin 32 (0xc6)
  if (byte === 0xc6) {
    const length =
      ((data[pos + 1] << 24) | (data[pos + 2] << 16) | (data[pos + 3] << 8) | data[pos + 4]) >>> 0;
    return pos + 5 + length;
  }

  // float 32 (0xca)
  if (byte === 0xca) return pos + 5;
  // float 64 (0xcb)
  if (byte === 0xcb) return pos + 9;
  // uint 8 (0xcc)
  if (byte === 0xcc) return pos + 2;
  // uint 16 (0xcd)
  if (byte === 0xcd) return pos + 3;
  // uint 32 (0xce)
  if (byte === 0xce) return pos + 5;
  // uint 64 (0xcf)
  if (byte === 0xcf) return pos + 9;
  // int 8 (0xd0)
  if (byte === 0xd0) return pos + 2;
  // int 16 (0xd1)
  if (byte === 0xd1) return pos + 3;
  // int 32 (0xd2)
  if (byte === 0xd2) return pos + 5;
  // int 64 (0xd3)
  if (byte === 0xd3) return pos + 9;

  // str 8 (0xd9)
  if (byte === 0xd9) return pos + 2 + data[pos + 1];
  // str 16 (0xda)
  if (byte === 0xda) return pos + 3 + ((data[pos + 1] << 8) | data[pos + 2]);
  // str 32 (0xdb)
  if (byte === 0xdb) {
    const length =
      ((data[pos + 1] << 24) | (data[pos + 2] << 16) | (data[pos + 3] << 8) | data[pos + 4]) >>> 0;
    return pos + 5 + length;
  }

  // array 16 (0xdc)
  if (byte === 0xdc) {
    const count = (data[pos + 1] << 8) | data[pos + 2];
    let currentPos = pos + 3;
    for (let i = 0; i < count; i++) {
      currentPos = skipMsgpackValue(data, currentPos);
    }
    return currentPos;
  }

  // array 32 (0xdd)
  if (byte === 0xdd) {
    const count =
      ((data[pos + 1] << 24) | (data[pos + 2] << 16) | (data[pos + 3] << 8) | data[pos + 4]) >>> 0;
    let currentPos = pos + 5;
    for (let i = 0; i < count; i++) {
      currentPos = skipMsgpackValue(data, currentPos);
    }
    return currentPos;
  }

  // map 16 (0xde)
  if (byte === 0xde) {
    const count = (data[pos + 1] << 8) | data[pos + 2];
    let currentPos = pos + 3;
    for (let i = 0; i < count; i++) {
      currentPos = skipMsgpackValue(data, currentPos); // key
      currentPos = skipMsgpackValue(data, currentPos); // value
    }
    return currentPos;
  }

  // map 32 (0xdf)
  if (byte === 0xdf) {
    const count =
      ((data[pos + 1] << 24) | (data[pos + 2] << 16) | (data[pos + 3] << 8) | data[pos + 4]) >>> 0;
    let currentPos = pos + 5;
    for (let i = 0; i < count; i++) {
      currentPos = skipMsgpackValue(data, currentPos); // key
      currentPos = skipMsgpackValue(data, currentPos); // value
    }
    return currentPos;
  }

  // Default - skip 1 byte
  return pos + 1;
}

/**
 * Scan msgpack bytes and collect paths to float64/float32 values.
 * Returns a set of JSON path strings that contain float values.
 */
function scanFloat64Paths(
  data: Uint8Array,
  pos: number = 0,
  path: string = ''
): { paths: Set<string>; endPos: number } {
  const paths = new Set<string>();
  const byte = data[pos];

  // Positive fixint (0x00 - 0x7f)
  if (byte <= 0x7f) {
    return { paths, endPos: pos + 1 };
  }

  // Negative fixint (0xe0 - 0xff)
  if (byte >= 0xe0) {
    return { paths, endPos: pos + 1 };
  }

  // fixmap (0x80 - 0x8f)
  if (byte >= 0x80 && byte <= 0x8f) {
    const count = byte & 0x0f;
    let currentPos = pos + 1;
    for (let i = 0; i < count; i++) {
      // Read key (usually a string)
      const keyStartPos = currentPos;
      const { value: keyStr, endPos: keyEndPos } = readMsgpackString(data, currentPos);
      if (keyEndPos === keyStartPos) {
        // Key is not a string, skip it
        currentPos = skipMsgpackValue(data, currentPos);
      } else {
        currentPos = keyEndPos;
      }
      // Get value
      const valuePath = path ? `${path}.${keyStr || `[${i}]`}` : keyStr || `[${i}]`;
      const valueResult = scanFloat64Paths(data, currentPos, valuePath);
      valueResult.paths.forEach((p) => paths.add(p));
      currentPos = valueResult.endPos;
    }
    return { paths, endPos: currentPos };
  }

  // fixarray (0x90 - 0x9f)
  if (byte >= 0x90 && byte <= 0x9f) {
    const count = byte & 0x0f;
    let currentPos = pos + 1;
    for (let i = 0; i < count; i++) {
      const itemPath = `${path}[${i}]`;
      const result = scanFloat64Paths(data, currentPos, itemPath);
      result.paths.forEach((p) => paths.add(p));
      currentPos = result.endPos;
    }
    return { paths, endPos: currentPos };
  }

  // fixstr (0xa0 - 0xbf)
  if (byte >= 0xa0 && byte <= 0xbf) {
    const length = byte & 0x1f;
    return { paths, endPos: pos + 1 + length };
  }

  // nil (0xc0)
  if (byte === 0xc0) {
    return { paths, endPos: pos + 1 };
  }

  // false (0xc2)
  if (byte === 0xc2) {
    return { paths, endPos: pos + 1 };
  }

  // true (0xc3)
  if (byte === 0xc3) {
    return { paths, endPos: pos + 1 };
  }

  // bin 8 (0xc4)
  if (byte === 0xc4) {
    const length = data[pos + 1];
    return { paths, endPos: pos + 2 + length };
  }

  // bin 16 (0xc5)
  if (byte === 0xc5) {
    const length = (data[pos + 1] << 8) | data[pos + 2];
    return { paths, endPos: pos + 3 + length };
  }

  // bin 32 (0xc6)
  if (byte === 0xc6) {
    const length =
      ((data[pos + 1] << 24) | (data[pos + 2] << 16) | (data[pos + 3] << 8) | data[pos + 4]) >>> 0;
    return { paths, endPos: pos + 5 + length };
  }

  // float 32 (0xca)
  if (byte === 0xca) {
    paths.add(path);
    return { paths, endPos: pos + 5 };
  }

  // float 64 (0xcb)
  if (byte === 0xcb) {
    paths.add(path);
    return { paths, endPos: pos + 9 };
  }

  // uint 8 (0xcc)
  if (byte === 0xcc) {
    return { paths, endPos: pos + 2 };
  }

  // uint 16 (0xcd)
  if (byte === 0xcd) {
    return { paths, endPos: pos + 3 };
  }

  // uint 32 (0xce)
  if (byte === 0xce) {
    return { paths, endPos: pos + 5 };
  }

  // uint 64 (0xcf)
  if (byte === 0xcf) {
    return { paths, endPos: pos + 9 };
  }

  // int 8 (0xd0)
  if (byte === 0xd0) {
    return { paths, endPos: pos + 2 };
  }

  // int 16 (0xd1)
  if (byte === 0xd1) {
    return { paths, endPos: pos + 3 };
  }

  // int 32 (0xd2)
  if (byte === 0xd2) {
    return { paths, endPos: pos + 5 };
  }

  // int 64 (0xd3)
  if (byte === 0xd3) {
    return { paths, endPos: pos + 9 };
  }

  // str 8 (0xd9)
  if (byte === 0xd9) {
    const length = data[pos + 1];
    return { paths, endPos: pos + 2 + length };
  }

  // str 16 (0xda)
  if (byte === 0xda) {
    const length = (data[pos + 1] << 8) | data[pos + 2];
    return { paths, endPos: pos + 3 + length };
  }

  // str 32 (0xdb)
  if (byte === 0xdb) {
    const length =
      ((data[pos + 1] << 24) | (data[pos + 2] << 16) | (data[pos + 3] << 8) | data[pos + 4]) >>> 0;
    return { paths, endPos: pos + 5 + length };
  }

  // array 16 (0xdc)
  if (byte === 0xdc) {
    const count = (data[pos + 1] << 8) | data[pos + 2];
    let currentPos = pos + 3;
    for (let i = 0; i < count; i++) {
      const itemPath = `${path}[${i}]`;
      const result = scanFloat64Paths(data, currentPos, itemPath);
      result.paths.forEach((p) => paths.add(p));
      currentPos = result.endPos;
    }
    return { paths, endPos: currentPos };
  }

  // array 32 (0xdd)
  if (byte === 0xdd) {
    const count =
      ((data[pos + 1] << 24) | (data[pos + 2] << 16) | (data[pos + 3] << 8) | data[pos + 4]) >>> 0;
    let currentPos = pos + 5;
    for (let i = 0; i < count; i++) {
      const itemPath = `${path}[${i}]`;
      const result = scanFloat64Paths(data, currentPos, itemPath);
      result.paths.forEach((p) => paths.add(p));
      currentPos = result.endPos;
    }
    return { paths, endPos: currentPos };
  }

  // map 16 (0xde)
  if (byte === 0xde) {
    const count = (data[pos + 1] << 8) | data[pos + 2];
    let currentPos = pos + 3;
    for (let i = 0; i < count; i++) {
      // Read key
      const { value: keyStr, endPos: keyEndPos } = readMsgpackString(data, currentPos);
      if (keyEndPos === currentPos) {
        currentPos = skipMsgpackValue(data, currentPos);
      } else {
        currentPos = keyEndPos;
      }
      // Get value
      const valuePath = path ? `${path}.${keyStr || `[${i}]`}` : keyStr || `[${i}]`;
      const valueResult = scanFloat64Paths(data, currentPos, valuePath);
      valueResult.paths.forEach((p) => paths.add(p));
      currentPos = valueResult.endPos;
    }
    return { paths, endPos: currentPos };
  }

  // map 32 (0xdf)
  if (byte === 0xdf) {
    const count =
      ((data[pos + 1] << 24) | (data[pos + 2] << 16) | (data[pos + 3] << 8) | data[pos + 4]) >>> 0;
    let currentPos = pos + 5;
    for (let i = 0; i < count; i++) {
      // Read key
      const { value: keyStr, endPos: keyEndPos } = readMsgpackString(data, currentPos);
      if (keyEndPos === currentPos) {
        currentPos = skipMsgpackValue(data, currentPos);
      } else {
        currentPos = keyEndPos;
      }
      // Get value
      const valuePath = path ? `${path}.${keyStr || `[${i}]`}` : keyStr || `[${i}]`;
      const valueResult = scanFloat64Paths(data, currentPos, valuePath);
      valueResult.paths.forEach((p) => paths.add(p));
      currentPos = valueResult.endPos;
    }
    return { paths, endPos: currentPos };
  }

  // Default - skip unknown byte
  return { paths, endPos: pos + 1 };
}

/**
 * Recursively wrap float64 values in DecodedFloat64 based on the paths.
 */
function wrapFloat64Values(
  value: unknown,
  float64Paths: Set<string>,
  currentPath: string = ''
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  // Check if this path is a float64
  if (typeof value === 'number' && float64Paths.has(currentPath)) {
    return new DecodedFloat64(value);
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map((item, index) => wrapFloat64Values(item, float64Paths, `${currentPath}[${index}]`));
  }

  // Handle objects
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const newPath = currentPath ? `${currentPath}.${key}` : key;
      result[key] = wrapFloat64Values(val, float64Paths, newPath);
    }
    return result;
  }

  return value;
}

/**
 * Custom stringify that formats DecodedFloat64 values with .0 suffix for whole numbers.
 */
function stringifyWithFloats(value: unknown, indent: number = 2): string {
  function replacer(_key: string, val: unknown): unknown {
    if (val instanceof DecodedFloat64) {
      // Return a special marker that we'll replace later
      const strVal = Number.isInteger(val.value) ? `${val.value}.0` : String(val.value);
      return `__FLOAT64_MARKER_${strVal}__`;
    }
    return val;
  }

  let json = JSONBigNative.stringify(value, replacer, indent);

  // Replace the quoted markers with unquoted numbers
  json = json.replace(/"__FLOAT64_MARKER_(-?\d+\.?\d*(?:[eE][+-]?\d+)?)__"/g, '$1');

  return json;
}

/**
 * Convert Base64-encoded msgpack data to pretty JSON string
 * Supports uint64 values by using BigInt and json-bigint
 * Preserves float representation by adding .0 suffix to whole number floats
 */
export function msgpackToJson(base64String: string): string {
  try {
    // Decode base64 to binary
    const binaryString = atob(base64String);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Scan for float64 paths before decoding
    const { paths: float64Paths } = scanFloat64Paths(bytes);

    // Decode msgpack
    const data = decode(bytes, { extensionCodec, useBigInt64: true });

    // Wrap float64 values
    const wrappedData = wrapFloat64Values(data, float64Paths);

    // Convert to pretty JSON with float preservation
    return stringifyWithFloats(wrappedData);
  } catch (error) {
    const message = getErrorMessage(error);
    throw new Error(`Failed to convert msgpack to JSON: ${message}`);
  }
}

/**
 * Convert JSON string to Base64-encoded msgpack data
 * Supports uint64 values via json-bigint
 * Preserves float representation for numbers written with decimal points or exponents
 */
export function jsonToMsgpack(jsonString: string): string {
  try {
    // Parse JSON with float detection to preserve float representation
    const parsed = parseJsonWithFloats(jsonString);

    // Transform integers exceeding 32-bit range to BigInt to ensure they are
    // encoded as int64/uint64 in msgpack instead of float64
    const data = transformLargeIntegers(parsed);

    // Encode to msgpack with custom encoder that handles Float64
    const encoded = encodeWithFloats(data);

    // Convert to base64
    const binaryString = Array.from(encoded)
      .map((byte) => String.fromCharCode(byte))
      .join('');
    return btoa(binaryString);
  } catch (error) {
    const message = getErrorMessage(error);
    throw new Error(`Failed to convert JSON to msgpack: ${message}`);
  }
}

/**
 * Validate if a string is valid Base64
 */
export function isValidBase64(str: string): boolean {
  try {
    atob(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate if a string is valid JSON
 */
export function isValidJson(str: string): boolean {
  try {
    JSONBigNative.parse(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert Base64 string to hex string with space-separated bytes
 */
export function base64ToHex(base64String: string): string {
  try {
    const binaryString = atob(base64String);
    const hexBytes: string[] = [];
    for (let i = 0; i < binaryString.length; i++) {
      const byte = binaryString.charCodeAt(i);
      hexBytes.push(byte.toString(16).padStart(2, '0').toUpperCase());
    }
    return hexBytes.join(' ');
  } catch {
    throw new Error('Invalid Base64 string');
  }
}

/**
 * Convert hex string (space-separated or continuous) to Base64 string
 */
export function hexToBase64(hexString: string): string {
  // Remove all whitespace and normalize
  const cleanHex = hexString.replace(/\s+/g, '');

  if (cleanHex.length === 0) {
    return '';
  }

  if (cleanHex.length % 2 !== 0) {
    throw new Error('Hex string must have an even number of characters');
  }

  if (!/^[0-9a-fA-F]*$/.test(cleanHex)) {
    throw new Error('Invalid hex characters');
  }

  let binaryString = '';
  for (let i = 0; i < cleanHex.length; i += 2) {
    const byte = parseInt(cleanHex.substring(i, i + 2), 16);
    binaryString += String.fromCharCode(byte);
  }

  return btoa(binaryString);
}

/**
 * Validate if a string is valid hex format
 */
export function isValidHex(str: string): boolean {
  const cleanHex = str.replace(/\s+/g, '');
  if (cleanHex.length === 0) {
    return true; // Empty is valid
  }
  if (cleanHex.length % 2 !== 0) {
    return false;
  }
  return /^[0-9a-fA-F]*$/.test(cleanHex);
}
