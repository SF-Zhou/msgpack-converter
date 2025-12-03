import { describe, it, expect } from 'vitest';
import { msgpackToJson, jsonToMsgpack, isValidBase64, isValidJson } from './converter';

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
});
