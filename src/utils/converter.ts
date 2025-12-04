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
 * Parse JSON and wrap float values (numbers with decimal point or exponent) in Float64.
 * This preserves the original representation for msgpack encoding.
 */
function parseJsonWithFloats(jsonString: string): unknown {
  // Pattern for numbers with decimal point or exponent
  // Lookbehind ensures we're after a JSON delimiter (not in a string)
  // Using a character set that includes [ { : , and whitespace
  const floatPattern =
    /(?<=[{[:,\s])(-?(?:0|[1-9]\d*)(?:\.\d+)(?:[eE][+-]?\d+)?|-?(?:0|[1-9]\d*)(?:[eE][+-]?\d+))(?=[}\],\s]|$)/g;

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
 * Convert Base64-encoded msgpack data to pretty JSON string
 * Supports uint64 values by using BigInt and json-bigint
 */
export function msgpackToJson(base64String: string): string {
  try {
    // Decode base64 to binary
    const binaryString = atob(base64String);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Decode msgpack
    const data = decode(bytes, { extensionCodec, useBigInt64: true });

    // Convert to pretty JSON with BigInt support
    return JSONBigNative.stringify(data, null, 2);
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
