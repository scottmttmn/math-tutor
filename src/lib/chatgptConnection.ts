import type { ChatGPTAction, ChatGPTStatus } from '@/types';
import { TUTOR_DIRECT } from '@/lib/tutorRequest';

/**
 * Sign in with ChatGPT's status, or an action and then the status: from the server's
 * /api/chatgpt, or in the Android app from the client on the tablet.
 */
export async function chatgptRequest(action?: ChatGPTAction): Promise<ChatGPTStatus> {
  if (TUTOR_DIRECT) {
    const [{ getDeviceChatGPT }, { chatgptAction, chatgptStatus }] = await Promise.all([import('@/lib/chatgptDevice'), import('@/lib/chatgptPlan')]);
    return action ? chatgptAction(getDeviceChatGPT(), action) : chatgptStatus(getDeviceChatGPT());
  }
  const response = action
    ? await fetch('/api/chatgpt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
    : await fetch('/api/chatgpt');
  return response.json() as Promise<ChatGPTStatus>;
}
