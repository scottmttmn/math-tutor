import { getChatGPT } from '@/lib/chatgpt';
import { CHATGPT_DEFAULT_MODEL_PATTERN } from '@/lib/constants';
import { ChatGPTError } from '@/lib/siwc';
import type { TranscribeRequest, TranscribeResponse } from '@/types';

export const runtime = 'nodejs';

/**
 * Transcribes one image with the student's ChatGPT plan. Used by the handwriting test
 * (`npm run handwriting` with a chatgpt: model), which can't sign in itself because the
 * plan's tokens live in this server process. `model` is a slug or a loose name ("luna");
 * without one it is the app's default plan model.
 */
export async function POST(request: Request) {
  const { image, prompt, model } = (await request.json()) as Partial<TranscribeRequest>;
  if (!image || !prompt) return Response.json({ error: 'image and prompt are required' }, { status: 400 });
  const chatgpt = getChatGPT();
  let slug = model;
  let partial = '';
  try {
    const session = await chatgpt.getSession();
    if (session.status !== 'connected' || !session.sharing) {
      return Response.json({ error: 'Sign in with ChatGPT in the app settings first.' }, { status: 401 });
    }
    const models = await chatgpt.listModels();
    // A slug, or a name as people say it ("sol 6.1"): every word of it must appear in the model's
    // slug or name, in any order, so sol-6.1 finds gpt-6.1-sol. The plan lists newest first.
    const words = (text: string) => text.toLowerCase().split(/[\s_-]+/).filter(Boolean);
    const chosen = model
      ? models.find((m) => m.slug === model)
        ?? models.find((m) => words(model).every((word) => words(`${m.slug} ${m.displayName}`).includes(word)))
      : models.find((m) => CHATGPT_DEFAULT_MODEL_PATTERN.test(`${m.slug} ${m.displayName}`)) ?? models[0];
    if (!chosen) {
      const listed = models.map((m) => m.slug).join(', ') || 'none';
      return Response.json({ error: `Your ChatGPT plan has no model matching "${model ?? ''}" (it lists: ${listed}).` }, { status: 400 });
    }
    slug = chosen.slug;
    const { text } = await chatgpt.streamResponse({
      model: slug,
      onDelta: (delta) => { partial += delta; },
      input: [{ role: 'user', content: [
        { type: 'input_image', image_url: `data:image/png;base64,${image}` },
        { type: 'input_text', text: prompt },
      ] }],
    });
    return Response.json({ text, model: slug, cutOff: false } satisfies TranscribeResponse);
  } catch (error) {
    // The reply stopped early: score what arrived and flag it, as for other providers.
    if (error instanceof ChatGPTError && error.code === 'response_incomplete') {
      return Response.json({ text: partial, model: slug ?? '', cutOff: true } satisfies TranscribeResponse);
    }
    // Pass a rate limit through as 429 (with the SDK's code) so the handwriting test can wait it out.
    const limited = error instanceof ChatGPTError && error.status === 429;
    return Response.json(
      { error: error instanceof Error ? error.message : String(error), code: error instanceof ChatGPTError ? error.code : undefined },
      { status: limited ? 429 : 502 },
    );
  }
}
