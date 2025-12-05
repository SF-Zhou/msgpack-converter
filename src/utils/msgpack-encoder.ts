import { Encoder, Decoder } from '@msgpack/msgpack';
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
 * 
 * The class mimics BigNumber by setting _isBigNumber = true, which allows json-bigint
 * to output the toJSON() result without quotes. This avoids using string markers
 * that could conflict with user data.
 */
export class DecodedFloat64 {
  value: number;
  // This property makes json-bigint recognize this as a BigNumber-like object
  // and output the toJSON() result unquoted
  _isBigNumber: boolean = true;

  constructor(value: number) {
    this.value = value;
  }

  /**
   * Returns the string representation for JSON serialization.
   * Adds .0 suffix to whole numbers to preserve float type information.
   */
  toJSON(): string {
    return Number.isInteger(this.value) ? `${this.value}.0` : String(this.value);
  }
}

/**
 * Create a custom encoder that handles Float64 values natively.
 * We monkey-patch the doEncode method to intercept Float64 objects before
 * they're processed as regular objects, and encode them directly as float64.
 */
function createFloat64Encoder(): Encoder {
  const encoder = new Encoder({ useBigInt64: true });

  // Store reference to original doEncode
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalDoEncode = (encoder as any).doEncode.bind(encoder);

  // Override doEncode to handle Float64 before other types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (encoder as any).doEncode = function (object: unknown, depth: number): void {
    if (object instanceof Float64) {
      // Write native float64 format: 0xcb + 8 bytes big-endian
      this.ensureBufferSizeToWrite(9);
      this.writeU8(0xcb); // float64 marker
      this.writeF64(object.value);
      return;
    }

    // For all other types, use original doEncode
    originalDoEncode(object, depth);
  };

  return encoder;
}

/**
 * Create a custom decoder that wraps float32/float64 values in DecodedFloat64.
 * We monkey-patch the readF32 and readF64 methods to intercept float values
 * and wrap them in DecodedFloat64 for later identification during JSON serialization.
 */
function createFloat64Decoder(): Decoder {
  const decoder = new Decoder({ useBigInt64: true });

  // Store reference to original readF32 and readF64
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalReadF32 = (decoder as any).readF32.bind(decoder);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalReadF64 = (decoder as any).readF64.bind(decoder);

  // Override readF32 to wrap result in DecodedFloat64
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (decoder as any).readF32 = function (): DecodedFloat64 {
    const value = originalReadF32();
    return new DecodedFloat64(value);
  };

  // Override readF64 to wrap result in DecodedFloat64
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (decoder as any).readF64 = function (): DecodedFloat64 {
    const value = originalReadF64();
    return new DecodedFloat64(value);
  };

  return decoder;
}

/**
 * MsgPackEncoder provides clean encoding and decoding of MessagePack data
 * with proper handling of float64 values and BigInt.
 */
export class MsgPackEncoder {
  private encoder = createFloat64Encoder();
  private decoder = createFloat64Decoder();

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
   * Encode data to msgpack bytes.
   * Uses a custom encoder that handles Float64 wrapper class natively.
   */
  encode(data: unknown): Uint8Array {
    const transformedData = this.transformLargeIntegers(data);

    // Encode using our custom encoder that handles Float64 natively
    return this.encoder.encode(transformedData);
  }

  /**
   * Decode msgpack bytes to a value with float64 values wrapped in DecodedFloat64.
   * Uses a custom decoder that intercepts readF32/readF64 to wrap float values.
   */
  decode(bytes: Uint8Array): unknown {
    // Decode using our custom decoder that wraps float values in DecodedFloat64
    return this.decoder.decode(bytes);
  }
}

// Export a singleton instance for convenience
export const msgPackEncoder = new MsgPackEncoder();
