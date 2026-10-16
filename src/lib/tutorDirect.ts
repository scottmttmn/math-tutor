import type { TutorRequest } from '@/types';
import { planTutorRequest } from '@/lib/tutorPrompt';
import { missingGeminiKey, streamAnthropicResponse, streamOpenAIResponse } from '@/lib/tutorProviders';
import { deviceKeyName, getDeviceKey } from '@/lib/deviceKeys';

/**
 * The Android app has no server, so it calls the provider from the tablet, with the key saved in
 * Settings or the ChatGPT plan signed in there, and answers with the same SSE stream /api/tutor sends. The five-second spacing is the
 * browser's own (useRateLimit), as there is no server gate.
 */
export async function directTutorResponse(body: TutorRequest): Promise<Response> {
  const { modelConfig } = body;
  if (modelConfig.provider === 'chatgpt') {
    const [{ getDeviceChatGPT }, { streamChatGPTResponse }] = await Promise.all([import('@/lib/chatgptDevice'), import('@/lib/chatgptPlan')]);
    return new Response(streamChatGPTResponse(getDeviceChatGPT, modelConfig, planTutorRequest(body)), { headers: { 'Content-Type': 'text/event-stream' } });
  }
  const name = deviceKeyName(modelConfig);
  if (!name) throw new Error('Pick a provider in Settings → Tutor.');
  const apiKey = await getDeviceKey(name);
  if (!apiKey && name === 'anthropic') throw new Error('Add your Anthropic API key in Settings → Tutor.');
  if (!apiKey && name === 'gemini') throw new Error(missingGeminiKey('device'));
  const plan = planTutorRequest(body);
  const stream = modelConfig.provider === 'anthropic'
    ? streamAnthropicResponse(modelConfig, plan, { apiKey, source: 'device' })
    : streamOpenAIResponse(modelConfig, plan, { apiKey, source: 'device' });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}
