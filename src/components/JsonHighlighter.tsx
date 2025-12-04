import { useRef, useEffect, useState } from 'react';
import './JsonHighlighter.css';

interface JsonHighlighterProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
}

// Tokenize JSON string for syntax highlighting
function tokenizeJson(json: string): { type: string; value: string }[] {
  const tokens: { type: string; value: string }[] = [];
  let i = 0;

  while (i < json.length) {
    const char = json[i];

    // Whitespace
    if (/\s/.test(char)) {
      let whitespace = '';
      while (i < json.length && /\s/.test(json[i])) {
        whitespace += json[i];
        i++;
      }
      tokens.push({ type: 'whitespace', value: whitespace });
      continue;
    }

    // String
    if (char === '"') {
      let str = '"';
      i++;
      while (i < json.length && json[i] !== '"') {
        if (json[i] === '\\' && i + 1 < json.length) {
          str += json[i] + json[i + 1];
          i += 2;
        } else {
          str += json[i];
          i++;
        }
      }
      if (i < json.length) {
        str += json[i];
        i++;
      }
      tokens.push({ type: 'string', value: str });
      continue;
    }

    // Number - match JSON number format more precisely
    if (/[-\d]/.test(char)) {
      let num = '';
      // Optional minus sign
      if (json[i] === '-') {
        num += json[i];
        i++;
      }
      // Integer part
      while (i < json.length && /\d/.test(json[i])) {
        num += json[i];
        i++;
      }
      // Optional fractional part
      if (i < json.length && json[i] === '.') {
        num += json[i];
        i++;
        while (i < json.length && /\d/.test(json[i])) {
          num += json[i];
          i++;
        }
      }
      // Optional exponent part
      if (i < json.length && /[eE]/.test(json[i])) {
        num += json[i];
        i++;
        if (i < json.length && /[+-]/.test(json[i])) {
          num += json[i];
          i++;
        }
        while (i < json.length && /\d/.test(json[i])) {
          num += json[i];
          i++;
        }
      }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // Boolean true
    if (json.slice(i, i + 4) === 'true') {
      tokens.push({ type: 'boolean', value: 'true' });
      i += 4;
      continue;
    }

    // Boolean false
    if (json.slice(i, i + 5) === 'false') {
      tokens.push({ type: 'boolean', value: 'false' });
      i += 5;
      continue;
    }

    // Null
    if (json.slice(i, i + 4) === 'null') {
      tokens.push({ type: 'null', value: 'null' });
      i += 4;
      continue;
    }

    // Punctuation
    if (/[{}[\]:,]/.test(char)) {
      tokens.push({ type: 'punctuation', value: char });
      i++;
      continue;
    }

    // Unknown character (for invalid JSON or partial input)
    tokens.push({ type: 'unknown', value: char });
    i++;
  }

  return tokens;
}

// Render highlighted JSON
function renderHighlightedJson(json: string): React.ReactNode {
  const tokens = tokenizeJson(json);
  
  return tokens.map((token, index) => {
    if (token.type === 'whitespace') {
      return <span key={index}>{token.value}</span>;
    }
    return (
      <span key={index} className={`json-${token.type}`}>
        {token.value}
      </span>
    );
  });
}

export function JsonHighlighter({ value, onChange, placeholder, id }: JsonHighlighterProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  // Sync scroll between textarea and highlight overlay
  const handleScroll = () => {
    if (textareaRef.current) {
      setScrollTop(textareaRef.current.scrollTop);
      setScrollLeft(textareaRef.current.scrollLeft);
    }
  };

  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollTop = scrollTop;
      highlightRef.current.scrollLeft = scrollLeft;
    }
  }, [scrollTop, scrollLeft]);

  return (
    <div className="json-highlighter-container">
      <pre
        ref={highlightRef}
        className="json-highlight-overlay"
        aria-hidden="true"
      >
        <code>{renderHighlightedJson(value)}{value.endsWith('\n') ? ' ' : ''}</code>
      </pre>
      <textarea
        ref={textareaRef}
        id={id}
        className="json-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        placeholder={placeholder}
        spellCheck={false}
      />
    </div>
  );
}
