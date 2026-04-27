export type ServiceHealth = {
  ok: true;
  service: string;
};

export function getServiceHealth(): ServiceHealth {
  return {
    ok: true,
    service: "texas-holdem-train-with-ai"
  };
}
