import { getChatGPT } from '@/lib/chatgpt';
import { ChatGPTError } from '@/lib/siwc';
import { CHATGPT_USAGE_URL } from '@/lib/constants';
import type { ResponseContentPart, ResponseInputMessage } from '@/lib/siwc';
import type { TutorRequest, ModelConfig, TutorPlan } from '@/types';
import { createTutorRequestGate } from '@/lib/tutorRequestGate';
import { isGeminiEndpoint } from '@/lib/modelConfig';
import { planTutorRequest } from '@/lib/tutorPrompt';
import { friendlyError, streamAnthropicResponse, streamOpenAIResponse } from '@/lib/tutorProviders';

// The prompts live in tutorPrompt.ts and the API-key providers in tutorProviders.ts, shared with the
// Android app. This route adds the server's keys, the request gate and the ChatGPT plan.
const requestGate = createTutorRequestGate();

function friendlyChatGPTError(error: unknown): string {
  if (error instanceof ChatGPTError && error.code === 'subscription_sharing_unsupported_capability') {
    return 'Your ChatGPT plan connection does not accept images for this model. Try another model, or switch providers in Settings.';
  }
  if (error instanceof ChatGPTError && error.code === 'subscription_sharing_usage_limit_exceeded') {
    return `You've reached a ChatGPT usage limit, either for your plan or for this app. Check your usage and limits at ${CHATGPT_USAGE_URL}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Streams from the Responses API on the student's own ChatGPT plan (Sign in with ChatGPT). */
function streamChatGPTResponse(
  modelConfig: ModelConfig,
  plan: TutorPlan,
  onFinish: () => void,
  maxOutputTokens?: number,
): ReadableStream {
  const input: ResponseInputMessage[] = [
    ...(plan.preface ? [{ role: 'user' as const, content: plan.preface }] : []),
    ...plan.history
      .filter((msg) => msg.content)
      .map((msg): ResponseInputMessage => ({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content })),
  ];

  const parts = plan.latest.map((part): ResponseContentPart => (
    part.type === 'image'
      ? { type: 'input_image', image_url: `data:image/png;base64,${part.data}` }
      : { type: 'input_text', text: part.text }
  ));
  input.push({ role: 'user', content: parts });

  const encoder = new TextEncoder();
  const abort = new AbortController();
  let cancelled = false;
  return new ReadableStream({
    async start(controller) {
      try {
        const { usage } = await getChatGPT().streamResponse({
          model: modelConfig.model,
          instructions: plan.systemPrompt,
          input,
          ...(maxOutputTokens ? { maxOutputTokens } : {}),
          signal: abort.signal,
          onDelta: (delta) => {
            if (cancelled) return;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'text_delta', content: delta })}\n\n`)
            );
          },
        });
        if (cancelled) return;
        if (usage) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'usage', usage })}\n\n`)
          );
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`)
        );
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ChatGPTError) {
          // Codes and field names only; never the request or response text.
          console.error('ChatGPT request failed', {
            code: err.code, status: err.status, param: err.param, requestId: err.requestId, shape: err.responseShape,
          });
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', error: friendlyChatGPTError(err) })}\n\n`)
        );
      } finally {
        onFinish();
      }
      controller.close();
    },
    // A reader that goes away (reload, navigation) frees the gate now, not when the upstream reply ends.
    cancel() { cancelled = true; abort.abort(); onFinish(); },
  });
}

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
      // Plan models reason before they answer, and the cap counts that too.
      readableStream = streamChatGPTResponse(modelConfig, plan, release, plan.isWriteUp ? plan.maxTokens * 4 : undefined);
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
