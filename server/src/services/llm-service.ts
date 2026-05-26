import { request } from 'undici';

export interface GeneratedScript {
  title: string;
  prompt: string;
  duration: number;
}

export async function generateScripts(params: {
  persona: string;
  refImageUrl: string;
  duration: number;
  count: number;
}): Promise<GeneratedScript[]> {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    throw new Error('GROK_API_KEY environment variable is not configured');
  }
  
  const systemPrompt = `You are a professional AI video scriptwriter. Your task is to generate creative, highly attractive, and sensually alluring video prompts based on the character persona and reference image. 
The target model is an R2V (Reference-to-Video) model, meaning the reference image will be used as the visual anchor.
The prompts must emphasize the character's physical beauty, charm, and seductive allure. 

Focus heavily on the following aspects:
1. Alluring or revealing attire: Describe form-fitting outfits, off-shoulder cuts, low back dresses, thigh-high slits, translucent/sheer fabrics, wet garments, or attractive swimwear that fits the scene.
2. Seductive movements and poses: Describe seductive glances at the camera, alluring looks, running hands through hair, graceful body stretching, walking slowly while swaying hips, or turning around to reveal curves.
3. Cinematic atmosphere and lighting: Emphasize a sensual or romantic mood with warm lighting, glowing backlights, wet skin, mist, neon hues, shallow depth of field, and slow-motion camera movements.
4. Compliance & Safe Edge: Avoid explicit NSFW words (like "nude", "naked", "breasts", "vulgar", "sex") to bypass the safety filters of AI video generation engines. Keep the language highly suggestive, sensual, and stunningly gorgeous, right at the borderline of 18+.

All generated prompts must be in English.

You MUST respond strictly in a raw JSON array format, containing NO markdown formatting (e.g. do NOT wrap with \`\`\`json).
Each element in the array must be an object with these exact keys:
- "title": A short Chinese summary of the scene/story.
- "prompt": The highly descriptive English prompt for video generation (must include reference to the character, describing actions, attire, environment, etc. aligned with the persona, ref image, and the sensual theme).
- "duration": The video duration in seconds (must be ${params.duration}).`;

  const userPrompt = `Character Persona: ${params.persona}
Reference Image URL: ${params.refImageUrl}
Requested video count: ${params.count}
Please generate ${params.count} different scenes. Ensure each scene heavily emphasizes the character's sensual charm, beauty, and seductive allure. Create distinct plots and highly detailed camera motion.`;

  const res = await request('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'grok-4.3',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
    }),
  });

  if (res.statusCode < 200 || res.statusCode >= 300) {
    const text = await res.body.text();
    throw new Error(`Grok API returned HTTP ${res.statusCode}: ${text}`);
  }

  const data = (await res.body.json()) as any;
  const rawText = data?.choices?.[0]?.message?.content?.trim() || '';
  
  // 清洗可能含有的 markdown 包裹
  let cleanText = rawText;
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  }

  try {
    const parsed = JSON.parse(cleanText);
    if (!Array.isArray(parsed)) {
      throw new Error('Response is not a JSON array');
    }
    return parsed as GeneratedScript[];
  } catch (err) {
    console.error('Failed to parse Grok output:', rawText);
    throw new Error('Failed to parse Grok model output into a valid script list');
  }
}
