import { parentPort, workerData } from 'node:worker_threads';
import { normalizeFrames, importCharacter } from './workshop/images';
const result = workerData.kind === 'normalize' ? normalizeFrames(workerData.input) : importCharacter(workerData.input.root, workerData.input.file, workerData.input.source);
void result.then(value => parentPort!.postMessage({ result: value }), error => parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) }));
