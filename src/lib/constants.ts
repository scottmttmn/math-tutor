// Where students see and cap how much of their ChatGPT plan this app uses.
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';
// Preferred default ChatGPT-plan model, matched against each model's slug and name (the plan
// lists newest first). Sol, not the lighter Luna: in the handwriting test Luna invented a whole
// page of work, and the tutor reads the student's handwriting on every request.
// Falls back to the first model the plan lists.
export const CHATGPT_DEFAULT_MODEL_PATTERN = /sol/i;

/**
 * One output cap for every provider. Models that think first (Claude, Gemini, ChatGPT plan models)
 * spend from it before they answer; the prompts keep the visible reply short, so this only stops a runaway.
 */
export const TUTOR_MAX_OUTPUT_TOKENS = 16_000;

// Minimum interval between tutor requests, measured from their start.
export const RATE_LIMIT_MS = 5 * 1000;

/** Shown when /api/tutor answers with something other than a reply stream (e.g. a page from a proxy). */
export const TUTOR_UNAVAILABLE = "The tutor didn't answer. Please try again.";
