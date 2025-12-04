import { encode, decode, ExtensionCodec } from '@msgpack/msgpack';
import { parse as losslessParse, isLosslessNumber, LosslessNumber } from 'lossless-json';

// Maximum value that can be encoded as uint32 in msgpack
const UINT32_MAX = 0xffffffff;
// Minimum value that can be encoded as int32 in msgpack
const INT32_MIN = -2147483648;

/**
 * Wrapper class to force a number to be encoded as float64 in msgpack.
 * This is used when the original JSON explicitly included a decimal point or exponent.
 */
export class Float64 {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}

/**
 * Wrapper class to mark a decoded float64 value.
 * This allows us to distinguish float64 values from integers when serializing to JSON.
 */
export class DecodedFloat64 {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}

/**
 * MsgPackEncoder provides clean encoding and decoding of MessagePack data
 * with proper handling of float64 values and BigInt.
 */
export class MsgPackEncoder {
  private extensionCodec = new ExtensionCodec();

  /**
   * Check if a LosslessNumber represents a float (has decimal point or exponent).
   */
  private isFloatNumber(losslessNum: LosslessNumber): boolean {
    const value = losslessNum.value;
    return value.includes('.') || value.toLowerCase().includes('e');
  }

  /**
   * Parse JSON and wrap float values (numbers with decimal point or exponent) in Float64.
   * Uses lossless-json to properly parse numbers and preserve their original representation.
   */
  parseJsonWithFloats(jsonString: string): unknown {
    // Use lossless-json to parse, which preserves the original string representation of numbers
    const parsed = losslessParse(jsonString);

    // Post-process to convert LosslessNumbers to appropriate types
    const processValue = (value: unknown): unknown => {
      if (value === null || value === undefined) {
        return value;
      }

      // Check if it's a LosslessNumber
      if (isLosslessNumber(value)) {
        const losslessNum = value as LosslessNumber;
        const numValue = Number(losslessNum.value);

        // If it's a float (has decimal point or exponent), wrap in Float64
        if (this.isFloatNumber(losslessNum)) {
          return new Float64(numValue);
        }

        // For integers, check if they exceed safe integer limits
        // If so, convert to BigInt for proper int64/uint64 encoding
        if (
          !Number.isSafeInteger(numValue) &&
          !losslessNum.value.includes('.') &&
          !losslessNum.value.toLowerCase().includes('e')
        ) {
          try {
            return BigInt(losslessNum.value);
          } catch {
            // If BigInt conversion fails, return as number
            return numValue;
          }
        }

        return numValue;
      }

      if (Array.isArray(value)) {
        return value.map(processValue);
      }

      if (typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
          result[key] = processValue(val);
        }
        return result;
      }

      return value;
    };

    return processValue(parsed);
  }

  /**
   * Recursively transform integers that exceed 32-bit range to BigInt.
   * This ensures they are encoded as int64/uint64 in msgpack instead of float64.
   * Small integers remain as Numbers for compact msgpack encoding.
   * Float64 instances are preserved as-is.
   */
  private transformLargeIntegers(value: unknown): unknown {
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
      return value.map((v) => this.transformLargeIntegers(v));
    }

    // Recursively process objects
    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = this.transformLargeIntegers(val);
      }
      return result;
    }

    // Return other types as-is (strings, booleans, BigInt, etc.)
    return value;
  }

  /**
   * Encode a single value to msgpack bytes.
   * Handles Float64 wrapper class by encoding as float64 format.
   */
  private encodeValue(value: unknown, output: number[]): void {
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
        this.encodeValue(item, output);
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
        this.encodeValue(key, output);
        this.encodeValue(val, output);
      }
    }
  }

  /**
   * Encode data to msgpack bytes.
   * Handles Float64 wrapper class for preserving float representation.
   */
  encode(data: unknown): Uint8Array {
    const transformedData = this.transformLargeIntegers(data);
    const output: number[] = [];
    this.encodeValue(transformedData, output);
    return new Uint8Array(output);
  }

  /**
   * Read a string value from msgpack data at the given position.
   * Returns the string value and the end position.
   */
  private readMsgpackString(data: Uint8Array, pos: number): { value: string; endPos: number } {
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
  private skipMsgpackValue(data: Uint8Array, pos: number): number {
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
        currentPos = this.skipMsgpackValue(data, currentPos); // key
        currentPos = this.skipMsgpackValue(data, currentPos); // value
      }
      return currentPos;
    }

    // fixarray (0x90 - 0x9f)
    if (byte >= 0x90 && byte <= 0x9f) {
      const count = byte & 0x0f;
      let currentPos = pos + 1;
      for (let i = 0; i < count; i++) {
        currentPos = this.skipMsgpackValue(data, currentPos);
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
        currentPos = this.skipMsgpackValue(data, currentPos);
      }
      return currentPos;
    }

    // array 32 (0xdd)
    if (byte === 0xdd) {
      const count =
        ((data[pos + 1] << 24) | (data[pos + 2] << 16) | (data[pos + 3] << 8) | data[pos + 4]) >>> 0;
      let currentPos = pos + 5;
      for (let i = 0; i < count; i++) {
        currentPos = this.skipMsgpackValue(data, currentPos);
      }
      return currentPos;
    }

    // map 16 (0xde)
    if (byte === 0xde) {
      const count = (data[pos + 1] << 8) | data[pos + 2];
      let currentPos = pos + 3;
      for (let i = 0; i < count; i++) {
        currentPos = this.skipMsgpackValue(data, currentPos); // key
        currentPos = this.skipMsgpackValue(data, currentPos); // value
      }
      return currentPos;
    }

    // map 32 (0xdf)
    if (byte === 0xdf) {
      const count =
        ((data[pos + 1] << 24) | (data[pos + 2] << 16) | (data[pos + 3] << 8) | data[pos + 4]) >>> 0;
      let currentPos = pos + 5;
      for (let i = 0; i < count; i++) {
        currentPos = this.skipMsgpackValue(data, currentPos); // key
        currentPos = this.skipMsgpackValue(data, currentPos); // value
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
  scanFloat64Paths(
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
        const { value: keyStr, endPos: keyEndPos } = this.readMsgpackString(data, currentPos);
        if (keyEndPos === keyStartPos) {
          // Key is not a string, skip it
          currentPos = this.skipMsgpackValue(data, currentPos);
        } else {
          currentPos = keyEndPos;
        }
        // Get value
        const valuePath = path ? `${path}.${keyStr || `[${i}]`}` : keyStr || `[${i}]`;
        const valueResult = this.scanFloat64Paths(data, currentPos, valuePath);
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
        const result = this.scanFloat64Paths(data, currentPos, itemPath);
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
        const result = this.scanFloat64Paths(data, currentPos, itemPath);
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
        const result = this.scanFloat64Paths(data, currentPos, itemPath);
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
        const { value: keyStr, endPos: keyEndPos } = this.readMsgpackString(data, currentPos);
        if (keyEndPos === currentPos) {
          currentPos = this.skipMsgpackValue(data, currentPos);
        } else {
          currentPos = keyEndPos;
        }
        // Get value
        const valuePath = path ? `${path}.${keyStr || `[${i}]`}` : keyStr || `[${i}]`;
        const valueResult = this.scanFloat64Paths(data, currentPos, valuePath);
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
        const { value: keyStr, endPos: keyEndPos } = this.readMsgpackString(data, currentPos);
        if (keyEndPos === currentPos) {
          currentPos = this.skipMsgpackValue(data, currentPos);
        } else {
          currentPos = keyEndPos;
        }
        // Get value
        const valuePath = path ? `${path}.${keyStr || `[${i}]`}` : keyStr || `[${i}]`;
        const valueResult = this.scanFloat64Paths(data, currentPos, valuePath);
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
  wrapFloat64Values(
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
      return value.map((item, index) => this.wrapFloat64Values(item, float64Paths, `${currentPath}[${index}]`));
    }

    // Handle objects
    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        const newPath = currentPath ? `${currentPath}.${key}` : key;
        result[key] = this.wrapFloat64Values(val, float64Paths, newPath);
      }
      return result;
    }

    return value;
  }

  /**
   * Decode msgpack bytes to a value with float64 values wrapped.
   */
  decode(bytes: Uint8Array): unknown {
    // Scan for float64 paths before decoding
    const { paths: float64Paths } = this.scanFloat64Paths(bytes);

    // Decode msgpack
    const data = decode(bytes, { extensionCodec: this.extensionCodec, useBigInt64: true });

    // Wrap float64 values
    return this.wrapFloat64Values(data, float64Paths);
  }
}

// Export a singleton instance for convenience
export const msgPackEncoder = new MsgPackEncoder();
