/// Represents a mapping between a JSON text range and its corresponding HEX byte range.
#[derive(Debug, Clone)]
pub struct PositionMapping {
    /// JSON text position (character indices in the JSON string)
    pub json_start: usize,
    pub json_end: usize,
    /// HEX byte position (byte indices in the msgpack data)
    pub hex_start: usize,
    pub hex_end: usize,
    /// Type of the mapped element (used for debugging and potential future features)
    #[allow(dead_code)]
    pub mapping_type: MappingType,
}

/// Type of element in the position mapping.
/// Used for debugging and potential future features like different highlighting styles.
#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)]
pub enum MappingType {
    /// A key in a JSON object
    Key,
    /// A value (string, number, boolean, null, array, or object)
    Value,
    /// A container element (array or object brackets)
    Container,
}

/// Skip whitespace characters in a JSON string starting from a given position.
fn skip_whitespace(json_string: &str, pos: usize) -> usize {
    let chars: Vec<char> = json_string.chars().collect();
    let mut p = pos;
    while p < chars.len() && chars[p].is_whitespace() {
        p += 1;
    }
    p
}

/// Skip whitespace and specified delimiter characters in a JSON string.
fn skip_whitespace_and_delimiters(json_string: &str, pos: usize, delimiters: &str) -> usize {
    let chars: Vec<char> = json_string.chars().collect();
    let mut p = pos;
    while p < chars.len() && (chars[p].is_whitespace() || delimiters.contains(chars[p])) {
        p += 1;
    }
    p
}

/// Parse a msgpack value and track the byte range it occupies.
/// Returns the decoded value and the end position.
fn parse_msgpack_value(data: &[u8], pos: usize) -> Result<(serde_json::Value, usize), String> {
    if pos >= data.len() {
        return Err("Unexpected end of data".to_string());
    }

    let byte = data[pos];

    // Positive fixint (0x00 - 0x7f)
    if byte <= 0x7f {
        return Ok((serde_json::Value::Number(byte.into()), pos + 1));
    }

    // Negative fixint (0xe0 - 0xff)
    if byte >= 0xe0 {
        let value = (byte as i8) as i64;
        return Ok((serde_json::Value::Number(value.into()), pos + 1));
    }

    // fixmap (0x80 - 0x8f)
    if (0x80..=0x8f).contains(&byte) {
        let count = (byte & 0x0f) as usize;
        let mut current_pos = pos + 1;
        let mut obj = serde_json::Map::new();
        for _ in 0..count {
            let (key, key_end) = parse_msgpack_value(data, current_pos)?;
            current_pos = key_end;
            let (value, value_end) = parse_msgpack_value(data, current_pos)?;
            current_pos = value_end;
            let key_str = match key {
                serde_json::Value::String(s) => s,
                _ => key.to_string(),
            };
            obj.insert(key_str, value);
        }
        return Ok((serde_json::Value::Object(obj), current_pos));
    }

    // fixarray (0x90 - 0x9f)
    if (0x90..=0x9f).contains(&byte) {
        let count = (byte & 0x0f) as usize;
        let mut current_pos = pos + 1;
        let mut arr = Vec::new();
        for _ in 0..count {
            let (value, end) = parse_msgpack_value(data, current_pos)?;
            arr.push(value);
            current_pos = end;
        }
        return Ok((serde_json::Value::Array(arr), current_pos));
    }

    // fixstr (0xa0 - 0xbf)
    if (0xa0..=0xbf).contains(&byte) {
        let length = (byte & 0x1f) as usize;
        let str_bytes = &data[pos + 1..pos + 1 + length];
        let s = String::from_utf8_lossy(str_bytes).to_string();
        return Ok((serde_json::Value::String(s), pos + 1 + length));
    }

    // nil
    if byte == 0xc0 {
        return Ok((serde_json::Value::Null, pos + 1));
    }

    // false
    if byte == 0xc2 {
        return Ok((serde_json::Value::Bool(false), pos + 1));
    }

    // true
    if byte == 0xc3 {
        return Ok((serde_json::Value::Bool(true), pos + 1));
    }

    // float 32
    if byte == 0xca {
        let bytes: [u8; 4] = data[pos + 1..pos + 5].try_into().unwrap();
        let value = f32::from_be_bytes(bytes) as f64;
        return Ok((
            serde_json::Value::Number(serde_json::Number::from_f64(value).unwrap_or(0.into())),
            pos + 5,
        ));
    }

    // float 64
    if byte == 0xcb {
        let bytes: [u8; 8] = data[pos + 1..pos + 9].try_into().unwrap();
        let value = f64::from_be_bytes(bytes);
        return Ok((
            serde_json::Value::Number(serde_json::Number::from_f64(value).unwrap_or(0.into())),
            pos + 9,
        ));
    }

    // uint 8
    if byte == 0xcc {
        return Ok((serde_json::Value::Number(data[pos + 1].into()), pos + 2));
    }

    // uint 16
    if byte == 0xcd {
        let value = u16::from_be_bytes([data[pos + 1], data[pos + 2]]);
        return Ok((serde_json::Value::Number(value.into()), pos + 3));
    }

    // uint 32
    if byte == 0xce {
        let value = u32::from_be_bytes([data[pos + 1], data[pos + 2], data[pos + 3], data[pos + 4]]);
        return Ok((serde_json::Value::Number(value.into()), pos + 5));
    }

    // uint 64
    if byte == 0xcf {
        let value = u64::from_be_bytes([
            data[pos + 1],
            data[pos + 2],
            data[pos + 3],
            data[pos + 4],
            data[pos + 5],
            data[pos + 6],
            data[pos + 7],
            data[pos + 8],
        ]);
        return Ok((serde_json::Value::Number(value.into()), pos + 9));
    }

    // int 8
    if byte == 0xd0 {
        let value = data[pos + 1] as i8;
        return Ok((serde_json::Value::Number((value as i64).into()), pos + 2));
    }

    // int 16
    if byte == 0xd1 {
        let value = i16::from_be_bytes([data[pos + 1], data[pos + 2]]);
        return Ok((serde_json::Value::Number((value as i64).into()), pos + 3));
    }

    // int 32
    if byte == 0xd2 {
        let value = i32::from_be_bytes([data[pos + 1], data[pos + 2], data[pos + 3], data[pos + 4]]);
        return Ok((serde_json::Value::Number((value as i64).into()), pos + 5));
    }

    // int 64
    if byte == 0xd3 {
        let value = i64::from_be_bytes([
            data[pos + 1],
            data[pos + 2],
            data[pos + 3],
            data[pos + 4],
            data[pos + 5],
            data[pos + 6],
            data[pos + 7],
            data[pos + 8],
        ]);
        return Ok((serde_json::Value::Number(value.into()), pos + 9));
    }

    // str 8
    if byte == 0xd9 {
        let length = data[pos + 1] as usize;
        let str_bytes = &data[pos + 2..pos + 2 + length];
        let s = String::from_utf8_lossy(str_bytes).to_string();
        return Ok((serde_json::Value::String(s), pos + 2 + length));
    }

    // str 16
    if byte == 0xda {
        let length = u16::from_be_bytes([data[pos + 1], data[pos + 2]]) as usize;
        let str_bytes = &data[pos + 3..pos + 3 + length];
        let s = String::from_utf8_lossy(str_bytes).to_string();
        return Ok((serde_json::Value::String(s), pos + 3 + length));
    }

    // str 32
    if byte == 0xdb {
        let length = u32::from_be_bytes([data[pos + 1], data[pos + 2], data[pos + 3], data[pos + 4]]) as usize;
        let str_bytes = &data[pos + 5..pos + 5 + length];
        let s = String::from_utf8_lossy(str_bytes).to_string();
        return Ok((serde_json::Value::String(s), pos + 5 + length));
    }

    // array 16
    if byte == 0xdc {
        let count = u16::from_be_bytes([data[pos + 1], data[pos + 2]]) as usize;
        let mut current_pos = pos + 3;
        let mut arr = Vec::new();
        for _ in 0..count {
            let (value, end) = parse_msgpack_value(data, current_pos)?;
            arr.push(value);
            current_pos = end;
        }
        return Ok((serde_json::Value::Array(arr), current_pos));
    }

    // array 32
    if byte == 0xdd {
        let count = u32::from_be_bytes([data[pos + 1], data[pos + 2], data[pos + 3], data[pos + 4]]) as usize;
        let mut current_pos = pos + 5;
        let mut arr = Vec::new();
        for _ in 0..count {
            let (value, end) = parse_msgpack_value(data, current_pos)?;
            arr.push(value);
            current_pos = end;
        }
        return Ok((serde_json::Value::Array(arr), current_pos));
    }

    // map 16
    if byte == 0xde {
        let count = u16::from_be_bytes([data[pos + 1], data[pos + 2]]) as usize;
        let mut current_pos = pos + 3;
        let mut obj = serde_json::Map::new();
        for _ in 0..count {
            let (key, key_end) = parse_msgpack_value(data, current_pos)?;
            current_pos = key_end;
            let (value, value_end) = parse_msgpack_value(data, current_pos)?;
            current_pos = value_end;
            let key_str = match key {
                serde_json::Value::String(s) => s,
                _ => key.to_string(),
            };
            obj.insert(key_str, value);
        }
        return Ok((serde_json::Value::Object(obj), current_pos));
    }

    // map 32
    if byte == 0xdf {
        let count = u32::from_be_bytes([data[pos + 1], data[pos + 2], data[pos + 3], data[pos + 4]]) as usize;
        let mut current_pos = pos + 5;
        let mut obj = serde_json::Map::new();
        for _ in 0..count {
            let (key, key_end) = parse_msgpack_value(data, current_pos)?;
            current_pos = key_end;
            let (value, value_end) = parse_msgpack_value(data, current_pos)?;
            current_pos = value_end;
            let key_str = match key {
                serde_json::Value::String(s) => s,
                _ => key.to_string(),
            };
            obj.insert(key_str, value);
        }
        return Ok((serde_json::Value::Object(obj), current_pos));
    }

    // bin 8
    if byte == 0xc4 {
        let length = data[pos + 1] as usize;
        return Ok((serde_json::Value::Null, pos + 2 + length));
    }

    // bin 16
    if byte == 0xc5 {
        let length = u16::from_be_bytes([data[pos + 1], data[pos + 2]]) as usize;
        return Ok((serde_json::Value::Null, pos + 3 + length));
    }

    // bin 32
    if byte == 0xc6 {
        let length = u32::from_be_bytes([data[pos + 1], data[pos + 2], data[pos + 3], data[pos + 4]]) as usize;
        return Ok((serde_json::Value::Null, pos + 5 + length));
    }

    Err(format!("Unknown msgpack format byte: 0x{:02x} at position {}", byte, pos))
}

/// Build position mappings between msgpack bytes and JSON text positions.
fn build_mappings(
    data: &[u8],
    json_string: &str,
    mappings: &mut Vec<PositionMapping>,
    hex_pos: usize,
    json_pos: usize,
) -> Result<(usize, usize), String> {
    if hex_pos >= data.len() {
        return Err("Unexpected end of data".to_string());
    }

    let byte = data[hex_pos];
    let json_chars: Vec<char> = json_string.chars().collect();
    let json_pos = skip_whitespace(json_string, json_pos);

    // Positive fixint (0x00 - 0x7f)
    if byte <= 0x7f {
        let value_str = byte.to_string();
        let end_json_pos = json_pos + value_str.len();
        mappings.push(PositionMapping {
            json_start: json_pos,
            json_end: end_json_pos,
            hex_start: hex_pos,
            hex_end: hex_pos + 1,
            mapping_type: MappingType::Value,
        });
        return Ok((hex_pos + 1, end_json_pos));
    }

    // Negative fixint (0xe0 - 0xff)
    if byte >= 0xe0 {
        let value = (byte as i8) as i32;
        let value_str = value.to_string();
        let end_json_pos = json_pos + value_str.len();
        mappings.push(PositionMapping {
            json_start: json_pos,
            json_end: end_json_pos,
            hex_start: hex_pos,
            hex_end: hex_pos + 1,
            mapping_type: MappingType::Value,
        });
        return Ok((hex_pos + 1, end_json_pos));
    }

    // fixmap (0x80 - 0x8f)
    if (0x80..=0x8f).contains(&byte) {
        let count = (byte & 0x0f) as usize;
        let mut current_json_pos = json_pos;
        if json_pos < json_chars.len() && json_chars[current_json_pos] == '{' {
            current_json_pos += 1;
        }
        let mut current_hex_pos = hex_pos + 1;

        for _ in 0..count {
            current_json_pos = skip_whitespace_and_delimiters(json_string, current_json_pos, ",");

            // Parse key
            let key_hex_start = current_hex_pos;
            let (key_value, key_end) = parse_msgpack_value(data, current_hex_pos)?;
            current_hex_pos = key_end;

            // Find key in JSON
            if current_json_pos < json_chars.len() && json_chars[current_json_pos] == '"' {
                let key_str = serde_json::to_string(&key_value).unwrap_or_default();
                let key_end_json_pos = current_json_pos + key_str.len();
                mappings.push(PositionMapping {
                    json_start: current_json_pos,
                    json_end: key_end_json_pos,
                    hex_start: key_hex_start,
                    hex_end: current_hex_pos,
                    mapping_type: MappingType::Key,
                });
                current_json_pos = key_end_json_pos;
            }

            current_json_pos = skip_whitespace_and_delimiters(json_string, current_json_pos, ":");

            // Parse value recursively
            let (value_hex_end, value_json_end) =
                build_mappings(data, json_string, mappings, current_hex_pos, current_json_pos)?;
            current_hex_pos = value_hex_end;
            current_json_pos = value_json_end;
        }

        current_json_pos = skip_whitespace(json_string, current_json_pos);
        if current_json_pos < json_chars.len() && json_chars[current_json_pos] == '}' {
            current_json_pos += 1;
        }

        return Ok((current_hex_pos, current_json_pos));
    }

    // fixarray (0x90 - 0x9f)
    if (0x90..=0x9f).contains(&byte) {
        let count = (byte & 0x0f) as usize;
        let mut current_json_pos = json_pos;
        if json_pos < json_chars.len() && json_chars[current_json_pos] == '[' {
            current_json_pos += 1;
        }
        let mut current_hex_pos = hex_pos + 1;

        for _ in 0..count {
            current_json_pos = skip_whitespace_and_delimiters(json_string, current_json_pos, ",");
            let (value_hex_end, value_json_end) =
                build_mappings(data, json_string, mappings, current_hex_pos, current_json_pos)?;
            current_hex_pos = value_hex_end;
            current_json_pos = value_json_end;
        }

        current_json_pos = skip_whitespace(json_string, current_json_pos);
        if current_json_pos < json_chars.len() && json_chars[current_json_pos] == ']' {
            current_json_pos += 1;
        }

        return Ok((current_hex_pos, current_json_pos));
    }

    // fixstr (0xa0 - 0xbf)
    if (0xa0..=0xbf).contains(&byte) {
        let length = (byte & 0x1f) as usize;
        let str_bytes = &data[hex_pos + 1..hex_pos + 1 + length];
        let s = String::from_utf8_lossy(str_bytes).to_string();
        let json_str = serde_json::to_string(&s).unwrap_or_default();
        let end_json_pos = json_pos + json_str.len();
        mappings.push(PositionMapping {
            json_start: json_pos,
            json_end: end_json_pos,
            hex_start: hex_pos,
            hex_end: hex_pos + 1 + length,
            mapping_type: MappingType::Value,
        });
        return Ok((hex_pos + 1 + length, end_json_pos));
    }

    // nil
    if byte == 0xc0 {
        let end_json_pos = json_pos + 4; // "null"
        mappings.push(PositionMapping {
            json_start: json_pos,
            json_end: end_json_pos,
            hex_start: hex_pos,
            hex_end: hex_pos + 1,
            mapping_type: MappingType::Value,
        });
        return Ok((hex_pos + 1, end_json_pos));
    }

    // false
    if byte == 0xc2 {
        let end_json_pos = json_pos + 5; // "false"
        mappings.push(PositionMapping {
            json_start: json_pos,
            json_end: end_json_pos,
            hex_start: hex_pos,
            hex_end: hex_pos + 1,
            mapping_type: MappingType::Value,
        });
        return Ok((hex_pos + 1, end_json_pos));
    }

    // true
    if byte == 0xc3 {
        let end_json_pos = json_pos + 4; // "true"
        mappings.push(PositionMapping {
            json_start: json_pos,
            json_end: end_json_pos,
            hex_start: hex_pos,
            hex_end: hex_pos + 1,
            mapping_type: MappingType::Value,
        });
        return Ok((hex_pos + 1, end_json_pos));
    }

    // float 32
    if byte == 0xca {
        let bytes: [u8; 4] = data[hex_pos + 1..hex_pos + 5].try_into().unwrap();
        let value = f32::from_be_bytes(bytes) as f64;
        let value_str = if value.fract() == 0.0 {
            format!("{}.0", value as i64)
        } else {
            value.to_string()
        };
        let end_json_pos = json_pos + value_str.len();
        mappings.push(PositionMapping {
            json_start: json_pos,
            json_end: end_json_pos,
            hex_start: hex_pos,
            hex_end: hex_pos + 5,
            mapping_type: MappingType::Value,
        });
        return Ok((hex_pos + 5, end_json_pos));
    }

    // float 64
    if byte == 0xcb {
        let bytes: [u8; 8] = data[hex_pos + 1..hex_pos + 9].try_into().unwrap();
        let value = f64::from_be_bytes(bytes);
        let value_str = if value.fract() == 0.0 && value.abs() < i64::MAX as f64 {
            format!("{}.0", value as i64)
        } else {
            value.to_string()
        };
        let end_json_pos = json_pos + value_str.len();
        mappings.push(PositionMapping {
            json_start: json_pos,
            json_end: end_json_pos,
            hex_start: hex_pos,
            hex_end: hex_pos + 9,
            mapping_type: MappingType::Value,
        });
        return Ok((hex_pos + 9, end_json_pos));
    }

    // uint 8
    if byte == 0xcc {
        let value = data[hex_pos + 1];
        let value_str = value.to_string();
        let end_json_pos = json_pos + value_str.len();
        mappings.push(PositionMapping {
            json_start: json_pos,
            json_end: end_json_pos,
            hex_start: hex_pos,
            hex_end: hex_pos + 2,
            mapping_type: MappingType::Value,
        });
        return Ok((hex_pos + 2, end_json_pos));
    }

    // uint 16
    if byte == 0xcd {
        let value = u16::from_be_bytes([data[hex_pos + 1], data[hex_pos + 2]]);
        let value_str = value.to_string();
        let end_json_pos = json_pos + value_str.len();
        mappings.push(PositionMapping {
            json_start: json_pos,
            json_end: end_json_pos,
            hex_start: hex_pos,
            hex_end: hex_pos + 3,
            mapping_type: MappingType::Value,
        });
        return Ok((hex_pos + 3, end_json_pos));
    }

    // uint 32
    if byte == 0xce {
        let value = u32::from_be_bytes([data[hex_pos + 1], data[hex_pos + 2], data[hex_pos + 3], data[hex_pos + 4]]);
        let value_str = value.to_string();
        let end_json_pos = json_pos + value_str.len();
        mappings.push(PositionMapping {
            json_start: json_pos,
            json_end: end_json_pos,
            hex_start: hex_pos,
            hex_end: hex_pos + 5,
            mapping_type: MappingType::Value,
        });
        return Ok((hex_pos + 5, end_json_pos));
    }

    // uint 64
    if byte == 0xcf {
        let value = u64::from_be_bytes([
            data[hex_pos + 1],
            data[hex_pos + 2],
            data[hex_pos + 3],
            data[hex_pos + 4],
            data[hex_pos + 5],
            data[hex_pos + 6],
            data[hex_pos + 7],
            data[hex_pos + 8],
        ]);
        let value_str = value.to_string();
        let end_json_pos = json_pos + value_str.len();
        mappings.push(PositionMapping {
            json_start: json_pos,
            json_end: end_json_pos,
            hex_start: hex_pos,
            hex_end: hex_pos + 9,
            mapping_type: MappingType::Value,
        });
        return Ok((hex_pos + 9, end_json_pos));
    }

    // int 8
    if byte == 0xd0 {
        let value = data[hex_pos + 1] as i8;
        let value_str = value.to_string();
        let end_json_pos = json_pos + value_str.len();
        mappings.push(PositionMapping {
            json_start: json_pos,
            json_end: end_json_pos,
            hex_start: hex_pos,
            hex_end: hex_pos + 2,
            mapping_type: MappingType::Value,
        });
        return Ok((hex_pos + 2, end_json_pos));
    }

    // int 16
    if byte == 0xd1 {
        let value = i16::from_be_bytes([data[hex_pos + 1], data[hex_pos + 2]]);
        let value_str = value.to_string();
        let end_json_pos = json_pos + value_str.len();
        mappings.push(PositionMapping {
            json_start: json_pos,
            json_end: end_json_pos,
            hex_start: hex_pos,
            hex_end: hex_pos + 3,
            mapping_type: MappingType::Value,
        });
        return Ok((hex_pos + 3, end_json_pos));
    }

    // int 32
    if byte == 0xd2 {
        let value = i32::from_be_bytes([data[hex_pos + 1], data[hex_pos + 2], data[hex_pos + 3], data[hex_pos + 4]]);
        let value_str = value.to_string();
        let end_json_pos = json_pos + value_str.len();
        mappings.push(PositionMapping {
            json_start: json_pos,
            json_end: end_json_pos,
            hex_start: hex_pos,
            hex_end: hex_pos + 5,
            mapping_type: MappingType::Value,
        });
        return Ok((hex_pos + 5, end_json_pos));
    }

    // int 64
    if byte == 0xd3 {
        let value = i64::from_be_bytes([
            data[hex_pos + 1],
            data[hex_pos + 2],
            data[hex_pos + 3],
            data[hex_pos + 4],
            data[hex_pos + 5],
            data[hex_pos + 6],
            data[hex_pos + 7],
            data[hex_pos + 8],
        ]);
        let value_str = value.to_string();
        let end_json_pos = json_pos + value_str.len();
        mappings.push(PositionMapping {
            json_start: json_pos,
            json_end: end_json_pos,
            hex_start: hex_pos,
            hex_end: hex_pos + 9,
            mapping_type: MappingType::Value,
        });
        return Ok((hex_pos + 9, end_json_pos));
    }

    // str 8
    if byte == 0xd9 {
        let length = data[hex_pos + 1] as usize;
        let str_bytes = &data[hex_pos + 2..hex_pos + 2 + length];
        let s = String::from_utf8_lossy(str_bytes).to_string();
        let json_str = serde_json::to_string(&s).unwrap_or_default();
        let end_json_pos = json_pos + json_str.len();
        mappings.push(PositionMapping {
            json_start: json_pos,
            json_end: end_json_pos,
            hex_start: hex_pos,
            hex_end: hex_pos + 2 + length,
            mapping_type: MappingType::Value,
        });
        return Ok((hex_pos + 2 + length, end_json_pos));
    }

    // str 16
    if byte == 0xda {
        let length = u16::from_be_bytes([data[hex_pos + 1], data[hex_pos + 2]]) as usize;
        let str_bytes = &data[hex_pos + 3..hex_pos + 3 + length];
        let s = String::from_utf8_lossy(str_bytes).to_string();
        let json_str = serde_json::to_string(&s).unwrap_or_default();
        let end_json_pos = json_pos + json_str.len();
        mappings.push(PositionMapping {
            json_start: json_pos,
            json_end: end_json_pos,
            hex_start: hex_pos,
            hex_end: hex_pos + 3 + length,
            mapping_type: MappingType::Value,
        });
        return Ok((hex_pos + 3 + length, end_json_pos));
    }

    // str 32
    if byte == 0xdb {
        let length = u32::from_be_bytes([data[hex_pos + 1], data[hex_pos + 2], data[hex_pos + 3], data[hex_pos + 4]]) as usize;
        let str_bytes = &data[hex_pos + 5..hex_pos + 5 + length];
        let s = String::from_utf8_lossy(str_bytes).to_string();
        let json_str = serde_json::to_string(&s).unwrap_or_default();
        let end_json_pos = json_pos + json_str.len();
        mappings.push(PositionMapping {
            json_start: json_pos,
            json_end: end_json_pos,
            hex_start: hex_pos,
            hex_end: hex_pos + 5 + length,
            mapping_type: MappingType::Value,
        });
        return Ok((hex_pos + 5 + length, end_json_pos));
    }

    // array 16
    if byte == 0xdc {
        let count = u16::from_be_bytes([data[hex_pos + 1], data[hex_pos + 2]]) as usize;
        let mut current_json_pos = json_pos;
        if json_pos < json_chars.len() && json_chars[current_json_pos] == '[' {
            current_json_pos += 1;
        }
        let mut current_hex_pos = hex_pos + 3;

        for _ in 0..count {
            current_json_pos = skip_whitespace_and_delimiters(json_string, current_json_pos, ",");
            let (value_hex_end, value_json_end) =
                build_mappings(data, json_string, mappings, current_hex_pos, current_json_pos)?;
            current_hex_pos = value_hex_end;
            current_json_pos = value_json_end;
        }

        current_json_pos = skip_whitespace(json_string, current_json_pos);
        if current_json_pos < json_chars.len() && json_chars[current_json_pos] == ']' {
            current_json_pos += 1;
        }

        return Ok((current_hex_pos, current_json_pos));
    }

    // array 32
    if byte == 0xdd {
        let count = u32::from_be_bytes([data[hex_pos + 1], data[hex_pos + 2], data[hex_pos + 3], data[hex_pos + 4]]) as usize;
        let mut current_json_pos = json_pos;
        if json_pos < json_chars.len() && json_chars[current_json_pos] == '[' {
            current_json_pos += 1;
        }
        let mut current_hex_pos = hex_pos + 5;

        for _ in 0..count {
            current_json_pos = skip_whitespace_and_delimiters(json_string, current_json_pos, ",");
            let (value_hex_end, value_json_end) =
                build_mappings(data, json_string, mappings, current_hex_pos, current_json_pos)?;
            current_hex_pos = value_hex_end;
            current_json_pos = value_json_end;
        }

        current_json_pos = skip_whitespace(json_string, current_json_pos);
        if current_json_pos < json_chars.len() && json_chars[current_json_pos] == ']' {
            current_json_pos += 1;
        }

        return Ok((current_hex_pos, current_json_pos));
    }

    // map 16
    if byte == 0xde {
        let count = u16::from_be_bytes([data[hex_pos + 1], data[hex_pos + 2]]) as usize;
        let mut current_json_pos = json_pos;
        if json_pos < json_chars.len() && json_chars[current_json_pos] == '{' {
            current_json_pos += 1;
        }
        let mut current_hex_pos = hex_pos + 3;

        for _ in 0..count {
            current_json_pos = skip_whitespace_and_delimiters(json_string, current_json_pos, ",");

            let key_hex_start = current_hex_pos;
            let (key_value, key_end) = parse_msgpack_value(data, current_hex_pos)?;
            current_hex_pos = key_end;

            if current_json_pos < json_chars.len() && json_chars[current_json_pos] == '"' {
                let key_str = serde_json::to_string(&key_value).unwrap_or_default();
                let key_end_json_pos = current_json_pos + key_str.len();
                mappings.push(PositionMapping {
                    json_start: current_json_pos,
                    json_end: key_end_json_pos,
                    hex_start: key_hex_start,
                    hex_end: current_hex_pos,
                    mapping_type: MappingType::Key,
                });
                current_json_pos = key_end_json_pos;
            }

            current_json_pos = skip_whitespace_and_delimiters(json_string, current_json_pos, ":");

            let (value_hex_end, value_json_end) =
                build_mappings(data, json_string, mappings, current_hex_pos, current_json_pos)?;
            current_hex_pos = value_hex_end;
            current_json_pos = value_json_end;
        }

        current_json_pos = skip_whitespace(json_string, current_json_pos);
        if current_json_pos < json_chars.len() && json_chars[current_json_pos] == '}' {
            current_json_pos += 1;
        }

        return Ok((current_hex_pos, current_json_pos));
    }

    // map 32
    if byte == 0xdf {
        let count = u32::from_be_bytes([data[hex_pos + 1], data[hex_pos + 2], data[hex_pos + 3], data[hex_pos + 4]]) as usize;
        let mut current_json_pos = json_pos;
        if json_pos < json_chars.len() && json_chars[current_json_pos] == '{' {
            current_json_pos += 1;
        }
        let mut current_hex_pos = hex_pos + 5;

        for _ in 0..count {
            current_json_pos = skip_whitespace_and_delimiters(json_string, current_json_pos, ",");

            let key_hex_start = current_hex_pos;
            let (key_value, key_end) = parse_msgpack_value(data, current_hex_pos)?;
            current_hex_pos = key_end;

            if current_json_pos < json_chars.len() && json_chars[current_json_pos] == '"' {
                let key_str = serde_json::to_string(&key_value).unwrap_or_default();
                let key_end_json_pos = current_json_pos + key_str.len();
                mappings.push(PositionMapping {
                    json_start: current_json_pos,
                    json_end: key_end_json_pos,
                    hex_start: key_hex_start,
                    hex_end: current_hex_pos,
                    mapping_type: MappingType::Key,
                });
                current_json_pos = key_end_json_pos;
            }

            current_json_pos = skip_whitespace_and_delimiters(json_string, current_json_pos, ":");

            let (value_hex_end, value_json_end) =
                build_mappings(data, json_string, mappings, current_hex_pos, current_json_pos)?;
            current_hex_pos = value_hex_end;
            current_json_pos = value_json_end;
        }

        current_json_pos = skip_whitespace(json_string, current_json_pos);
        if current_json_pos < json_chars.len() && json_chars[current_json_pos] == '}' {
            current_json_pos += 1;
        }

        return Ok((current_hex_pos, current_json_pos));
    }

    // For other types, skip them
    let (_, end_pos) = parse_msgpack_value(data, hex_pos)?;
    Ok((end_pos, json_pos))
}

/// Creates position mappings between msgpack bytes and JSON text.
pub fn create_position_mappings(msgpack_data: &[u8], json_string: &str) -> Vec<PositionMapping> {
    let mut mappings = Vec::new();
    let _ = build_mappings(msgpack_data, json_string, &mut mappings, 0, 0);
    mappings
}

/// Finds the hex byte range that corresponds to a given JSON text selection.
pub fn find_hex_range_for_json_selection(
    mappings: &[PositionMapping],
    json_sel_start: usize,
    json_sel_end: usize,
) -> Option<(usize, usize)> {
    // Find all mappings that overlap with the selection
    let overlapping: Vec<_> = mappings
        .iter()
        .filter(|m| m.json_start < json_sel_end && m.json_end > json_sel_start)
        .collect();

    if overlapping.is_empty() {
        return None;
    }

    // Return the union of all overlapping hex ranges
    let hex_start = overlapping.iter().map(|m| m.hex_start).min().unwrap();
    let hex_end = overlapping.iter().map(|m| m.hex_end).max().unwrap();

    Some((hex_start, hex_end))
}

/// Converts byte range to character range in the space-separated hex string.
/// Each byte takes 3 characters (2 hex digits + 1 space), except the last byte.
pub fn byte_range_to_hex_char_range(hex_start: usize, hex_end: usize) -> (usize, usize) {
    let char_start = hex_start * 3;
    let char_end = hex_end * 3 - 1; // -1 to not include trailing space of last byte
    (char_start, char_end)
}
