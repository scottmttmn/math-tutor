'use client';

import type { TokenUsage } from '@/types';
import { CHATGPT_USAGE_URL } from '@/lib/constants';

/** What one tutor request cost in tokens, under its reply (a chat message, a problem from the tutor). */
export default function UsageFooter({ usage }: { usage: TokenUsage }) {
  return (
    <div className="mt-1.5 pt-1.5 border-t border-gray-200 text-xs text-gray-500">
      <div>{(usage.inputTokens + usage.outputTokens).toLocaleString()} tokens this request</div>
      <div>
        {usage.inputTokens.toLocaleString()} input · {usage.outputTokens.toLocaleString()} output
        {usage.reasoningTokens !== undefined && <> (including {usage.reasoningTokens.toLocaleString()} reasoning)</>}
      </div>
      {usage.cachedInputTokens !== undefined && (
        <div>Input includes {usage.cachedInputTokens.toLocaleString()} cached tokens</div>
      )}
      {(usage.provider === undefined || usage.provider === 'chatgpt') && (
        <a href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-700">
          Manage ChatGPT usage
        </a>
      )}
    </div>
  );
}
