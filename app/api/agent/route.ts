import { createUIMessageStreamResponse, UIMessage } from 'ai';
import { toBaseMessages, toUIMessageStream } from '@ai-sdk/langchain';
import { Command } from '@langchain/langgraph';
import { graphAgent } from './graph-agent';

export const maxDuration = 60;

// Extract approval responses from UI messages
function extractApprovalResponses(messages: UIMessage[]): Array<{ id: string; approved: boolean; reason?: string }> {
  const approvals: Array<{ id: string; approved: boolean; reason?: string }> = [];
  for (const msg of messages) {
    for (const part of msg.parts) {
      const partAny = part as unknown as {
        type: string;
        state?: string;
        approval?: { id: string; approved?: boolean; reason?: string };
      };
      // Check for dynamic-tool with approval-responded state
      if (partAny.type === 'dynamic-tool' && partAny.state === 'approval-responded' && partAny.approval) {
        approvals.push({
          id: partAny.approval.id,
          approved: partAny.approval.approved ?? false,
          reason: partAny.approval.reason,
        });
      }
    }
  }
  return approvals;
}

export async function POST(req: Request) {
  const { messages, threadId }: { messages: UIMessage[]; threadId?: string } = await req.json();

  // Debug: log all message parts
  console.log('=== Incoming messages ===');
  for (const msg of messages) {
    console.log('Message role:', msg.role);
    for (const part of msg.parts) {
      console.log('  Part type:', part.type, JSON.stringify(part).slice(0, 200));
    }
  }

  // Use provided threadId or generate a new one for fresh conversations
  const thread_id = threadId || `thread-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  console.log('Thread ID:', thread_id);

  // Check for approval responses
  const approvalResponses = extractApprovalResponses(messages);
  console.log('Approval responses found:', approvalResponses);

  if (approvalResponses.length > 0) {
    // Resume from interrupt with approval
    const approval = approvalResponses[0]; // Handle first approval
    console.log('Resuming with approval:', approval);

    const stream = await graphAgent.stream(
      new Command({ resume: { approved: approval.approved, reason: approval.reason } }),
      {
        streamMode: ['updates', 'messages', 'values'],
        configurable: { thread_id },
      },
    );

    return createUIMessageStreamResponse({
      stream: toUIMessageStream(stream),
    });
  }

  // Fresh conversation - convert messages and start
  const langchainMessages = await toBaseMessages(messages);

  const stream = await graphAgent.stream(
    { messages: langchainMessages },
    {
      streamMode: ['updates', 'messages', 'values'],
      configurable: { thread_id },
    },
  );

  return createUIMessageStreamResponse({
    stream: toUIMessageStream(stream),
  });
}