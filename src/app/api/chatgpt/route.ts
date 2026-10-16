import { getChatGPT } from '@/lib/chatgpt';
import { chatgptAction, chatgptStatus } from '@/lib/chatgptPlan';
import type { ChatGPTAction, ChatGPTStatus } from '@/types';

export const runtime = 'nodejs';

const ACTIONS: ChatGPTAction[] = ['signIn', 'cancel', 'disconnect'];

export async function GET() {
  try {
    return Response.json(await chatgptStatus(getChatGPT()));
  } catch (error) {
    return Response.json({ status: 'disconnected', sharing: false, error: error instanceof Error ? error.message : String(error) } satisfies ChatGPTStatus);
  }
}

/** Body: { action: 'signIn' | 'cancel' | 'disconnect' }. signIn resolves once the browser sign-in finishes. */
export async function POST(request: Request) {
  const { action } = (await request.json()) as { action?: ChatGPTAction };
  if (!action || !ACTIONS.includes(action)) return Response.json({ error: 'Unknown action' }, { status: 400 });
  return Response.json(await chatgptAction(getChatGPT(), action));
}
