import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-json';
import './JsonHighlighter.css';

interface JsonHighlighterProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  onSelectionChange?: (selStart: number, selEnd: number) => void;
}

export function JsonHighlighter({
  value,
  onChange,
  placeholder,
  id,
  onSelectionChange,
}: JsonHighlighterProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  // Use PrismJS for syntax highlighting
  const highlightedHtml = useMemo(() => {
    if (!value) return '';
    try {
      return Prism.highlight(value, Prism.languages.json, 'json');
    } catch {
      // If highlighting fails, return properly escaped text
      return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
  }, [value]);

  // Sync scroll between textarea and highlight overlay
  const handleScroll = useCallback(() => {
    if (textareaRef.current) {
      setScrollTop(textareaRef.current.scrollTop);
      setScrollLeft(textareaRef.current.scrollLeft);
    }
  }, []);

  // Handle selection changes
  const handleSelect = useCallback(() => {
    if (textareaRef.current && onSelectionChange) {
      const { selectionStart, selectionEnd } = textareaRef.current;
      onSelectionChange(selectionStart, selectionEnd);
    }
  }, [onSelectionChange]);

  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollTop = scrollTop;
      highlightRef.current.scrollLeft = scrollLeft;
    }
  }, [scrollTop, scrollLeft]);

  return (
    <div className="json-highlighter-container">
      <pre ref={highlightRef} className="json-highlight-overlay" aria-hidden="true">
        <code
          className="language-json"
          dangerouslySetInnerHTML={{ __html: highlightedHtml + (value.endsWith('\n') ? ' ' : '') }}
        />
      </pre>
      <textarea
        ref={textareaRef}
        id={id}
        className="json-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        onSelect={handleSelect}
        onMouseUp={handleSelect}
        onKeyUp={handleSelect}
        placeholder={placeholder}
        spellCheck={false}
      />
    </div>
  );
}
