/**
 * Bug Reproduction Tests for @ai-sdk/langchain adapter
 *
 * These tests demonstrate two related bugs in the @ai-sdk/langchain package
 * that cause "tool_calls must be followed by tool messages" errors when
 * using LangGraph agents with multi-turn conversations.
 *
 * Package versions tested:
 * - @ai-sdk/langchain: ^2.0.3
 * - ai: ^6.0.3
 */

import { describe, it, expect } from 'vitest';
import { toBaseMessages, toUIMessageStream, convertModelMessages } from '@ai-sdk/langchain';
import { convertToModelMessages, type UIMessage } from 'ai';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

describe('@ai-sdk/langchain bugs', () => {

  /**
   * BUG 1: toUIMessageStream emits tool-input events for historical tool calls
   * without corresponding tool-output events
   *
   * When processing a LangGraph "values" event that contains message history,
   * the adapter emits tool-input-start and tool-input-available for ALL AIMessages
   * with tool_calls, including historical ones. However, it does NOT emit
   * tool-output-available for those historical tool calls.
   *
   * This creates orphaned tool parts in the UIMessage that have state "input-available"
   * instead of "output-available".
   *
   * NOTE: This test uses a simplified mock that may not perfectly reproduce the bug.
   * The bug is observed in real LangGraph streams where the "values" event contains
   * the full message history. See the stream log in the bug report for evidence.
   *
   * Evidence from real stream:
   * ```
   * {"type":"start"}
   * {"type":"tool-input-start","toolCallId":"call_8xtoEZ2bDLCMkKhK1wQ1Y3XC",...}  ← HISTORICAL
   * {"type":"tool-input-available","toolCallId":"call_8xtoEZ2bDLCMkKhK1wQ1Y3XC",...}
   * {"type":"start-step"}
   * {"type":"tool-input-start","toolCallId":"call_MbGmUhDhn5qui6i7duFje8OC",...}  ← CURRENT
   * ...
   * {"type":"tool-output-available","toolCallId":"call_MbGmUhDhn5qui6i7duFje8OC",...}  ← Only for current!
   * ```
   */
  describe('Bug 1: toUIMessageStream re-emits historical tool calls without outputs', () => {

    it('should NOT emit tool-input events for historical tool calls in values event', async () => {
      // Simulate a LangGraph stream with a "values" event containing message history
      // This is what happens when the agent receives input messages from previous turns

      const historicalToolCallId = 'call_HISTORICAL_123';
      const currentToolCallId = 'call_CURRENT_456';

      // Mock LangGraph stream events - this simulates what LangGraph emits
      // when processing a request with message history
      const mockLangGraphEvents = [
        // First "values" event with historical messages
        ['values', {
          messages: [
            // Historical: user message
            { type: 'constructor', id: ['langchain_core', 'messages', 'HumanMessage'], kwargs: { content: 'do maths with 123' } },
            // Historical: AI message with tool call (ALREADY COMPLETED in previous turn)
            { type: 'constructor', id: ['langchain_core', 'messages', 'AIMessage'], kwargs: {
              content: '',
              tool_calls: [{ id: historicalToolCallId, name: 'maths', args: { input: 123 } }]
            }},
            // Historical: tool result
            { type: 'constructor', id: ['langchain_core', 'messages', 'ToolMessage'], kwargs: {
              tool_call_id: historicalToolCallId,
              content: '{"result": "15.5"}'
            }},
            // Historical: AI response
            { type: 'constructor', id: ['langchain_core', 'messages', 'AIMessage'], kwargs: { content: 'The result is 15.5' } },
            // Current: user message
            { type: 'constructor', id: ['langchain_core', 'messages', 'HumanMessage'], kwargs: { content: 'do it again' } },
          ]
        }],
        // "messages" event for current tool call
        ['messages', [
          { type: 'constructor', id: ['langchain_core', 'messages', 'AIMessageChunk'], kwargs: {
            id: 'msg_current',
            content: '',
            tool_call_chunks: [{ id: currentToolCallId, name: 'maths', args: '{"input":123}', index: 0 }]
          }},
          { langgraph_step: 1 }
        ]],
        // Second "values" event after tool call
        ['values', {
          messages: [
            // ... all previous messages plus new ones
            { type: 'constructor', id: ['langchain_core', 'messages', 'HumanMessage'], kwargs: { content: 'do maths with 123' } },
            { type: 'constructor', id: ['langchain_core', 'messages', 'AIMessage'], kwargs: {
              content: '',
              tool_calls: [{ id: historicalToolCallId, name: 'maths', args: { input: 123 } }]
            }},
            { type: 'constructor', id: ['langchain_core', 'messages', 'ToolMessage'], kwargs: {
              tool_call_id: historicalToolCallId,
              content: '{"result": "15.5"}'
            }},
            { type: 'constructor', id: ['langchain_core', 'messages', 'AIMessage'], kwargs: { content: 'The result is 15.5' } },
            { type: 'constructor', id: ['langchain_core', 'messages', 'HumanMessage'], kwargs: { content: 'do it again' } },
            // NEW: current tool call
            { type: 'constructor', id: ['langchain_core', 'messages', 'AIMessage'], kwargs: {
              content: '',
              tool_calls: [{ id: currentToolCallId, name: 'maths', args: { input: 123 } }]
            }},
          ]
        }],
      ];

      // Create async iterator from mock events
      async function* mockStream() {
        for (const event of mockLangGraphEvents) {
          yield event;
        }
      }

      const uiStream = toUIMessageStream(mockStream());
      const reader = uiStream.getReader();

      const chunks: any[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Find all tool-input-start events
      const toolInputStartEvents = chunks.filter(c => c.type === 'tool-input-start');
      const toolInputAvailableEvents = chunks.filter(c => c.type === 'tool-input-available');
      const toolOutputAvailableEvents = chunks.filter(c => c.type === 'tool-output-available');

      console.log('Tool input start events:', toolInputStartEvents);
      console.log('Tool input available events:', toolInputAvailableEvents);
      console.log('Tool output available events:', toolOutputAvailableEvents);

      // BUG: The historical tool call is being emitted as tool-input-start/available
      // but WITHOUT a corresponding tool-output-available
      const historicalToolInputs = toolInputStartEvents.filter(
        e => e.toolCallId === historicalToolCallId
      );
      const historicalToolOutputs = toolOutputAvailableEvents.filter(
        e => e.toolCallId === historicalToolCallId
      );

      // This assertion FAILS - demonstrating the bug
      // Historical tool calls should either:
      // 1. Not be emitted at all (they're already in history), OR
      // 2. Be emitted with BOTH input AND output
      expect(
        historicalToolInputs.length === 0 || historicalToolOutputs.length > 0,
        `Historical tool call ${historicalToolCallId} was emitted with input but no output!`
      ).toBe(true);
    });
  });

  /**
   * BUG 2: toBaseMessages creates orphaned AIMessages when UIMessage has
   * tool parts with state "input-available" (no output)
   *
   * When convertToModelMessages processes a UIMessage with a tool part that
   * has state "input-available", it creates an assistant ModelMessage with
   * a tool-call but does NOT create a corresponding tool ModelMessage.
   *
   * This causes the LangChain error:
   * "An assistant message with 'tool_calls' must be followed by tool messages"
   */
  describe('Bug 2: toBaseMessages creates orphaned AIMessages for incomplete tool calls', () => {

    it('should not create AIMessage with tool_calls unless ToolMessage follows', async () => {
      // This UIMessage represents what the client builds after receiving
      // the buggy stream from Bug 1
      const messagesWithOrphanedToolCall: UIMessage[] = [
        {
          id: 'msg_1',
          role: 'user',
          parts: [{ type: 'text', text: 'do maths with 123' }],
        },
        {
          id: 'msg_2',
          role: 'assistant',
          parts: [
            // This is an orphaned tool call - it has input but NO output
            // because toUIMessageStream emitted tool-input-available but not tool-output-available
            {
              type: 'dynamic-tool',
              toolName: 'maths',
              toolCallId: 'call_ORPHANED_789',
              state: 'input-available', // <-- BUG: No output was received!
              input: { input: 123 },
            },
            { type: 'step-start' },
            // This is a complete tool call with output
            {
              type: 'dynamic-tool',
              toolName: 'maths',
              toolCallId: 'call_COMPLETE_456',
              state: 'output-available',
              input: { input: 123 },
              output: { result: '42.5' },
            },
            { type: 'text', text: 'The result is 42.5' },
          ],
        },
      ];

      // Convert UIMessages to LangChain BaseMessages
      const langchainMessages = await toBaseMessages(messagesWithOrphanedToolCall);

      console.log('Converted LangChain messages:');
      langchainMessages.forEach((msg, i) => {
        console.log(`${i}: ${msg.constructor.name}`, JSON.stringify(msg));
      });

      // Check the structure of converted messages
      // We expect to see the orphaned AIMessage with tool_calls but no following ToolMessage

      let foundOrphanedToolCall = false;
      for (let i = 0; i < langchainMessages.length; i++) {
        const msg = langchainMessages[i];
        if (msg instanceof AIMessage && msg.tool_calls && msg.tool_calls.length > 0) {
          // Check if this AIMessage's tool_calls are followed by ToolMessages
          for (const toolCall of msg.tool_calls) {
            const hasMatchingToolMessage = langchainMessages.slice(i + 1).some(
              (nextMsg) => nextMsg instanceof ToolMessage &&
                          (nextMsg as ToolMessage).tool_call_id === toolCall.id
            );

            if (!hasMatchingToolMessage) {
              console.log(`ORPHANED: AIMessage has tool_call ${toolCall.id} with no matching ToolMessage`);
              foundOrphanedToolCall = true;
            }
          }
        }
      }

      // This assertion FAILS - demonstrating the bug
      // Every AIMessage with tool_calls MUST be followed by ToolMessages for each call
      expect(
        foundOrphanedToolCall,
        'Found AIMessage with tool_calls that has no matching ToolMessage - this will cause OpenAI API errors!'
      ).toBe(false);
    });

    it('demonstrates the exact error from OpenAI/LangChain', async () => {
      // This is the minimal reproduction of the buggy message structure
      const buggyMessages: UIMessage[] = [
        {
          id: 'user_1',
          role: 'user',
          parts: [{ type: 'text', text: 'do maths with 123' }],
        },
        {
          id: 'assistant_1',
          role: 'assistant',
          parts: [
            // First step: orphaned tool call (from historical message being re-emitted)
            {
              type: 'dynamic-tool',
              toolName: 'maths',
              toolCallId: 'call_8xtoEZ2bDLCMkKhK1wQ1Y3XC', // Same ID as in the bug report
              state: 'input-available', // No output!
              input: { input: 123 },
            },
            { type: 'step-start' },
            // Second step: complete tool call (current request)
            {
              type: 'dynamic-tool',
              toolName: 'maths',
              toolCallId: 'call_MbGmUhDhn5qui6i7duFje8OC',
              state: 'output-available',
              input: { input: 123 },
              output: { result: '106.27' },
            },
            { type: 'text', text: 'The result is approximately 106.27.' },
          ],
        },
        {
          id: 'user_2',
          role: 'user',
          parts: [{ type: 'text', text: 'do it again' }],
        },
      ];

      const langchainMessages = await toBaseMessages(buggyMessages);

      // Count AIMessages with tool_calls vs ToolMessages
      const aiMessagesWithToolCalls = langchainMessages.filter(
        msg => msg instanceof AIMessage && (msg as AIMessage).tool_calls?.length
      );
      const toolMessages = langchainMessages.filter(msg => msg instanceof ToolMessage);

      // Extract all tool_call_ids from AIMessages
      const toolCallIds = new Set<string>();
      aiMessagesWithToolCalls.forEach(msg => {
        (msg as AIMessage).tool_calls?.forEach(tc => toolCallIds.add(tc.id!));
      });

      // Extract all tool_call_ids from ToolMessages
      const respondedToolCallIds = new Set<string>();
      toolMessages.forEach(msg => {
        respondedToolCallIds.add((msg as ToolMessage).tool_call_id);
      });

      // Find orphaned tool_call_ids
      const orphanedIds = [...toolCallIds].filter(id => !respondedToolCallIds.has(id));

      console.log('\n=== BUG REPRODUCTION ===');
      console.log('AIMessages with tool_calls:', aiMessagesWithToolCalls.length);
      console.log('ToolMessages:', toolMessages.length);
      console.log('Tool call IDs in AIMessages:', [...toolCallIds]);
      console.log('Tool call IDs in ToolMessages:', [...respondedToolCallIds]);
      console.log('ORPHANED tool call IDs:', orphanedIds);

      if (orphanedIds.length > 0) {
        console.log('\nThis would cause the error:');
        console.log(`400 An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. The following tool_call_ids did not have response messages: ${orphanedIds.join(', ')}`);
      }

      // This fails, proving the bug
      expect(orphanedIds).toHaveLength(0);
    });
  });

  /**
   * Control test: Verify correct behavior with properly formed messages
   */
  describe('Control: Correct behavior with complete tool calls', () => {

    it('should correctly convert UIMessages with complete tool calls', async () => {
      const correctMessages: UIMessage[] = [
        {
          id: 'user_1',
          role: 'user',
          parts: [{ type: 'text', text: 'do maths with 123' }],
        },
        {
          id: 'assistant_1',
          role: 'assistant',
          parts: [
            // Complete tool call with output
            {
              type: 'dynamic-tool',
              toolName: 'maths',
              toolCallId: 'call_COMPLETE_123',
              state: 'output-available',
              input: { input: 123 },
              output: { result: '15.5' },
            },
            { type: 'text', text: 'The result is 15.5' },
          ],
        },
      ];

      const langchainMessages = await toBaseMessages(correctMessages);

      // With correct messages, every AIMessage with tool_calls should have matching ToolMessages
      const aiMessagesWithToolCalls = langchainMessages.filter(
        msg => msg instanceof AIMessage && (msg as AIMessage).tool_calls?.length
      );
      const toolMessages = langchainMessages.filter(msg => msg instanceof ToolMessage);

      const toolCallIds = new Set<string>();
      aiMessagesWithToolCalls.forEach(msg => {
        (msg as AIMessage).tool_calls?.forEach(tc => toolCallIds.add(tc.id!));
      });

      const respondedToolCallIds = new Set<string>();
      toolMessages.forEach(msg => {
        respondedToolCallIds.add((msg as ToolMessage).tool_call_id);
      });

      const orphanedIds = [...toolCallIds].filter(id => !respondedToolCallIds.has(id));

      // This should pass - complete tool calls work correctly
      expect(orphanedIds).toHaveLength(0);
    });
  });
});
