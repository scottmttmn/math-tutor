import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { ApiKeySource, ModelConfig, TokenUsage, TutorPlan, TutorStreamEvent } from '@/types';
import { isGeminiEndpoint } from '@/lib/modelConfig';
import { createGeminiFallback, isQuotaError } from '@/lib/geminiFallback';

// The API-key providers, streamed as the tutor's SSE events. The server route runs these with keys
// from .env.local; the Android app runs them in the WebView with keys saved on the tablet (`browser`).

const geminiFallback = createGeminiFallback();
const encoder = new TextEncoder();
const sse = (event: TutorStreamEvent) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

export interface ProviderOptions {
  /** Undefined when no key is set: the provider's own error then says so. */
  apiKey: string | undefined;
  source: ApiKeySource;
  /** Called once when the reply ends, fails or its reader goes away. */
  onFinish?: () => void;
}

/** Where to fix a key, in the words of the place it comes from. */
export function keyHint(source: ApiKeySource): string {
  return source === 'device' ? 'Check it in Settings → Tutor.' : 'Check your API key in .env.local and restart the server.';
}

export function friendlyError(error: unknown, source: ApiKeySource): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('401') || message.includes('authentication') || message.includes('invalid x-api-key')) {
    return `API key is missing or invalid. ${keyHint(source)}`;
  }
  if (message.includes('429') || message.includes('rate_limit')) {
    return 'Rate limited by the API. Please wait a moment and try again.';
  }
  if (message.includes('overloaded')) {
    return 'The AI service is temporarily overloaded. Please try again shortly.';
  }
  if (message.includes('credit') || message.includes('billing') || message.includes('balance')) {
    return 'Your API credit balance is too low. Please add credits to your account.';
  }
  // A browser fetch that can't reach the provider (offline, or a server that refuses the app's origin).
  if (source === 'device' && /failed to fetch|network/i.test(message)) {
    return 'Could not reach the AI service. Check the tablet is online, and for a custom server its address.';
  }
  return message;
}

function cleanMessages(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const cleaned: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'assistant' && (!msg.content || msg.content === '')) continue;

    if (cleaned.length === 0) {
      if (msg.role === 'user') {
        cleaned.push(msg);
      }
      continue;
    }

    const lastRole = cleaned[cleaned.length - 1].role;
    if (msg.role === lastRole) {
      if (msg.role === 'user') {
        const asBlocks = (content: Anthropic.MessageParam['content']): Anthropic.ContentBlockParam[] =>
          typeof content === 'string' ? [{ type: 'text', text: content }] : content;
        cleaned[cleaned.length - 1] = {
          role: 'user',
          content: [...asBlocks(cleaned[cleaned.length - 1].content), ...asBlocks(msg.content)],
        };
      }
    } else {
      cleaned.push(msg);
    }
  }

  return cleaned;
}

export function streamAnthropicResponse(modelConfig: ModelConfig, plan: TutorPlan, { apiKey, source, onFinish = () => {} }: ProviderOptions): ReadableStream {
  // The profile and book pages open the conversation, so every question on the board shares them as a cached prefix.
  const messages: Anthropic.MessageParam[] = plan.preface
    ? [{ role: 'user', content: [{ type: 'text', text: plan.preface, cache_control: { type: 'ephemeral' } }] }]
    : [];
  for (const msg of plan.history) {
    messages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content });
  }
  messages.push({
    role: 'user',
    content: plan.latest.map((part): Anthropic.ContentBlockParam => (
      part.type === 'image'
        ? { type: 'image', source: { type: 'base64', media_type: 'image/png', data: part.data } }
        : { type: 'text', text: part.text }
    )),
  });

  const anthropic = new Anthropic({ apiKey, ...(source === 'device' ? { dangerouslyAllowBrowser: true } : {}) });
  const stream = anthropic.messages.stream({
    model: modelConfig.model,
    max_tokens: plan.maxTokens,
    system: plan.systemPrompt,
    messages: cleanMessages(messages),
  });

  let cancelled = false;
  return new ReadableStream({
    async start(controller) {
      try {
        let stopReason: string | null | undefined;
        let reported: Anthropic.Usage | undefined;
        for await (const event of stream) {
          if (cancelled) break;
          if (event.type === 'message_start') {
            reported = { ...event.message.usage };
          } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            controller.enqueue(sse({ type: 'text_delta', content: event.delta.text }));
          } else if (event.type === 'message_delta') {
            stopReason = event.delta.stop_reason;
            // Delta counts are cumulative; missing/null fields keep their message_start values.
            if (reported) {
              reported.output_tokens = event.usage.output_tokens;
              reported.input_tokens = event.usage.input_tokens ?? reported.input_tokens;
              reported.cache_creation_input_tokens = event.usage.cache_creation_input_tokens ?? reported.cache_creation_input_tokens;
              reported.cache_read_input_tokens = event.usage.cache_read_input_tokens ?? reported.cache_read_input_tokens;
            }
          }
        }
        if (cancelled) return;
        if (reported) controller.enqueue(sse({ type: 'usage', usage: {
          inputTokens: reported.input_tokens + (reported.cache_creation_input_tokens ?? 0) + (reported.cache_read_input_tokens ?? 0),
          outputTokens: reported.output_tokens,
          provider: 'anthropic',
        } }));
        if (stopReason === 'max_tokens' || stopReason === 'model_context_window_exceeded') controller.enqueue(sse({ type: 'error', error: 'The tutor ran out of room before finishing its reply. Please ask again.' }));
        else if (stopReason === 'refusal') controller.enqueue(sse({ type: 'error', error: 'The model declined to answer this one. Try rephrasing, or another model in Settings.' }));
        else controller.enqueue(sse({ type: 'message_stop' }));
      } catch (err) {
        if (!cancelled) controller.enqueue(sse({ type: 'error', error: friendlyError(err, source) }));
      } finally {
        onFinish();
        if (!cancelled) controller.close();
      }
    },
    cancel() { cancelled = true; stream.abort(); },
  });
}

/** The Gemini key is the only one a request can't go without (Ollama needs none). */
export function missingGeminiKey(source: ApiKeySource): string {
  return source === 'device'
    ? 'Add your Gemini API key in Settings → Tutor.'
    : 'Gemini API key is missing. Add GEMINI_API_KEY to .env.local and restart the server.';
}

/** Standard compatible usage, or Groq's usage on older streaming responses. */
function compatibleUsage(chunk: unknown): TokenUsage | undefined {
  if (!chunk || typeof chunk !== 'object') return;
  let reported = 'usage' in chunk ? chunk.usage : undefined;
  if (!reported && 'x_groq' in chunk && chunk.x_groq && typeof chunk.x_groq === 'object') {
    reported = 'usage' in chunk.x_groq ? chunk.x_groq.usage : undefined;
  }
  if (!reported || typeof reported !== 'object' || !('prompt_tokens' in reported) || !('completion_tokens' in reported)
    || typeof reported.prompt_tokens !== 'number' || typeof reported.completion_tokens !== 'number') return;
  const details = 'completion_tokens_details' in reported ? reported.completion_tokens_details : undefined;
  const reasoning = details && typeof details === 'object' && 'reasoning_tokens' in details ? details.reasoning_tokens : undefined;
  return {
    inputTokens: reported.prompt_tokens,
    outputTokens: reported.completion_tokens,
    ...(typeof reasoning === 'number' ? { reasoningTokens: reasoning } : {}),
    provider: 'openai-compatible',
  };
}

/** A custom server may support chat streaming but reject the optional usage request. */
function rejectsStreamUsage(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('status' in error) || ![400, 422].includes(Number(error.status))) return false;
  return error instanceof Error && /stream_options|include_usage/i.test(error.message)
    && /unsupported|not supported|unknown|unrecognized|not allowed|extra inputs|not permitted/i.test(error.message);
}

export function streamOpenAIResponse(modelConfig: ModelConfig, plan: TutorPlan, { apiKey, source, onFinish = () => {} }: ProviderOptions): ReadableStream {
  const isGemini = isGeminiEndpoint(modelConfig.baseUrl);
  if (isGemini && !apiKey) throw new Error(missingGeminiKey(source));
  const openai = new OpenAI({
    apiKey: apiKey || 'ollama',
    baseURL: modelConfig.baseUrl || 'https://api.openai.com/v1',
    ...(isGemini ? { maxRetries: 0 } : {}),
    ...(source === 'device' ? { dangerouslyAllowBrowser: true } : {}),
  });

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: plan.systemPrompt },
  ];
  if (plan.preface) messages.push({ role: 'user', content: plan.preface });
  for (const msg of plan.history) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.content });
    } else {
      messages.push({ role: 'assistant', content: msg.content });
    }
  }
  messages.push({
    role: 'user',
    content: plan.latest.map((part): OpenAI.ChatCompletionContentPart => (
      part.type === 'image'
        ? { type: 'image_url', image_url: { url: `data:image/png;base64,${part.data}` } }
        : { type: 'text', text: part.text }
    )),
  });

  const abort = new AbortController();
  let cancelled = false;
  return new ReadableStream({
    async start(controller) {
      try {
        const models = isGemini ? geminiFallback.candidates(modelConfig.model) : [modelConfig.model];
        if (!models.length) throw new Error('Gemini quota is exhausted for the available models. Check your limits in Google AI Studio or try again later.');
        let emittedText = false;
        for (let index = 0; index < models.length; index++) {
          const model = models[index];
          try {
            const request = {
              model,
              max_tokens: plan.maxTokens,
              ...(isGemini ? { reasoning_effort: 'low' as const } : {}),
              messages,
              stream: true as const,
            };
            const stream = await openai.chat.completions.create({ ...request, stream_options: { include_usage: true } }, { signal: abort.signal })
              .catch((error: unknown) => {
                if (!rejectsStreamUsage(error)) throw error;
                return openai.chat.completions.create(request, { signal: abort.signal });
              });
            let usage: TokenUsage | undefined;
            for await (const chunk of stream) {
              if (cancelled) break;
              usage = compatibleUsage(chunk) ?? usage;
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) {
                if (!emittedText && model !== modelConfig.model) {
                  controller.enqueue(sse({ type: 'model', model }));
                }
                emittedText = true;
                controller.enqueue(sse({ type: 'text_delta', content: delta }));
              }
            }
            if (!cancelled && usage) controller.enqueue(sse({ type: 'usage', usage }));
            break;
          } catch (error) {
            if (!isGemini || cancelled || emittedText || !isQuotaError(error)) throw error;
            geminiFallback.exhausted(model, error);
            if (index === models.length - 1) throw new Error('Gemini quota is exhausted for the available models. Check your limits in Google AI Studio or try again later.');
          }
        }

        if (!cancelled) controller.enqueue(sse({ type: 'message_stop' }));
      } catch (err) {
        if (!cancelled) controller.enqueue(sse({ type: 'error', error: friendlyError(err, source) }));
      } finally {
        onFinish();
        if (!cancelled) controller.close();
      }
    },
    cancel() { cancelled = true; abort.abort(); },
  });
}
