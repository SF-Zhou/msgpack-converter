import { encode, decode, ExtensionCodec } from '@msgpack/msgpack';
import JSONBig from 'json-bigint';

// Create a custom JSON parser that uses BigInt for large integers
// alwaysParseAsBig: true ensures all integers are parsed as BigInt to preserve
// uint64 values without precision loss. This is intentional for the converter
// use case where data integrity is more important than performance.
const JSONBigNative = JSONBig({ useNativeBigInt: true, alwaysParseAsBig: true });

// Extension codec to handle BigInt in msgpack
const extensionCodec = new ExtensionCodec();

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
    if (error instanceof Error) {
      throw new Error(`Failed to convert msgpack to JSON: ${error.message}`);
    }
    throw new Error('Failed to convert msgpack to JSON: Unknown error');
  }
}

/**
 * Convert JSON string to Base64-encoded msgpack data
 * Supports uint64 values via json-bigint
 */
export function jsonToMsgpack(jsonString: string): string {
  try {
    // Parse JSON with BigInt support
    const data = JSONBigNative.parse(jsonString);

    // Encode to msgpack
    const encoded = encode(data, { extensionCodec, useBigInt64: true });

    // Convert to base64
    const binaryString = Array.from(encoded)
      .map((byte) => String.fromCharCode(byte))
      .join('');
    return btoa(binaryString);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to convert JSON to msgpack: ${error.message}`);
    }
    throw new Error('Failed to convert JSON to msgpack: Unknown error');
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
