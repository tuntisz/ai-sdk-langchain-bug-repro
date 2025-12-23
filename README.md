# @ai-sdk/langchain Bug Reproduction

This repository demonstrates a bug in `@ai-sdk/langchain` where `toBaseMessages` creates orphaned `AIMessage` objects with `tool_calls` that have no corresponding `ToolMessage`. This causes OpenAI API errors in multi-turn conversations with tool calls.

## The Bug

When using `@ai-sdk/langchain` with LangGraph agents that have tools, the following error occurs after multiple turns of tool usage:

```
400 An assistant message with 'tool_calls' must be followed by tool messages
responding to each 'tool_call_id'. The following tool_call_ids did not have
response messages: call_8xtoEZ2bDLCMkKhK1wQ1Y3XC
```

### Root Cause

1. **`toUIMessageStream`** processes LangGraph `values` events that contain the full message history
2. It emits `tool-input-start` and `tool-input-available` for historical tool calls from previous turns
3. It does **NOT** emit `tool-output-available` for those historical tool calls
4. The client builds a `UIMessage` with tool parts in state `input-available` (no output)
5. **`toBaseMessages`** converts this to an `AIMessage` with `tool_calls` but creates no `ToolMessage`
6. LangChain/OpenAI rejects the malformed message history

## Package Versions

- `@ai-sdk/langchain`: ^2.0.3
- `ai`: ^6.0.3
- `langchain`: ^1.2.3
- `@langchain/openai`: ^1.2.0

## Reproduction

### Option 1: Run the Unit Tests

```bash
pnpm install
pnpm test
```

The tests will fail, demonstrating the bug:

```
=== BUG REPRODUCTION ===
AIMessages with tool_calls: 2
ToolMessages: 1
Tool call IDs in AIMessages: [ 'call_8xtoEZ2bDLCMkKhK1wQ1Y3XC', 'call_MbGmUhDhn5qui6i7duFje8OC' ]
Tool call IDs in ToolMessages: [ 'call_MbGmUhDhn5qui6i7duFje8OC' ]
ORPHANED tool call IDs: [ 'call_8xtoEZ2bDLCMkKhK1wQ1Y3XC' ]
```

### Option 2: Visual Reproduction with the App

1. Set your OpenAI API key:
   ```bash
   export OPENAI_API_KEY=your-key-here
   ```

2. Start the dev server:
   ```bash
   pnpm install
   pnpm dev
   ```

3. Open http://localhost:3000

4. In the chat:
   - Type: `do maths with 123` (triggers tool call, works fine)
   - Type: `do maths with 345` (triggers another tool call, works fine, shows duplicate tool call in the stream)
   - Type: `do maths with 999` (ERROR - this is when the bug manifests)

5. Open browser DevTools Network tab and observe the error response:
   ```json
   {
     "type": "error",
     "errorText": "400 An assistant message with 'tool_calls' must be followed by tool messages..."
   }
   ```

### What You'll See in the Stream

On the third request, the stream shows historical tool calls being re-emitted without outputs:

```
{"type":"start"}
{"type":"tool-input-start","toolCallId":"call_8xtoEZ2bDLCMkKhK1wQ1Y3XC",...}  <- HISTORICAL (no output!)
{"type":"tool-input-available","toolCallId":"call_8xtoEZ2bDLCMkKhK1wQ1Y3XC",...}
{"type":"start-step"}
{"type":"tool-input-start","toolCallId":"call_MbGmUhDhn5qui6i7duFje8OC",...}  <- CURRENT
...
{"type":"tool-output-available","toolCallId":"call_MbGmUhDhn5qui6i7duFje8OC",...}  <- Only for current!
{"type":"error","errorText":"400 An assistant message with 'tool_calls'..."}
```

## Expected Behavior

Historical tool calls from previous turns should either:
1. Not be re-emitted in the stream (they're already in the client's message history), OR
2. Be emitted with BOTH input AND output events to maintain consistency

## Files

- `app/api/agent/route.ts` - LangGraph agent with a simple math tool
- `app/page.tsx` - Chat UI using `useChat` from `@ai-sdk/react`
- `test/langchain-adapter-bugs.test.ts` - Unit tests reproducing the bug
