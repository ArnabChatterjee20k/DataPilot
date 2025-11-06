import { Button } from "@/components/ui/button";
import { PlayIcon } from "lucide-react";

import { useRef, useEffect, useState } from "react";

interface CodeAreaProps {
  content: string;
  onChange: (content: string) => void;
}

export function CodeArea({ content, onChange }: CodeAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [lineCount, setLineCount] = useState(1);

  useEffect(() => {
    const lines = content.split("\n").length;
    setLineCount(lines);
  }, [content]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent =
        content.substring(0, start) + "\t" + content.substring(end);
      onChange(newContent);

      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 1;
      }, 0);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="bg-[#0f0f0f] border-r border-[#1a1a1a] px-4 py-3 font-mono text-sm flex justify-end">
        <Button size="sm" variant="outline" className="cursor-pointer">
          <PlayIcon />
          Run
        </Button>
      </div>

      <div className="flex h-3.5 flex-1 overflow-hidden bg-[#0a0a0a]">
        {/* Line numbers */}
        <div className="bg-[#0f0f0f] border-r border-[#1a1a1a] px-3 py-4 font-mono text-sm text-[#555] select-none overflow-hidden min-w-[3rem]">
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i + 1} className="h-6 leading-6">
              {i + 1}
            </div>
          ))}
        </div>
        {/* Code editor */}
        <div className="flex-1 overflow-hidden relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => onChange(e.target.value)}
            rows={1}
            onKeyDown={handleKeyDown}
            className="absolute inset-0 w-full h-full font-mono text-sm text-white bg-transparent resize-none outline-none px-4 py-4 leading-6"
            style={{
              color: "transparent",
              caretColor: "white",
              textShadow: "0 0 0 #d1d5db",
              backgroundColor: "#0a0a0a",
            }}
            spellCheck="false"
          />
          {/* Syntax highlighting overlay */}
          {/* <pre className="absolute inset-0 w-full h-full font-mono text-sm bg-transparent pointer-events-none p-4 overflow-hidden leading-6"> */}
          {/* <code className="text-[#e0e0e0]">{content}</code> */}
          {/* </pre> */}
          {content}
          {/* Status bar */}
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-2.5 bg-[#0f0f0f] border-t border-[#1a1a1a] text-xs text-[#666]">
            <span>Ln {lineCount}</span>
            <button className="hover:text-white transition-colors">
              Format
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
