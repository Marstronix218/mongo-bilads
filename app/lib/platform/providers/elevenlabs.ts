import "server-only";

import { InferenceError } from "../inference/contracts";
import { providerFetch, requiredSecret } from "../inference/http";

const PROVIDER = "elevenlabs" as const;
const BASE_URL = "https://api.elevenlabs.io/v1";
const DEFAULT_MODEL = "eleven_multilingual_v2";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";

export interface SpeechRequest {
  text: string;
  voiceId?: string;
  modelId?: string;
  outputFormat?: string;
  voiceSettings?: {
    stability?: number;
    similarityBoost?: number;
    style?: number;
    useSpeakerBoost?: boolean;
  };
  signal?: AbortSignal;
}

export interface SpeechResult {
  audio: Buffer;
  contentType: string;
  provider: "elevenlabs";
  voiceId: string;
  modelId: string;
  requestId?: string;
}

function resolveRequest(request: SpeechRequest) {
  const apiKey = requiredSecret(PROVIDER, "ELEVENLABS_API_KEY");
  const voiceId = request.voiceId || process.env.ELEVENLABS_VOICE_ID?.trim();
  if (!voiceId) {
    throw new InferenceError({
      provider: PROVIDER,
      code: "not_configured",
      message: "Set ELEVENLABS_VOICE_ID or pass voiceId",
    });
  }
  if (!request.text.trim()) {
    throw new InferenceError({
      provider: PROVIDER,
      code: "provider_error",
      message: "Speech text cannot be empty",
    });
  }
  return {
    apiKey,
    voiceId,
    modelId: request.modelId || process.env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_MODEL,
    outputFormat:
      request.outputFormat || process.env.ELEVENLABS_OUTPUT_FORMAT?.trim() || DEFAULT_OUTPUT_FORMAT,
    baseUrl: (process.env.ELEVENLABS_BASE_URL?.trim() || BASE_URL).replace(/\/$/, ""),
  };
}

function speechBody(request: SpeechRequest, modelId: string): string {
  return JSON.stringify({
    text: request.text,
    model_id: modelId,
    ...(request.voiceSettings
      ? {
          voice_settings: {
            stability: request.voiceSettings.stability,
            similarity_boost: request.voiceSettings.similarityBoost,
            style: request.voiceSettings.style,
            use_speaker_boost: request.voiceSettings.useSpeakerBoost,
          },
        }
      : {}),
  });
}

async function speechResponse(request: SpeechRequest, streaming: boolean): Promise<{
  response: Response;
  voiceId: string;
  modelId: string;
}> {
  const cfg = resolveRequest(request);
  const response = await providerFetch({
    provider: PROVIDER,
    url: `${cfg.baseUrl}/text-to-speech/${encodeURIComponent(cfg.voiceId)}${
      streaming ? "/stream" : ""
    }?output_format=${encodeURIComponent(cfg.outputFormat)}`,
    timeoutMs: 45_000,
    maxRetries: 0,
    signal: request.signal,
    init: {
      method: "POST",
      headers: {
        "xi-api-key": cfg.apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: speechBody(request, cfg.modelId),
    },
  });
  return { response, voiceId: cfg.voiceId, modelId: cfg.modelId };
}

export async function elevenLabsSpeech(request: SpeechRequest): Promise<SpeechResult> {
  const { response, voiceId, modelId } = await speechResponse(request, false);
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) {
    throw new InferenceError({
      provider: PROVIDER,
      code: "invalid_response",
      message: "ElevenLabs returned empty audio",
    });
  }
  return {
    audio,
    contentType: response.headers.get("content-type") || "audio/mpeg",
    provider: PROVIDER,
    voiceId,
    modelId,
    requestId: response.headers.get("request-id") || undefined,
  };
}

export async function elevenLabsSpeechStream(request: SpeechRequest): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  voiceId: string;
  modelId: string;
}> {
  const { response, voiceId, modelId } = await speechResponse(request, true);
  if (!response.body) {
    throw new InferenceError({
      provider: PROVIDER,
      code: "invalid_response",
      message: "ElevenLabs returned no audio stream",
    });
  }
  return {
    stream: response.body,
    contentType: response.headers.get("content-type") || "audio/mpeg",
    voiceId,
    modelId,
  };
}

/** Small injectable facade used by workflow nodes and API handlers. */
export function createElevenLabsProvider() {
  return {
    synthesize: elevenLabsSpeech,
    synthesizeStream: elevenLabsSpeechStream,
  };
}
