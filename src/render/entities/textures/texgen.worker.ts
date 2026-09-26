// Worker: generates the procedural surface texture arrays off the main thread.
import { generateSurfaceTextures } from './texgen';

self.onmessage = (e: MessageEvent<{ size: number }>) => {
  const data = generateSurfaceTextures(e.data.size);
  (self as unknown as Worker).postMessage(data, [data.detail.buffer, data.normal.buffer]);
};
