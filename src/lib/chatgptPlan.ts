import { ChatGPTError } from '@/lib/siwc';
import type { ChatGPTClient, ResponseContentPart, ResponseInputMessage } from '@/lib/siwc';
import { CHATGPT_USAGE_URL } from '@/lib/constants';
import type { ChatGPTAction, ChatGPTStatus, ModelConfig, TutorPlan } from '@/types';

// Sign in with ChatGPT for the app: the status Settings shows, its actions, and the tutor's
// reply on the plan. The server runs these with its client (src/lib/chatgpt.ts), the Android
// app with the one on the tablet (src/lib/chatgptDevice.ts).

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What Settings shows: the connection, and the plan's models once it can be used. */
export async function chatgptStatus(chatgpt: ChatGPTClient): Promise<ChatGPTStatus> {
  const session = await chatgpt.getSession();
  const status: ChatGPTStatus = {
    status: session.status,
    sharing: session.sharing,
    email: session.identity?.email,
    error: session.error?.message,
  };
  if (session.status === 'connected' && session.sharing) {
    try {
      status.models = await chatgpt.listModels();
    } catch (error) {
      status.error = errorMessage(error);
    }
  }
  return status;
}

/** Sign in (resolves once the browser sign-in finishes), cancel it, or sign out; then the status. */
export async function chatgptAction(chatgpt: ChatGPTClient, action: ChatGPTAction): Promise<ChatGPTStatus> {
  try {
    if (action === 'signIn') await chatgpt.signIn({ reconsent: true });
    else if (action === 'cancel') chatgpt.cancelSignIn();
    else await chatgpt.disconnect();
  } catch (error) {
    if (!(error instanceof ChatGPTError && error.code === 'cancelled')) {
      return { ...(await chatgptStatus(chatgpt)), error: errorMessage(error) };
    }
  }
  return chatgptStatus(chatgpt);
}

function friendlyChatGPTError(error: unknown): string {
  if (error instanceof ChatGPTError && error.code === 'subscription_sharing_unsupported_capability') {
    return 'Your ChatGPT plan connection does not accept images for this model. Try another model, or switch providers in Settings.';
  }
  if (error instanceof ChatGPTError && error.code === 'subscription_sharing_usage_limit_exceeded') {
    return `You've reached a ChatGPT usage limit, either for your plan or for this app. Check your usage and limits at ${CHATGPT_USAGE_URL}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Streams from the Responses API on the student's own ChatGPT plan (Sign in with ChatGPT). A client that can't be made is an error in the stream. */
export function streamChatGPTResponse(
  chatgpt: () => ChatGPTClient,
  modelConfig: ModelConfig,
  plan: TutorPlan,
  onFinish: () => void = () => {},
): ReadableStream {
  // Keep shared material ahead of changing memory/history. The ChatGPT-plan endpoint rejects
  // explicit cache controls, so preserve these message boundaries for automatic cache reuse.
  const input: ResponseInputMessage[] = [];
  const addReference = (content: ResponseContentPart[]) => {
    if (!content.length) return;
    input.push({ role: 'user', content });
  };
  if (plan.reference) addReference([{ type: 'input_text', text: plan.reference }]);
  const board = plan.board.map((part): ResponseContentPart => (
    part.type === 'image'
      ? { type: 'input_image', image_url: `data:image/png;base64,${part.data}` }
      : { type: 'input_text', text: part.text }
  ));
  if (board.length) addReference([{ type: 'input_text', text: 'Current board and problem for this question (earlier conversation may refer to older work):' }, ...board]);
  if (plan.profile) input.push({ role: 'user', content: plan.profile });
  input.push(...plan.history
    .filter((msg) => msg.content)
    .map((msg): ResponseInputMessage => ({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content })));
  input.push({ role: 'user', content: plan.question });

  const encoder = new TextEncoder();
  const abort = new AbortController();
  let cancelled = false;
  return new ReadableStream({
    async start(controller) {
      try {
        const { usage } = await chatgpt().streamResponse({
          model: modelConfig.model,
          instructions: plan.systemPrompt,
          input,
          maxOutputTokens: plan.maxTokens,
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
            encoder.encode(`data: ${JSON.stringify({ type: 'usage', usage: { ...usage, provider: 'chatgpt' } })}\n\n`)
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
