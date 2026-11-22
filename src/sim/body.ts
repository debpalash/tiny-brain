/** Run-and-tumble body constants. */
export const BODY = {
  baseSpeed: 1.5, // units/s at RUN = 0
  speedRange: 3.5, // extra units/s at RUN = 1
  tumbleMaxRate: 16, // tumbles per second at TUMBLE = 1 (rate = max * act^pow)
  tumblePow: 3,
  tumbleEndRate: 5.66, // tumbles last ~1/rate seconds
  tumbleTurnDiffusion: 12, // rad^2/s of heading random walk while tumbling
  runTurnNoise: 0.1, // rad/sqrt(s) while running
  tumbleSpeedFrac: 0.1,
};
