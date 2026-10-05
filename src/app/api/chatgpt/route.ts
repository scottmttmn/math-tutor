import { getChatGPT } from '@/lib/chatgpt';
import { ChatGPTError } from '@/lib/siwc';
import type { ChatGPTStatus } from '@/types';

export const runtime = 'nodejs';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function currentStatus(): Promise<ChatGPTStatus> {
  const chatgpt = getChatGPT();
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

export async function GET() {
  try {
    return Response.json(await currentStatus());
  } catch (error) {
    return Response.json({ status: 'disconnected', sharing: false, error: errorMessage(error) } satisfies ChatGPTStatus);
  }
}

/** Body: { action: 'signIn' | 'cancel' | 'disconnect' }. signIn resolves once the browser sign-in finishes. */
export async function POST(request: Request) {
  const { action } = (await request.json()) as { action?: string };
  const chatgpt = getChatGPT();
  try {
    if (action === 'signIn') {
      await chatgpt.signIn({ reconsent: true });
    } else if (action === 'cancel') {
      chatgpt.cancelSignIn();
    } else if (action === 'disconnect') {
      await chatgpt.disconnect();
    } else {
      return Response.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    if (!(error instanceof ChatGPTError && error.code === 'cancelled')) {
      return Response.json({ ...(await currentStatus()), error: errorMessage(error) });
    }
  }
  return Response.json(await currentStatus());
}
