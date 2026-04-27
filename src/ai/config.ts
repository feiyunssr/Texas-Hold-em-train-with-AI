export type AiCoachConfig = {
  requestTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
};

const DEFAULT_AI_COACH_CONFIG: AiCoachConfig = {
  requestTimeoutMs: 2500,
  retryAttempts: 2,
  retryBackoffMs: 300
};

export function getAiCoachConfig(
  env: NodeJS.ProcessEnv = process.env
): AiCoachConfig {
  return {
    requestTimeoutMs: readPositiveInteger(
      env.AI_COACH_REQUEST_TIMEOUT_MS,
      DEFAULT_AI_COACH_CONFIG.requestTimeoutMs
    ),
    retryAttempts: readNonNegativeInteger(
      env.AI_COACH_RETRY_ATTEMPTS,
      DEFAULT_AI_COACH_CONFIG.retryAttempts
    ),
    retryBackoffMs: readNonNegativeInteger(
      env.AI_COACH_RETRY_BACKOFF_MS,
      DEFAULT_AI_COACH_CONFIG.retryBackoffMs
    )
  };
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function readNonNegativeInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}
