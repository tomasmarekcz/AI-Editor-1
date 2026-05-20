import { generateGeminiContent } from '@/lib/geminiApi';

const GEMINI_MODEL = 'gemini-2.5-flash-lite';

async function callGemini(systemPrompt: string, userContent: string): Promise<string> {
  const data = await generateGeminiContent<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  }>(GEMINI_MODEL, {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userContent }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.4,
    },
  });
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
}

const SYSTEM_PROMPT = `You are an audio script formatter for social media videos.
Your task: take an array of script segments and reformat each one so it sounds exciting and engaging when spoken aloud by a TTS voice.

FORMATTING TOOLS — apply these where they make sense:
- Use ... when you want a dramatic pause, suspense, tension, or reveal.
- Use a line break when starting a new strong thought or changing rhythm.
- Use CAPS only for the most important impact word in a sentence (one per sentence max).
- Use short lines for punchy delivery.
- Use commas for natural spoken rhythm.
- Use question marks when creating curiosity.
- Use exclamation marks only for strong excitement.

CRITICAL RULES:
- Do NOT add or remove any words from the original text.
- Do NOT change the meaning or content.
- Only add/change punctuation and capitalise individual words for emphasis.
- Keep all original words in their original language and order.
- Return ONLY a valid JSON object in this exact shape: {"segments": ["enhanced text 1", "enhanced text 2", ...]}
- The output array must have the same number of items as the input array, in the same order.`;

export async function enhanceScriptForAudio(texts: string[]): Promise<string[]> {
  if (!texts.length) return texts;

  try {
    const raw = await callGemini(
      SYSTEM_PROMPT,
      JSON.stringify({ segments: texts }),
    );

    const parsed = JSON.parse(raw) as { segments?: string[] };
    const enhanced = parsed.segments;

    if (!Array.isArray(enhanced) || enhanced.length !== texts.length) {
      console.warn('[enhanceScriptForAudio] unexpected response shape, using originals');
      return texts;
    }

    return enhanced.map((e, i) => {
      if (typeof e !== 'string' || e.trim().length < texts[i].length * 0.5) {
        return texts[i];
      }
      return e;
    });
  } catch (err) {
    console.error('[enhanceScriptForAudio]', err);
    return texts;
  }
}
