import { createUIMessageStreamResponse, UIMessage } from 'ai';
import { createAgent, tool, ToolRuntime } from 'langchain';
import { ChatOpenAI, tools } from '@langchain/openai';
import { toBaseMessages, toUIMessageStream } from '@ai-sdk/langchain';
import { z } from 'zod';
import fs from 'fs';

export const maxDuration = 60;

const model = new ChatOpenAI({
  model: 'gpt-4o',
  temperature: 0.7,
});

// Image generation tool configuration
const imageGenerationTool = tools.imageGeneration({
  size: '1024x1024',
  quality: 'high',
  outputFormat: 'png',
});

const mathsTool = tool(async ({ input }: { input: number }) => {
  return {
    result: `${Math.random() * input} is a random number times ${input}`,
  };
}, {
  name: 'maths',
  description: 'Use this tool to solve math problems. If the user says do maths, you should use this tool.',
  schema: z.object({
    input: z.number(),
  })
});

// Create a LangChain agent with tools
const agent = createAgent({
  model,
  tools: [mathsTool],
  systemPrompt: 'You are a creative AI artist assistant.',
});

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const langchainMessages = await toBaseMessages(messages);

  // write langchain messages to a file with a clear separator per turn
  fs.appendFileSync('langchain-messages.txt', '--------------------------------\n');
  fs.appendFileSync('langchain-messages.txt', 'User Message:\n' + JSON.stringify(messages.at(-1)?.parts.find(part => part.type === 'text')?.text) + '\n');
  fs.appendFileSync('langchain-messages.txt', langchainMessages.map(message => JSON.stringify(message)).join('\n') + '\n');
  fs.appendFileSync('langchain-messages.txt', '--------------------------------\n');
  const stream = await agent.stream(
    { messages: langchainMessages },
    { streamMode: ['values', 'messages'] },
  );

  return createUIMessageStreamResponse({
    stream: toUIMessageStream(stream),
  });
}