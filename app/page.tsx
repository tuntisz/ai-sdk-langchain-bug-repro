"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  ReasoningUIPart,
  TextUIPart,
  ToolUIPart,
  ToolResultPart,
  DynamicToolUIPart,
} from "ai";
import { useState, useRef, useEffect, useCallback } from "react";

const TextPart = ({ part }: { part: TextUIPart }) => (
  <div className="whitespace-pre-wrap leading-relaxed">{part.text}</div>
);

const DynamicToolPartUI = ({ part }: { part: DynamicToolUIPart }) => (
  <div className="font-mono text-sm text-[var(--accent)] bg-[var(--accent-dim)] px-3 py-2 rounded-md border border-[var(--accent)]/20 flex items-center gap-2">
    <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse-glow" />
    <span className="opacity-70">executing</span>
    <code className="text-xs">{JSON.stringify(part.output, null, 2)}</code>
  </div>
);

const ToolPart = ({ part }: { part: ToolUIPart }) => (
  <div className="font-mono text-sm text-[var(--accent)] bg-[var(--accent-dim)] px-3 py-2 rounded-md border border-[var(--accent)]/20 flex items-center gap-2">
    <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse-glow" />
    <span className="opacity-70">executing</span>
    <code className="text-xs">{part.toolCallId.slice(0, 12)}...</code>
  </div>
);

const ToolResultPartUI = ({ part }: { part: ToolResultPart }) => (
  <div className="font-mono text-sm text-[var(--accent)] bg-[var(--accent-dim)] px-3 py-2 rounded-md border border-[var(--accent)]/20 flex items-center gap-2">
    <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse-glow" />
    <span className="opacity-70">result</span>
    <code className="text-xs">{JSON.stringify(part.output)}</code>
  </div>
);

const ReasoningPart = ({ part }: { part: ReasoningUIPart }) => (
  <div className="text-[var(--muted)] italic border-l-2 border-[var(--accent)]/30 pl-3 text-sm">
    {part.text}
  </div>
);

export default function Home() {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/agent",
    }),
    onFinish: (result) => {
      console.log({result});
    },
  });
  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage({
      role: "user",
      parts: [{ type: "text", text: input }],
    });
    setInput("");
  };

  return (
    <div className="scanlines noise min-h-screen flex flex-col bg-[var(--background)]">
      {/* Header */}
      <header className="border-b border-[var(--border)] bg-[var(--surface)]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-[var(--accent)] glow-accent" />
          <h1 className="font-mono text-sm font-medium tracking-wide text-[var(--foreground)]">
            AI SDK + LangChain
          </h1>
          <span className="font-mono text-xs text-[var(--muted)] ml-auto">
            demo v0.1
          </span>
        </div>
      </header>

      {/* Messages Area */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
          {messages.length === 0 && (
            <div className="text-center py-20 animate-fade-in-up">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--accent-dim)] border border-[var(--accent)]/20 mb-6">
                <svg className="w-8 h-8 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h2 className="font-mono text-lg font-medium text-[var(--foreground)] mb-2">
                Ready to assist
              </h2>
              <p className="text-[var(--muted)] text-sm max-w-md mx-auto">
                Send a message to start the conversation. Powered by LangChain and the Vercel AI SDK.
              </p>
            </div>
          )}

          {messages.map((message, idx) => (
            <div
              key={message.id}
              className="animate-fade-in-up"
              style={{ animationDelay: `${idx * 50}ms` }}
            >
              <div
                className={`flex gap-4 ${
                  message.role === "user" ? "flex-row-reverse" : "flex-row"
                }`}
              >
                {/* Avatar */}
                <div
                  className={`w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-mono font-medium ${
                    message.role === "user"
                      ? "bg-[var(--user-bubble)] text-[var(--foreground)] border border-[var(--border)]"
                      : "bg-[var(--accent-dim)] text-[var(--accent)] border border-[var(--accent)]/20"
                  }`}
                >
                  {message.role === "user" ? "U" : "AI"}
                </div>

                {/* Message Bubble */}
                <div
                  className={`flex-1 max-w-[85%] rounded-2xl px-5 py-4 space-y-3 ${
                    message.role === "user"
                      ? "bg-[var(--user-bubble)] border border-[var(--border)] rounded-tr-md"
                      : "bg-[var(--assistant-bubble)] border border-[var(--accent)]/10 rounded-tl-md"
                  }`}
                >
                  {message.parts.map((part, partIdx) => (
                    <div key={partIdx}>
                      {part.type === "text" && <TextPart part={part} />}
                      {part.type === "tool-invocation" && <ToolPart part={part as ToolUIPart} />}
                      {part.type === "reasoning" && <ReasoningPart part={part as ReasoningUIPart} />}
                      {part.type === "tool-result" && <ToolResultPartUI part={part as unknown as ToolResultPart} />}
                      {part.type === "dynamic-tool" && <DynamicToolPartUI part={part as unknown as DynamicToolUIPart} />}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-4 animate-fade-in-up">
              <div className="w-8 h-8 rounded-lg bg-[var(--accent-dim)] text-[var(--accent)] border border-[var(--accent)]/20 flex items-center justify-center text-xs font-mono font-medium">
                AI
              </div>
              <div className="bg-[var(--assistant-bubble)] border border-[var(--accent)]/10 rounded-2xl rounded-tl-md px-5 py-4">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse-glow" />
                  <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse-glow" style={{ animationDelay: "0.2s" }} />
                  <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse-glow" style={{ animationDelay: "0.4s" }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input Area */}
      <div className="border-t border-[var(--border)] bg-[var(--surface)]/80 backdrop-blur-sm sticky bottom-0">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto px-6 py-4">
          <div className="flex gap-3 items-end">
            <div className="flex-1 relative">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                placeholder="Type your message..."
                rows={1}
                className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-xl px-4 py-3 text-[var(--foreground)] placeholder:text-[var(--muted)] resize-none focus:outline-none input-glow transition-shadow font-sans"
                style={{ minHeight: "48px", maxHeight: "200px" }}
              />
            </div>
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="h-12 px-6 rounded-xl bg-[var(--accent)] text-[var(--background)] font-medium font-mono text-sm tracking-wide transition-all hover:scale-[1.02] hover:glow-accent disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-none flex items-center gap-2"
            >
              Send
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
          <p className="text-[var(--muted)] text-xs mt-2 text-center font-mono">
            Press Enter to send · Shift+Enter for new line
          </p>
        </form>
      </div>
    </div>
  );
}
