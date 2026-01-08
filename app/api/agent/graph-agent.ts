import { StateGraph, MessagesAnnotation, START, END, interrupt, MemorySaver } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { z } from 'zod';

type ChatState = typeof MessagesAnnotation.State;

const model = new ChatOpenAI({
  model: 'gpt-4o',
  temperature: 0.7,
});

const mathsTool = tool(
  async ({ input }: { input: number }) => {
    return `${Math.random() * input} is a random number times ${input}`;
  },
  {
    name: 'maths',
    description: 'Use this tool to solve math problems. If the user says do maths, you should use this tool.',
    schema: z.object({
      input: z.number(),
    }),
  }
);

const moveMoneyTool = tool(
  async ({ amount, recipient }: { amount: number; recipient: string }) => {
    return `Successfully transferred $${amount.toLocaleString()} to ${recipient}. Transaction ID: TXN-${Date.now()}`;
  },
  {
    name: 'moveMoney',
    description: 'Transfer money to a recipient. Use this when the user wants to send or transfer money.',
    schema: z.object({
      amount: z.number().describe('The amount of money to transfer in dollars'),
      recipient: z.string().describe('The name or account of the recipient'),
    }),
  }
);

const tools = [mathsTool, moveMoneyTool];
const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));
const modelWithTools = model.bindTools(tools);

async function callModel(state: ChatState) {
  const response = await modelWithTools.invoke(state.messages);
  return { messages: [response] };
}

async function executeTools(state: ChatState) {
  const lastMessage = state.messages.at(-1);
  if (!lastMessage || !AIMessage.isInstance(lastMessage) || !lastMessage.tool_calls?.length) {
    return { messages: [] };
  }

  const toolMessages: ToolMessage[] = [];

  for (const tc of lastMessage.tool_calls) {
    const toolDef = toolsByName[tc.name];

    // Always require approval for moveMoney
    if (tc.name === 'moveMoney') {
      const args = tc.args as { amount: number; recipient: string };
      // Interrupt for human approval - format expected by @ai-sdk/langchain
      const approval = interrupt({
        actionRequests: [{
          id: tc.id,
          name: tc.name,
          args: args,
        }],
      });

      // If denied, return denial message
      if (!approval?.approved) {
        toolMessages.push(new ToolMessage({
          content: `Transfer denied by user: ${approval?.reason || 'No reason provided'}`,
          tool_call_id: tc.id ?? "",
          name: tc.name,
        }));
        continue;
      }
    }

    // Execute the tool
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (toolDef as any).invoke(tc.args);
    toolMessages.push(new ToolMessage({
      content: typeof result === 'string' ? result : JSON.stringify(result),
      tool_call_id: tc.id ?? "",
      name: tc.name,
    }));
  }

  return { messages: toolMessages };
}

function shouldContinue(state: ChatState) {
  const lastMessage = state.messages.at(-1);
  if (lastMessage && AIMessage.isInstance(lastMessage) && lastMessage.tool_calls?.length) {
    return 'executeTools';
  }
  return END;
}

const workflow = new StateGraph(MessagesAnnotation)
  .addNode('callLlm', callModel)
  .addNode('executeTools', executeTools)
  .addEdge(START, 'callLlm')
  .addConditionalEdges('callLlm', shouldContinue)
  .addEdge('executeTools', 'callLlm');

const checkpointer = new MemorySaver();

export const graphAgent = workflow.compile({ checkpointer });
