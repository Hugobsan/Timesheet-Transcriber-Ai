

import { GoogleGenAI } from "@google/genai";

interface TranscribeImageParams {
  apiKey: string;
  systemPrompt: string;
  temperature: number;
  model: string;
  image: {
    data: string; // base64 string
    mimeType: string;
  };
}

export const transcribeImage = async ({
  apiKey,
  systemPrompt,
  temperature,
  model,
  image,
}: TranscribeImageParams): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey });

  const imagePart = {
    inlineData: {
      data: image.data,
      mimeType: image.mimeType,
    },
  };

  const textPart = {
    text: "Transcribe the timesheet from the image provided.",
  };

  const response = await ai.models.generateContentStream({
    model: model,
    contents: { parts: [textPart, imagePart] },
    config: {
      systemInstruction: systemPrompt,
      temperature,
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
  });

  let fullResponse = "";
  for await (const chunk of response) {
    fullResponse += chunk.text;
  }

  return fullResponse;
};
