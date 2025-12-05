import { describe, it, expect } from 'vitest';
import {
  createPositionMappings,
  findHexRangeForJsonSelection,
  byteRangeToHexCharRange,
} from './position-mapper';

describe('position-mapper', () => {
  describe('createPositionMappings', () => {
    it('should map simple object {"hello": 123}', () => {
      // {"hello": 123} in msgpack: 81 A5 68 65 6C 6C 6F 7B
      // 81 = fixmap with 1 element
      // A5 68 65 6C 6C 6F = fixstr "hello" (A5 = length 5, then "hello")
      // 7B = positive fixint 123
      const msgpack = new Uint8Array([0x81, 0xa5, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x7b]);
      const json = '{\n  "hello": 123\n}';

      const mappings = createPositionMappings(msgpack, json);

      expect(mappings.length).toBe(2);

      // First mapping should be the key "hello"
      const keyMapping = mappings.find((m) => m.type === 'key');
      expect(keyMapping).toBeDefined();
      expect(keyMapping!.hexStart).toBe(1); // starts at byte 1 (A5)
      expect(keyMapping!.hexEnd).toBe(7); // ends at byte 7 (after 6F)
      expect(json.slice(keyMapping!.jsonStart, keyMapping!.jsonEnd)).toBe('"hello"');

      // Second mapping should be the value 123
      const valueMapping = mappings.find((m) => m.type === 'value');
      expect(valueMapping).toBeDefined();
      expect(valueMapping!.hexStart).toBe(7); // starts at byte 7 (7B)
      expect(valueMapping!.hexEnd).toBe(8); // ends at byte 8
      expect(json.slice(valueMapping!.jsonStart, valueMapping!.jsonEnd)).toBe('123');
    });

    it('should map array [1, 2, 3]', () => {
      // [1, 2, 3] in msgpack: 93 01 02 03
      const msgpack = new Uint8Array([0x93, 0x01, 0x02, 0x03]);
      const json = '[\n  1,\n  2,\n  3\n]';

      const mappings = createPositionMappings(msgpack, json);

      expect(mappings.length).toBe(3);
      expect(mappings.every((m) => m.type === 'value')).toBe(true);

      // Each value should map to a single byte
      expect(mappings[0].hexStart).toBe(1);
      expect(mappings[0].hexEnd).toBe(2);
      expect(json.slice(mappings[0].jsonStart, mappings[0].jsonEnd)).toBe('1');

      expect(mappings[1].hexStart).toBe(2);
      expect(mappings[1].hexEnd).toBe(3);
      expect(json.slice(mappings[1].jsonStart, mappings[1].jsonEnd)).toBe('2');

      expect(mappings[2].hexStart).toBe(3);
      expect(mappings[2].hexEnd).toBe(4);
      expect(json.slice(mappings[2].jsonStart, mappings[2].jsonEnd)).toBe('3');
    });

    it('should map string values', () => {
      // {"key": "value"} in msgpack: 81 A3 6B 65 79 A5 76 61 6C 75 65
      const msgpack = new Uint8Array([
        0x81, 0xa3, 0x6b, 0x65, 0x79, 0xa5, 0x76, 0x61, 0x6c, 0x75, 0x65,
      ]);
      const json = '{\n  "key": "value"\n}';

      const mappings = createPositionMappings(msgpack, json);

      const keyMapping = mappings.find((m) => m.type === 'key');
      expect(keyMapping).toBeDefined();
      expect(json.slice(keyMapping!.jsonStart, keyMapping!.jsonEnd)).toBe('"key"');
      expect(keyMapping!.hexStart).toBe(1);
      expect(keyMapping!.hexEnd).toBe(5); // A3 + "key"

      const valueMapping = mappings.find((m) => m.type === 'value');
      expect(valueMapping).toBeDefined();
      expect(json.slice(valueMapping!.jsonStart, valueMapping!.jsonEnd)).toBe('"value"');
      expect(valueMapping!.hexStart).toBe(5);
      expect(valueMapping!.hexEnd).toBe(11); // A5 + "value"
    });

    it('should map null, true, false', () => {
      // [null, true, false] in msgpack: 93 C0 C3 C2
      const msgpack = new Uint8Array([0x93, 0xc0, 0xc3, 0xc2]);
      const json = '[\n  null,\n  true,\n  false\n]';

      const mappings = createPositionMappings(msgpack, json);

      expect(mappings.length).toBe(3);

      const nullMapping = mappings[0];
      expect(json.slice(nullMapping.jsonStart, nullMapping.jsonEnd)).toBe('null');
      expect(nullMapping.hexStart).toBe(1);
      expect(nullMapping.hexEnd).toBe(2);

      const trueMapping = mappings[1];
      expect(json.slice(trueMapping.jsonStart, trueMapping.jsonEnd)).toBe('true');
      expect(trueMapping.hexStart).toBe(2);
      expect(trueMapping.hexEnd).toBe(3);

      const falseMapping = mappings[2];
      expect(json.slice(falseMapping.jsonStart, falseMapping.jsonEnd)).toBe('false');
      expect(falseMapping.hexStart).toBe(3);
      expect(falseMapping.hexEnd).toBe(4);
    });

    it('should map negative integers', () => {
      // [-1] in msgpack: 91 FF
      const msgpack = new Uint8Array([0x91, 0xff]);
      const json = '[\n  -1\n]';

      const mappings = createPositionMappings(msgpack, json);

      expect(mappings.length).toBe(1);
      expect(json.slice(mappings[0].jsonStart, mappings[0].jsonEnd)).toBe('-1');
      expect(mappings[0].hexStart).toBe(1);
      expect(mappings[0].hexEnd).toBe(2);
    });

    it('should map uint8 values', () => {
      // [255] in msgpack: 91 CC FF
      const msgpack = new Uint8Array([0x91, 0xcc, 0xff]);
      const json = '[\n  255\n]';

      const mappings = createPositionMappings(msgpack, json);

      expect(mappings.length).toBe(1);
      expect(json.slice(mappings[0].jsonStart, mappings[0].jsonEnd)).toBe('255');
      expect(mappings[0].hexStart).toBe(1);
      expect(mappings[0].hexEnd).toBe(3);
    });

    it('should map nested objects', () => {
      // {"a": {"b": 1}} in msgpack
      const msgpack = new Uint8Array([0x81, 0xa1, 0x61, 0x81, 0xa1, 0x62, 0x01]);
      const json = '{\n  "a": {\n    "b": 1\n  }\n}';

      const mappings = createPositionMappings(msgpack, json);

      // Should have mappings for "a", "b", and 1
      expect(mappings.length).toBe(3);

      const aMapping = mappings.find((m) => json.slice(m.jsonStart, m.jsonEnd) === '"a"');
      expect(aMapping).toBeDefined();
      expect(aMapping!.type).toBe('key');

      const bMapping = mappings.find((m) => json.slice(m.jsonStart, m.jsonEnd) === '"b"');
      expect(bMapping).toBeDefined();
      expect(bMapping!.type).toBe('key');

      const valueMapping = mappings.find((m) => json.slice(m.jsonStart, m.jsonEnd) === '1');
      expect(valueMapping).toBeDefined();
      expect(valueMapping!.type).toBe('value');
    });
  });

  describe('findHexRangeForJsonSelection', () => {
    it('should find hex range for key selection', () => {
      const msgpack = new Uint8Array([0x81, 0xa5, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x7b]);
      const json = '{\n  "hello": 123\n}';
      const mappings = createPositionMappings(msgpack, json);

      // Select "hello" in JSON (including quotes)
      const helloStart = json.indexOf('"hello"');
      const helloEnd = helloStart + '"hello"'.length;

      const range = findHexRangeForJsonSelection(mappings, helloStart, helloEnd);

      expect(range).not.toBeNull();
      expect(range!.hexStart).toBe(1); // A5
      expect(range!.hexEnd).toBe(7); // After "hello"
    });

    it('should find hex range for value selection', () => {
      const msgpack = new Uint8Array([0x81, 0xa5, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x7b]);
      const json = '{\n  "hello": 123\n}';
      const mappings = createPositionMappings(msgpack, json);

      // Select "123" in JSON
      const valueStart = json.indexOf('123');
      const valueEnd = valueStart + '123'.length;

      const range = findHexRangeForJsonSelection(mappings, valueStart, valueEnd);

      expect(range).not.toBeNull();
      expect(range!.hexStart).toBe(7); // 7B
      expect(range!.hexEnd).toBe(8);
    });

    it('should return null for non-token selection', () => {
      const msgpack = new Uint8Array([0x81, 0xa5, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x7b]);
      const json = '{\n  "hello": 123\n}';
      const mappings = createPositionMappings(msgpack, json);

      // Select just the opening brace
      const range = findHexRangeForJsonSelection(mappings, 0, 1);

      expect(range).toBeNull();
    });

    it('should handle partial selection within a token', () => {
      const msgpack = new Uint8Array([0x81, 0xa5, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x7b]);
      const json = '{\n  "hello": 123\n}';
      const mappings = createPositionMappings(msgpack, json);

      // Select just "hel" within "hello"
      const helloStart = json.indexOf('"hello"');
      const partialStart = helloStart + 1; // Skip the opening quote
      const partialEnd = partialStart + 3; // "hel"

      const range = findHexRangeForJsonSelection(mappings, partialStart, partialEnd);

      // Should still return the full hex range for "hello"
      expect(range).not.toBeNull();
      expect(range!.hexStart).toBe(1);
      expect(range!.hexEnd).toBe(7);
    });
  });

  describe('byteRangeToHexCharRange', () => {
    it('should convert single byte range', () => {
      // Byte 0 in "81 A5 68" is "81" at chars 0-1
      const result = byteRangeToHexCharRange(0, 1);
      expect(result.charStart).toBe(0);
      expect(result.charEnd).toBe(2);
    });

    it('should convert multi-byte range', () => {
      // Bytes 0-2 in "81 A5 68" is "81 A5" at chars 0-4
      const result = byteRangeToHexCharRange(0, 2);
      expect(result.charStart).toBe(0);
      expect(result.charEnd).toBe(5);
    });

    it('should convert range starting from middle', () => {
      // Bytes 1-3 in "81 A5 68 65" is "A5 68" at chars 3-7
      const result = byteRangeToHexCharRange(1, 3);
      expect(result.charStart).toBe(3);
      expect(result.charEnd).toBe(8);
    });
  });
});
