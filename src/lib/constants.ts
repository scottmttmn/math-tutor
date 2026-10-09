// Where students see and cap how much of their ChatGPT plan this app uses.
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';
// Preferred default ChatGPT-plan model, matched against each model's slug and name (the plan
// lists newest first). Sol, not the lighter Luna: in the handwriting test Luna invented a whole
// page of work, and the tutor reads the student's handwriting on every request.
// Falls back to the first model the plan lists.
export const CHATGPT_DEFAULT_MODEL_PATTERN = /sol/i;

// Minimum interval between tutor requests, measured from their start.
export const RATE_LIMIT_MS = 5 * 1000;
