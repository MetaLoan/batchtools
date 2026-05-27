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
  scenePreference?: string;
}): Promise<GeneratedScript[]> {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    throw new Error('GROK_API_KEY environment variable is not configured');
  }
  
  const systemPrompt = `You are a professional AI video scriptwriter. Your task is to generate creative, highly attractive, and sensually alluring video prompts based on the character persona and reference image. 
The target model is an R2V (Reference-to-Video) model, meaning the reference image will be used as the visual anchor.
The prompts must emphasize the character's physical beauty, charm, and seductive allure. 

Focus heavily on highly imaginative, suggestive, and psychologically enticing scenarios (often referred to as "sensual teasing" or "suggestive tension" — the art of subtle suggestion rather than direct exposure, capturing desire through micro-details).

Focus heavily on the following aspects:
1. UGC-style and Handheld Realism (网感与真实生活化摄影感): The generated video must NOT look like a high-budget studio setup, 3D render, cartoon, or clean plastic photoshoot. It should feel like a real-life video shot from a regular person's perspective (Vlog/POV style). Explicitly specify handheld smartphone capture with natural micro-shakes, organic camera jitters, and natural motion blur. Describe casual real-world locations (like a messy bedroom, an elevator, a real outdoor street corner, a kitchen, a hotel balcony, or a poolside) with natural ambient lighting (afternoon window light, domestic lamps, neon ambient lights, or streetlights) instead of artificial studio spotlights.
2. Anti-AI Plastic Effect & High Realism Textures (去AI化材质与皮肤纹理细节): To prevent the rubbery/plastic AI skin appearance, explicitly append highly realistic photographic quality tags to the prompts. Specify "visible skin pores" (清晰皮肤毛孔), "natural skin texture" (自然皮肤纹理), "fine facial lines" (细微面部纹路), "individual hair strands" (丝丝缕缕发丝), and "photorealistic skin imperfections" (写实皮肤瑕疵). Use cinema-grade photography keywords such as "shot on 35mm lens", "cinematic film grain" (电影胶片颗粒), "shallow depth of field" (浅景深), "soft diffused natural lighting", "golden hour", "high contrast shadows", and "photorealistic quality".
3. Reference Image face-only rule: Explicitly instruct the video model to ONLY extract and maintain the facial features (face structure, eyes, hairstyle/color, expression) from the reference image for face consistency. The clothing and attire in the reference image should be completely ignored, allowing you to freely describe any creative, seductive, or alluring garments you choose.
4. Suggestive details and Micro-actions: Describe subtle, high-tension actions. E.g., slowly biting a lower lip, running a finger gently along the collarbone, pulling a glove off slowly with teeth, adjusting a shoulder strap, fingers slowly unbuttoning or untying a ribbon, water droplets slowly sliding down the neck, slightly parted lips, or looking up suggestively from under long eyelashes.
5. Clinging or suggestive attire: Describe creative and alluring clothing freely (do NOT limit to the reference image attire). Describe wet-look clothing clinging to the skin, slightly loose collars revealing shoulders, translucent/sheer overlays that hint at the contours underneath, silk/satin fabrics draping over curves, thigh-high stockings, or elegant high-slits revealing leg curves upon movement.
6. Intimate gazes and interactive poses: Direct, lingering glances at the camera as if looking into the viewer's eyes, a playful/mysterious smile, slow body stretching, leaning forward towards the camera, or lying back on a soft surface with an inviting posture.
7. Seductive & Voyeuristic camera angles ("猥琐"视角/窥视感镜头): Design highly suggestive, intimate camera angles that leave room for sexual fantasy. Describe slow upward pans (e.g., from the ankles up the calves and thighs to the hips), low-angle shots looking up to highlight body curves under clothing, slow panning tracking shots centered on highly attractive body parts (e.g., collarbone, neck, waist, hips, or lips), or a camera style that acts as a hidden, intimate observer's gaze.
8. Compliance & Safe Edge: Avoid explicit NSFW words (like "nude", "naked", "breasts", "vulgar", "sex") to bypass the safety filters of AI video generation engines. Keep the language highly suggestive, sensual, and stunningly gorgeous, right at the borderline of 18+.
9. NO Talking or Speech (禁止开口说话): The character in the video must NOT talk, speak, mouth words, or make any vocal dialogue. They should only perform silent physical movements, poses, and facial expressions (like smiling, winking, biting lip, looking at camera). The prompt should focus entirely on visual motion and actions without mentioning any dialogue or speech.

All generated prompts must be in English.

You MUST respond strictly in a raw JSON array format, containing NO markdown formatting (e.g. do NOT wrap with \`\`\`json).
Each element in the array must be an object with these exact keys:
- "title": A short Chinese summary of the scene/story.
- "prompt": The highly descriptive English prompt for video generation. It must merge the character description, environment details, camera language, and the realism/anti-AI tags specified above (e.g. ending with "handheld camera, natural skin pores, 35mm film grain, cinematic soft side lighting").
- "duration": The video duration in seconds (must be ${params.duration}).`;

  let userPrompt = `Character Persona: ${params.persona}
Reference Image URL: ${params.refImageUrl}
Requested video count: ${params.count}
Please generate ${params.count} different scenes. Ensure each scene heavily emphasizes the character's sensual charm, beauty, and seductive allure. Create distinct plots and highly detailed camera motion.`;

  if (params.scenePreference && params.scenePreference.trim()) {
    userPrompt += `\n\nCRITICAL DIRECTIVE - Scene & Style Preference (分镜与风格偏好强引导): ${params.scenePreference}
You MUST strictly follow and incorporate this style preference into the generated actions, environments, camera motions, and attire details. Make it a central guiding theme for the prompts.`;
  }

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

export async function polishEditPrompt(params: {
  stylePrompt: string;
  persona: string;
}): Promise<string> {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    throw new Error('GROK_API_KEY environment variable is not configured');
  }

  const systemPrompt = `You are a professional video edit assistant.
The user wants to edit a video by replacing the character face/style with a reference image while applying a specific edit style and keeping the persona.
Your task is to polish the edit style prompt into a highly descriptive, professional prompt for Wan 2.7 Video Edit.
Specify the modifications clearly:
- Define the face matching the reference image.
- Describe how the character should look and dress based on the persona.
- Specify the visual style, lighting, and camera qualities of the edits.
Do NOT change the motion or core composition of the original video.
Keep the prompt in English, under 120 words.
Output only the raw prompt text, no markdown or extra conversational text.`;

  const userPrompt = `Edit Style: ${params.stylePrompt}
Character Persona: ${params.persona}`;

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
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

export async function analyzeVideoKeyframes(params: {
  imageUrls: string[];
  videoTitle: string;
}): Promise<string> {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    throw new Error('GROK_API_KEY environment variable is not configured');
  }

  const systemPrompt = `You are a professional video analysis assistant.
We have extracted 3 keyframes (from the beginning, middle, and end) of a short video.
Your task is to analyze these keyframes and write a highly descriptive video script prompt for a Reference-to-Video (R2V) generation model.

The R2V model will animate a target character using a reference image. 
Describe the scene composition, lighting, environment, and motion cues based on the keyframes and the original video title. 
Your output prompt should focus on the cinematic trajectory, camera angles, and action sequences.

Do NOT include target character details or clothes. Focus on the core actions, background, and movement.
Keep the description in English, under 120 words.
Output only the raw prompt text, no markdown or extra conversational text.`;

  const content: any[] = [
    { type: 'text', text: `Original Video Title: ${params.videoTitle}. Here are the 3 keyframes from the video:` }
  ];

  for (const url of params.imageUrls) {
    content.push({
      type: 'image_url',
      image_url: { url }
    });
  }

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
        { role: 'user', content }
      ],
      temperature: 0.7,
    }),
  });

  if (res.statusCode < 200 || res.statusCode >= 300) {
    const text = await res.body.text();
    throw new Error(`Grok API returned HTTP ${res.statusCode}: ${text}`);
  }

  const data = (await res.body.json()) as any;
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

