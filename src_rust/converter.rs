use base64::Engine;
use serde_json::Value;

/// Convert Base64-encoded msgpack data to pretty JSON string
/// Supports uint64 values by using serde_json's arbitrary precision feature
pub fn msgpack_to_json(base64_string: &str) -> Result<String, String> {
    // Decode base64 to binary
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_string)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // Decode msgpack to serde_json::Value
    let value: Value = rmp_serde::from_slice(&bytes)
        .map_err(|e| format!("Failed to decode msgpack: {}", e))?;

    // Convert to pretty JSON
    serde_json::to_string_pretty(&value)
        .map_err(|e| format!("Failed to serialize JSON: {}", e))
}

/// Convert JSON string to Base64-encoded msgpack data
pub fn json_to_msgpack(json_string: &str) -> Result<String, String> {
    // Parse JSON to serde_json::Value
    let value: Value = serde_json::from_str(json_string)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    // Encode to msgpack
    let bytes = rmp_serde::to_vec(&value)
        .map_err(|e| format!("Failed to encode msgpack: {}", e))?;

    // Convert to base64
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// Convert Base64 string to hex string with space-separated bytes
pub fn base64_to_hex(base64_string: &str) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_string)
        .map_err(|_| "Invalid Base64 string".to_string())?;

    Ok(bytes
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<_>>()
        .join(" "))
}

/// Convert hex string (space-separated or continuous) to Base64 string
pub fn hex_to_base64(hex_string: &str) -> Result<String, String> {
    // Remove all whitespace
    let clean_hex: String = hex_string.chars().filter(|c| !c.is_whitespace()).collect();

    if clean_hex.is_empty() {
        return Ok(String::new());
    }

    if clean_hex.len() % 2 != 0 {
        return Err("Hex string must have an even number of characters".to_string());
    }

    // Validate hex characters
    if !clean_hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid hex characters".to_string());
    }

    // Convert hex to bytes
    let bytes: Vec<u8> = (0..clean_hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&clean_hex[i..i + 2], 16).unwrap())
        .collect();

    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_msgpack_to_json_simple() {
        // {"hello": "world"} in msgpack, base64 encoded
        let msgpack_base64 = "gaVoZWxsb6V3b3JsZA==";
        let json = msgpack_to_json(msgpack_base64).unwrap();
        let parsed: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["hello"], "world");
    }

    #[test]
    fn test_json_to_msgpack_roundtrip() {
        let json = r#"{"hello": "world"}"#;
        let msgpack = json_to_msgpack(json).unwrap();
        let back_to_json = msgpack_to_json(&msgpack).unwrap();
        let parsed: Value = serde_json::from_str(&back_to_json).unwrap();
        assert_eq!(parsed["hello"], "world");
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
    fn test_roundtrip_base64_hex() {
        let original = "gaVoZWxsb6V3b3JsZA==";
        let hex = base64_to_hex(original).unwrap();
        let result = hex_to_base64(&hex).unwrap();
        assert_eq!(result, original);
    }
}
