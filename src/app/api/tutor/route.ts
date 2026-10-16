import { getChatGPT } from '@/lib/chatgpt';
import { streamChatGPTResponse } from '@/lib/chatgptPlan';
import type { TutorRequest } from '@/types';
import { createTutorRequestGate } from '@/lib/tutorRequestGate';
import { isGeminiEndpoint } from '@/lib/modelConfig';
import { planTutorRequest } from '@/lib/tutorPrompt';
import { friendlyError, streamAnthropicResponse, streamOpenAIResponse } from '@/lib/tutorProviders';

// The prompts live in tutorPrompt.ts and the API-key providers in tutorProviders.ts, shared with the
// Android app, and the ChatGPT plan in chatgptPlan.ts. This route adds the server's keys and the request gate.
const requestGate = createTutorRequestGate();

export async function POST(request: Request) {
  let release: (() => void) | undefined;
  try {
    const body: TutorRequest = await request.json();
    const { modelConfig } = body;
    const plan = planTutorRequest(body);

    const permit = requestGate.acquire();
    if (!permit.accepted) {
      return new Response(permit.message, {
        status: 429,
        headers: { 'Retry-After': String(permit.retryAfterSeconds), 'Cache-Control': 'no-store' },
      });
    }
    release = permit.release;

    let readableStream: ReadableStream;
    if (modelConfig.provider === 'chatgpt') {
      readableStream = streamChatGPTResponse(getChatGPT, modelConfig, plan, release);
    } else if (modelConfig.provider === 'openai-compatible') {
      const apiKey = isGeminiEndpoint(modelConfig.baseUrl)
        ? process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY
        : process.env.OPENAI_API_KEY;
      readableStream = streamOpenAIResponse(modelConfig, plan, { apiKey, source: 'server', onFinish: release });
    } else {
      readableStream = streamAnthropicResponse(modelConfig, plan, { apiKey: process.env.ANTHROPIC_API_KEY, source: 'server', onFinish: release });
    }

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    release?.();
    return new Response(friendlyError(error, 'server'), { status: 500 });
  }
}
