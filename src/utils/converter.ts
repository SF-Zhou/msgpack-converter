import JSONBig from 'json-bigint';
import { msgPackEncoder } from './msgpack-encoder';

// Create a custom JSON parser that uses BigInt for large integers
// useNativeBigInt: true uses native BigInt for values exceeding safe integer limits
// Without alwaysParseAsBig, small integers remain as regular numbers, allowing
// msgpack to use compact encodings (fixint, uint8, etc.) instead of uint64
const JSONBigNative = JSONBig({ useNativeBigInt: true });

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
 * Preserves float representation by adding .0 suffix to whole number floats
 * 
 * DecodedFloat64 objects have _isBigNumber = true which makes json-bigint
 * output their toJSON() result unquoted, avoiding the need for string markers.
 */
export function msgpackToJson(base64String: string): string {
  try {
    // Decode base64 to binary
    const binaryString = atob(base64String);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Decode msgpack with float detection
    const wrappedData = msgPackEncoder.decode(bytes);

    // Convert to pretty JSON - DecodedFloat64's toJSON() handles float formatting
    return JSONBigNative.stringify(wrappedData, null, 2);
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
    const data = msgPackEncoder.parseJsonWithFloats(jsonString);

    // Encode to msgpack with custom encoder that handles Float64
    const encoded = msgPackEncoder.encode(data);

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
