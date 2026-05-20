const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

function getGeminiApiKey(): string {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_AI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  return apiKey;
}

export async function generateGeminiContent<TResponse = unknown>(
  model: string,
  body: Record<string, unknown>,
): Promise<TResponse> {
  const apiKey = getGeminiApiKey();
  const url = `${GEMINI_API_BASE_URL}/models/${model}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errorBody.slice(0, 500)}`);
  }

  return (await res.json()) as TResponse;
}
