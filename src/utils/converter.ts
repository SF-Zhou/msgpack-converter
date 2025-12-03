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
 * Recursively transform integers that exceed 32-bit range to BigInt.
 * This ensures they are encoded as int64/uint64 in msgpack instead of float64.
 * Small integers remain as Numbers for compact msgpack encoding.
 */
function transformLargeIntegers(value: unknown): unknown {
  if (value === null || value === undefined) {
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
 */
export function jsonToMsgpack(jsonString: string): string {
  try {
    // Parse JSON with BigInt support
    const parsed = JSONBigNative.parse(jsonString);

    // Transform integers exceeding 32-bit range to BigInt to ensure they are
    // encoded as int64/uint64 in msgpack instead of float64
    const data = transformLargeIntegers(parsed);

    // Encode to msgpack
    const encoded = encode(data, { extensionCodec, useBigInt64: true });

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
