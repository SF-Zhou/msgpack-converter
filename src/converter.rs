use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use serde_json::Value;

/// Convert base64-encoded MessagePack to JSON string
pub fn msgpack_to_json(base64_str: &str) -> Result<String, String> {
    // Decode base64
    let bytes = STANDARD
        .decode(base64_str.trim())
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // Decode MessagePack
    let value: Value = rmp_serde::from_slice(&bytes)
        .map_err(|e| format!("Failed to decode MessagePack: {}", e))?;

    // Convert to pretty JSON
    serde_json::to_string_pretty(&value)
        .map_err(|e| format!("Failed to serialize JSON: {}", e))
}

/// Convert JSON string to base64-encoded MessagePack
pub fn json_to_msgpack(json_str: &str) -> Result<String, String> {
    // Parse JSON
    let value: Value = serde_json::from_str(json_str.trim())
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    // Encode to MessagePack
    let mut buf = Vec::new();
    value
        .serialize(&mut rmp_serde::Serializer::new(&mut buf))
        .map_err(|e| format!("Failed to encode MessagePack: {}", e))?;

    // Encode to base64
    Ok(STANDARD.encode(&buf))
}

/// Convert base64 to hex string with space-separated bytes
pub fn base64_to_hex(base64_str: &str) -> Result<String, String> {
    let bytes = STANDARD
        .decode(base64_str.trim())
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    Ok(bytes
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<_>>()
        .join(" "))
}

/// Convert hex string (space-separated or continuous) to base64
pub fn hex_to_base64(hex_str: &str) -> Result<String, String> {
    // Remove all whitespace
    let clean_hex = hex_str.split_whitespace().collect::<String>();

    if clean_hex.is_empty() {
        return Ok(String::new());
    }

    if clean_hex.len() % 2 != 0 {
        return Err("Hex string must have an even number of characters".to_string());
    }

    let mut bytes = Vec::new();
    for i in (0..clean_hex.len()).step_by(2) {
        let byte_str = &clean_hex[i..i + 2];
        let byte = u8::from_str_radix(byte_str, 16)
            .map_err(|_| format!("Invalid hex characters: {}", byte_str))?;
        bytes.push(byte);
    }

    Ok(STANDARD.encode(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_msgpack_to_json() {
        // {"hello": "world"} in msgpack, base64 encoded
        let msgpack_base64 = "gaVoZWxsb6V3b3JsZA==";
        let json = msgpack_to_json(msgpack_base64).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["hello"], "world");
    }

    #[test]
    fn test_json_to_msgpack() {
        let json = r#"{"hello": "world"}"#;
        let msgpack = json_to_msgpack(json).unwrap();
        let back_to_json = msgpack_to_json(&msgpack).unwrap();
        let value: serde_json::Value = serde_json::from_str(&back_to_json).unwrap();
        assert_eq!(value["hello"], "world");
    }

    #[test]
    fn test_large_integers() {
        // Test with a value larger than JavaScript's MAX_SAFE_INTEGER
        let json = r#"{"value": 9007199254740993}"#;
        let msgpack = json_to_msgpack(json).unwrap();
        let back_to_json = msgpack_to_json(&msgpack).unwrap();
        assert!(back_to_json.contains("9007199254740993"));
    }

    #[test]
    fn test_base64_to_hex() {
        let hex = base64_to_hex("aGVsbG8=").unwrap();
        assert_eq!(hex, "68 65 6C 6C 6F");
    }

    #[test]
    fn test_hex_to_base64() {
        let base64 = hex_to_base64("68 65 6C 6C 6F").unwrap();
        assert_eq!(base64, "aGVsbG8=");
    }

    #[test]
    fn test_hex_roundtrip() {
        let original = "gaVoZWxsb6V3b3JsZA==";
        let hex = base64_to_hex(original).unwrap();
        let result = hex_to_base64(&hex).unwrap();
        assert_eq!(result, original);
    }
}
