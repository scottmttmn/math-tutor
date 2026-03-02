import Anthropic from '@anthropic-ai/sdk';
import type { TutorRequest } from '@/types';

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `You are a patient, encouraging math tutor helping a student work through problems.
You can see the student's handwritten work as an image. The problem they are working on is provided in the conversation.

RULES YOU MUST FOLLOW:

1. NEVER give the full solution or final answer. Your job is to guide, not solve.

2. When you first see the student's work:
   - Acknowledge what they have written so far
   - Identify where they are in the problem-solving process
   - If their work contains an error, do NOT point it out directly. Instead, ask a question that leads them to discover the error themselves.

3. Give hints in this order of increasing specificity:
   a. First, ask a clarifying question about their approach ("What method are you using here?" or "What do you think the next step should be?")
   b. If they are still stuck, give a conceptual hint ("Remember that when you move a term across the equals sign...")
   c. If they are still stuck, give a more specific procedural hint ("Try multiplying both sides by the denominator")
   d. NEVER go beyond a procedural hint. Do not compute the answer for them.

4. Keep responses SHORT -- 2 to 4 sentences maximum. Students learn better from brief, focused guidance than from long explanations.

5. Be encouraging. Acknowledge correct steps. Use phrases like "Good start", "You're on the right track", "Almost there".

6. If you cannot read the handwriting clearly, say so and ask the student to clarify the specific part you cannot read.

7. If the student's work is blank or nearly blank, ask them what they have tried so far and suggest where to begin conceptually.

8. Respond in plain text. Use standard math notation where needed (fractions as a/b, exponents as x^2, square roots as sqrt(x), etc.).`;

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('401') || message.includes('authentication') || message.includes('invalid x-api-key')) {
    return 'API key is missing or invalid. Add your ANTHROPIC_API_KEY to .env.local and restart the server.';
  }
  if (message.includes('429') || message.includes('rate_limit')) {
    return 'Rate limited by the API. Please wait a moment and try again.';
  }
  if (message.includes('overloaded')) {
    return 'The AI service is temporarily overloaded. Please try again shortly.';
  }
  if (message.includes('credit') || message.includes('billing') || message.includes('balance')) {
    return 'Your Anthropic API credit balance is too low. Please add credits at console.anthropic.com.';
  }
  return message;
}

export async function POST(request: Request) {
  try {
    const body: TutorRequest = await request.json();
    const { problemStatement, chatHistory, canvasImage } = body;

    // Build messages for Anthropic API
    const messages: Anthropic.MessageParam[] = [];

    // Add chat history (text only for previous turns)
    for (const msg of chatHistory) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content });
      } else {
        messages.push({ role: 'assistant', content: msg.content });
      }
    }

    // Build the latest user message with image if provided
    const userContent: Anthropic.ContentBlockParam[] = [];

    if (canvasImage) {
      userContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: canvasImage,
        },
      });
    }

    let textContent = '';
    if (problemStatement) {
      textContent += `The problem I'm working on: ${problemStatement}\n\n`;
    }
    textContent += canvasImage
      ? 'Here is my work so far. Can you give me a hint?'
      : 'Can you give me a hint on what to do next?';

    userContent.push({ type: 'text', text: textContent });

    messages.push({ role: 'user', content: userContent });

    // Ensure messages alternate properly (user, assistant, user, ...)
    // The Anthropic API requires alternating roles, so we need to handle this
    const cleanedMessages = cleanMessages(messages);

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: cleanedMessages,
    });

    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          stream.on('text', (text) => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'text_delta', content: text })}\n\n`)
            );
          });

          stream.on('error', (error) => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'error', error: friendlyError(error) })}\n\n`)
            );
            controller.close();
          });

          stream.on('end', () => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`)
            );
            controller.close();
          });
        } catch (err) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', error: friendlyError(err) })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    return new Response(friendlyError(error), { status: 500 });
  }
}

function cleanMessages(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  // Ensure the conversation starts with a user message and alternates
  const cleaned: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    // Skip empty assistant messages
    if (msg.role === 'assistant' && (!msg.content || msg.content === '')) continue;

    if (cleaned.length === 0) {
      if (msg.role === 'user') {
        cleaned.push(msg);
      }
      continue;
    }

    const lastRole = cleaned[cleaned.length - 1].role;
    if (msg.role === lastRole) {
      // Merge consecutive same-role messages
      if (msg.role === 'user') {
        const lastContent = typeof cleaned[cleaned.length - 1].content === 'string'
          ? cleaned[cleaned.length - 1].content as string
          : '';
        const newContent = typeof msg.content === 'string' ? msg.content : '';
        cleaned[cleaned.length - 1] = {
          role: 'user',
          content: lastContent + '\n' + newContent,
        };
      }
    } else {
      cleaned.push(msg);
    }
  }

  // Ensure it ends with a user message (the API call)
  // The last message we push should already be user since we add it last
  return cleaned;
}
