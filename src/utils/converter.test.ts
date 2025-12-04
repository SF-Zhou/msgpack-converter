import { describe, it, expect } from 'vitest';
import { msgpackToJson, jsonToMsgpack, isValidBase64, isValidJson, base64ToHex, hexToBase64, isValidHex } from './converter';

/**
 * Helper function to check if a msgpack marker byte is present in the encoded data
 * @param base64Msgpack - The base64-encoded msgpack data
 * @param marker - The msgpack format marker byte to search for
 * @returns true if the marker is found in the data
 */
function hasMsgpackMarker(base64Msgpack: string, marker: number): boolean {
  const decoded = atob(base64Msgpack);
  for (let i = 0; i < decoded.length; i++) {
    if (decoded.charCodeAt(i) === marker) {
      return true;
    }
  }
  return false;
}

// Msgpack format markers
const MSGPACK_FLOAT64 = 0xcb;
const MSGPACK_UINT64 = 0xcf;

describe('converter utilities', () => {
  describe('msgpackToJson', () => {
    it('should convert simple msgpack to JSON', () => {
      // {"hello": "world"} in msgpack, base64 encoded
      const msgpackBase64 = 'gaVoZWxsb6V3b3JsZA==';
      const json = msgpackToJson(msgpackBase64);
      expect(JSON.parse(json)).toEqual({ hello: 'world' });
    });

    it('should handle arrays', () => {
      // [1, 2, 3] in msgpack, base64 encoded
      const msgpackBase64 = 'kwECAw==';
      const json = msgpackToJson(msgpackBase64);
      expect(JSON.parse(json)).toEqual([1, 2, 3]);
    });

    it('should throw error for invalid base64', () => {
      expect(() => msgpackToJson('invalid!')).toThrow();
    });
  });

  describe('jsonToMsgpack', () => {
    it('should convert simple JSON to msgpack', () => {
      const json = '{"hello": "world"}';
      const msgpack = jsonToMsgpack(json);
      // Verify roundtrip
      const backToJson = msgpackToJson(msgpack);
      expect(JSON.parse(backToJson)).toEqual({ hello: 'world' });
    });

    it('should handle arrays', () => {
      const json = '[1, 2, 3]';
      const msgpack = jsonToMsgpack(json);
      const backToJson = msgpackToJson(msgpack);
      expect(JSON.parse(backToJson)).toEqual([1, 2, 3]);
    });

    it('should throw error for invalid JSON', () => {
      expect(() => jsonToMsgpack('not valid json')).toThrow();
    });
  });

  describe('uint64 support', () => {
    it('should handle uint64 values that exceed JavaScript safe integer limit', () => {
      // Test with a value larger than Number.MAX_SAFE_INTEGER (9007199254740991)
      const largeValue = '18446744073709551615'; // max uint64
      const json = `{"value": ${largeValue}}`;
      
      // Convert to msgpack and back
      const msgpack = jsonToMsgpack(json);
      const backToJson = msgpackToJson(msgpack);
      
      // The value should be preserved exactly
      expect(backToJson).toContain(largeValue);
    });

    it('should correctly roundtrip uint64 values near MAX_SAFE_INTEGER', () => {
      // This value is just above MAX_SAFE_INTEGER
      const largeValue = '9007199254740993';
      const json = `{"bigNum": ${largeValue}}`;
      
      const msgpack = jsonToMsgpack(json);
      const backToJson = msgpackToJson(msgpack);
      
      // Verify the value is preserved (not corrupted by float64)
      expect(backToJson).toContain(largeValue);
    });

    it('should handle multiple uint64 values in an object', () => {
      const json = `{
        "id1": 9007199254740993,
        "id2": 18446744073709551615,
        "id3": 12345678901234567890
      }`;
      
      const msgpack = jsonToMsgpack(json);
      const backToJson = msgpackToJson(msgpack);
      
      expect(backToJson).toContain('9007199254740993');
      expect(backToJson).toContain('18446744073709551615');
      expect(backToJson).toContain('12345678901234567890');
    });

    it('should handle uint64 values in arrays', () => {
      const json = '[9007199254740993, 18446744073709551615]';
      
      const msgpack = jsonToMsgpack(json);
      const backToJson = msgpackToJson(msgpack);
      
      expect(backToJson).toContain('9007199254740993');
      expect(backToJson).toContain('18446744073709551615');
    });

    it('should demonstrate that default JSON would lose precision', () => {
      // This test documents the issue with default JSON and large numbers
      const largeValueString = '9007199254740993';
      
      // Standard JSON.parse loses precision for large integers
      // 9007199254740993 becomes 9007199254740992 after parsing as float64
      const standardParsed = JSON.parse(`{"value": ${largeValueString}}`);
      // Show that the standard parser corrupts the value - it's converted to 9007199254740992
      expect(standardParsed.value.toString()).toBe('9007199254740992'); // Wrong! Lost precision
      expect(standardParsed.value.toString()).not.toBe(largeValueString); // It's not the original
      
      // Our converter preserves the value
      const json = `{"value": ${largeValueString}}`;
      const msgpack = jsonToMsgpack(json);
      const backToJson = msgpackToJson(msgpack);
      expect(backToJson).toContain(largeValueString);
    });

    it('should preserve integer type for values between uint32 max and MAX_SAFE_INTEGER', () => {
      // This is the specific issue from the bug report:
      // Values like 57602261053 (between uint32 max 4294967295 and MAX_SAFE_INTEGER 9007199254740991)
      // should be encoded as uint64, not float64
      const value = '57602261053';
      const json = `{"value": ${value}}`;

      const msgpack = jsonToMsgpack(json);

      // Should NOT have float64 marker
      expect(hasMsgpackMarker(msgpack, MSGPACK_FLOAT64)).toBe(false);

      // Should have uint64 marker
      expect(hasMsgpackMarker(msgpack, MSGPACK_UINT64)).toBe(true);

      // Verify roundtrip preserves the value
      const backToJson = msgpackToJson(msgpack);
      expect(backToJson).toContain(value);
    });

    it('should preserve integer type in msgpack -> JSON -> msgpack roundtrip', () => {
      // Create a msgpack with uint64 value directly, then verify roundtrip preserves it
      // First, create msgpack from JSON with the problematic value
      const originalJson = '{"value": 57602261053}';
      const msgpack1 = jsonToMsgpack(originalJson);

      // Convert to JSON and back to msgpack
      const json = msgpackToJson(msgpack1);
      const msgpack2 = jsonToMsgpack(json);

      // Both msgpack outputs should be identical
      expect(msgpack2).toBe(msgpack1);
    });
  });

  describe('validation functions', () => {
    describe('isValidBase64', () => {
      it('should return true for valid base64', () => {
        expect(isValidBase64('aGVsbG8=')).toBe(true);
        expect(isValidBase64('dGVzdA==')).toBe(true);
      });

      it('should return false for invalid base64', () => {
        expect(isValidBase64('not valid!@#')).toBe(false);
      });
    });

    describe('isValidJson', () => {
      it('should return true for valid JSON', () => {
        expect(isValidJson('{"hello": "world"}')).toBe(true);
        expect(isValidJson('[1, 2, 3]')).toBe(true);
        expect(isValidJson('"string"')).toBe(true);
        expect(isValidJson('123')).toBe(true);
      });

      it('should return false for invalid JSON', () => {
        expect(isValidJson('not valid json')).toBe(false);
        expect(isValidJson('{missing: quotes}')).toBe(false);
      });
    });
  });

  describe('compact integer encoding', () => {
    it('should use compact encoding for small positive integers', () => {
      // Test that small integers produce compact msgpack output
      // In msgpack, positive fixint (0-127) is encoded as a single byte
      const json = '{"value": 1}';
      const msgpack = jsonToMsgpack(json);
      
      // The base64-encoded msgpack for {"value": 1} with fixint should be shorter
      // than with uint64 encoding (which adds 8 bytes)
      // fixint encoding: 81 a5 76 61 6c 75 65 01 (8 bytes)
      // uint64 encoding: 81 a5 76 61 6c 75 65 cf 00 00 00 00 00 00 00 01 (16 bytes)
      const decoded = atob(msgpack);
      
      // The last byte should be 0x01 (fixint for 1), not 0xcf (uint64 marker)
      expect(decoded.charCodeAt(decoded.length - 1)).toBe(1);
      
      // Verify roundtrip
      const backToJson = msgpackToJson(msgpack);
      expect(JSON.parse(backToJson)).toEqual({ value: 1 });
    });

    it('should use compact encoding for array of small integers', () => {
      const json = '[1, 2, 3, 127]';
      const msgpack = jsonToMsgpack(json);
      
      // [1, 2, 3, 127] with fixint: 94 01 02 03 7f (5 bytes)
      const decoded = atob(msgpack);
      
      // Verify compact encoding: array should be 5 bytes
      expect(decoded.length).toBe(5);
      
      // Verify roundtrip
      const backToJson = msgpackToJson(msgpack);
      expect(JSON.parse(backToJson)).toEqual([1, 2, 3, 127]);
    });

    it('should use uint8 encoding for values 128-255', () => {
      const json = '{"value": 255}';
      const msgpack = jsonToMsgpack(json);
      
      // uint8 uses 0xcc marker followed by 1 byte value
      const decoded = atob(msgpack);
      
      // Verify the value byte is 0xff (255)
      expect(decoded.charCodeAt(decoded.length - 1)).toBe(255);
      // And the marker before it should be 0xcc (uint8)
      expect(decoded.charCodeAt(decoded.length - 2)).toBe(0xcc);
      
      const backToJson = msgpackToJson(msgpack);
      expect(JSON.parse(backToJson)).toEqual({ value: 255 });
    });

    it('should still use uint64 for large integers', () => {
      const largeValue = '18446744073709551615';
      const json = `{"value": ${largeValue}}`;
      const msgpack = jsonToMsgpack(json);
      
      // uint64 uses 0xcf marker
      expect(hasMsgpackMarker(msgpack, MSGPACK_UINT64)).toBe(true);
      
      // Verify roundtrip preserves the large value
      const backToJson = msgpackToJson(msgpack);
      expect(backToJson).toContain(largeValue);
    });
  });

  describe('float encoding', () => {
    it('should encode 1.0 as float64, not as integer', () => {
      // When JSON contains "1.0", it should be encoded as float64 (0xcb)
      // not as fixint (0x01)
      const json = '{"A": 1.0, "B": 123}';
      const msgpack = jsonToMsgpack(json);
      
      // Should have float64 marker for 1.0
      expect(hasMsgpackMarker(msgpack, MSGPACK_FLOAT64)).toBe(true);
      
      // Verify roundtrip works
      const backToJson = msgpackToJson(msgpack);
      expect(JSON.parse(backToJson)).toEqual({ A: 1, B: 123 });
    });

    it('should encode 0.0 as float64, not as integer', () => {
      const json = '{"value": 0.0}';
      const msgpack = jsonToMsgpack(json);
      
      // Should have float64 marker for 0.0
      expect(hasMsgpackMarker(msgpack, MSGPACK_FLOAT64)).toBe(true);
    });

    it('should encode numbers with exponents as float64', () => {
      const json = '{"value": 1e5}';
      const msgpack = jsonToMsgpack(json);
      
      // Should have float64 marker for 1e5
      expect(hasMsgpackMarker(msgpack, MSGPACK_FLOAT64)).toBe(true);
      
      // Verify roundtrip
      const backToJson = msgpackToJson(msgpack);
      expect(JSON.parse(backToJson)).toEqual({ value: 100000 });
    });

    it('should preserve integer encoding for regular integers', () => {
      const json = '{"value": 123}';
      const msgpack = jsonToMsgpack(json);
      
      // Should NOT have float64 marker for 123
      expect(hasMsgpackMarker(msgpack, MSGPACK_FLOAT64)).toBe(false);
    });

    it('should handle mixed floats and integers correctly', () => {
      const json = '{"A": 1.0, "B": false, "C": true}';
      const msgpack = jsonToMsgpack(json);
      
      // Should have float64 marker for 1.0
      expect(hasMsgpackMarker(msgpack, MSGPACK_FLOAT64)).toBe(true);
      
      // Verify roundtrip
      const backToJson = msgpackToJson(msgpack);
      const parsed = JSON.parse(backToJson);
      expect(parsed.A).toBe(1);
      expect(parsed.B).toBe(false);
      expect(parsed.C).toBe(true);
    });

    it('should encode actual decimals like 1.5 as float64', () => {
      const json = '{"value": 1.5}';
      const msgpack = jsonToMsgpack(json);
      
      // Should have float64 marker
      expect(hasMsgpackMarker(msgpack, MSGPACK_FLOAT64)).toBe(true);
      
      // Verify roundtrip preserves the decimal
      const backToJson = msgpackToJson(msgpack);
      expect(JSON.parse(backToJson)).toEqual({ value: 1.5 });
    });
  });

  describe('error messages', () => {
    it('should provide descriptive error for invalid JSON syntax', () => {
      // The error message varies based on json-bigint parsing, but should contain something descriptive
      expect(() => jsonToMsgpack('not valid json')).toThrow(
        /Failed to convert JSON to msgpack:/
      );
      
      // Verify it contains a descriptive error, not "Unknown error"
      expect(() => jsonToMsgpack('not valid json')).toThrow(/Expected/);
      expect(() => jsonToMsgpack('not valid json')).not.toThrow(/Unknown error/);
    });

    it('should provide descriptive error for missing quotes', () => {
      expect(() => jsonToMsgpack('{missing: quotes}')).toThrow(
        /Failed to convert JSON to msgpack:/
      );
    });

    it('should provide descriptive error for unclosed brackets', () => {
      expect(() => jsonToMsgpack('{"key": "value"')).toThrow(
        /Failed to convert JSON to msgpack:/
      );
    });

    it('should not show Unknown error for json-bigint parse errors', () => {
      expect(() => jsonToMsgpack('invalid')).toThrow(/Failed to convert JSON to msgpack:/);
      expect(() => jsonToMsgpack('invalid')).not.toThrow(/Unknown error/);
    });
  });

  describe('base64ToHex', () => {
    it('should convert base64 to hex with space-separated bytes', () => {
      // "hello" in base64 is "aGVsbG8="
      const hex = base64ToHex('aGVsbG8=');
      expect(hex).toBe('68 65 6C 6C 6F');
    });

    it('should convert msgpack base64 to hex correctly', () => {
      // {"hello": "world"} in msgpack
      const hex = base64ToHex('gaVoZWxsb6V3b3JsZA==');
      expect(hex).toBe('81 A5 68 65 6C 6C 6F A5 77 6F 72 6C 64');
    });

    it('should handle empty input', () => {
      const hex = base64ToHex('');
      expect(hex).toBe('');
    });

    it('should throw error for invalid base64', () => {
      expect(() => base64ToHex('invalid!')).toThrow('Invalid Base64 string');
    });
  });

  describe('hexToBase64', () => {
    it('should convert space-separated hex to base64', () => {
      const base64 = hexToBase64('68 65 6C 6C 6F');
      expect(base64).toBe('aGVsbG8=');
    });

    it('should convert msgpack hex to base64 correctly', () => {
      const base64 = hexToBase64('81 A5 68 65 6C 6C 6F A5 77 6F 72 6C 64');
      expect(base64).toBe('gaVoZWxsb6V3b3JsZA==');
    });

    it('should handle continuous hex without spaces', () => {
      const base64 = hexToBase64('68656C6C6F');
      expect(base64).toBe('aGVsbG8=');
    });

    it('should handle lowercase hex', () => {
      const base64 = hexToBase64('68 65 6c 6c 6f');
      expect(base64).toBe('aGVsbG8=');
    });

    it('should handle empty input', () => {
      const base64 = hexToBase64('');
      expect(base64).toBe('');
    });

    it('should throw error for odd number of hex characters', () => {
      expect(() => hexToBase64('68 65 6C 6C 6')).toThrow('Hex string must have an even number of characters');
    });

    it('should throw error for invalid hex characters', () => {
      expect(() => hexToBase64('68 GG 6C')).toThrow('Invalid hex characters');
    });
  });

  describe('isValidHex', () => {
    it('should return true for valid hex with spaces', () => {
      expect(isValidHex('68 65 6C 6C 6F')).toBe(true);
    });

    it('should return true for valid hex without spaces', () => {
      expect(isValidHex('68656C6C6F')).toBe(true);
    });

    it('should return true for empty string', () => {
      expect(isValidHex('')).toBe(true);
    });

    it('should return false for odd number of characters', () => {
      expect(isValidHex('68 65 6')).toBe(false);
    });

    it('should return false for invalid hex characters', () => {
      expect(isValidHex('68 GG 6C')).toBe(false);
    });
  });

  describe('base64 and hex roundtrip', () => {
    it('should roundtrip base64 -> hex -> base64', () => {
      const original = 'gaVoZWxsb6V3b3JsZA==';
      const hex = base64ToHex(original);
      const result = hexToBase64(hex);
      expect(result).toBe(original);
    });

    it('should roundtrip hex -> base64 -> hex', () => {
      const original = '81 A5 68 65 6C 6C 6F A5 77 6F 72 6C 64';
      const base64 = hexToBase64(original);
      const result = base64ToHex(base64);
      expect(result).toBe(original);
    });
  });
});
