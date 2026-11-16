import { generateRoomOptions, type GenInput } from './generator';

self.onmessage = (e: MessageEvent<{ input: GenInput; count: number }>) => {
  try {
    (self as unknown as Worker).postMessage({ result: generateRoomOptions(e.data.input, e.data.count) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
