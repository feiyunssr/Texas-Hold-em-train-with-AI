export type PokerEngineHealth = {
  module: "domain/poker";
  isolated: true;
};

export function getPokerEngineHealth(): PokerEngineHealth {
  return {
    module: "domain/poker",
    isolated: true
  };
}
