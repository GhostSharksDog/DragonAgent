import type { Graph } from './comfy';
import type { WorkshopSettings } from '../../shared/workshop';

const node = (class_type: string, inputs: Record<string, unknown>) => ({ class_type, inputs });
const negative = 'cropped, extra limbs, missing limbs, malformed hands, changing character, changing clothes, inconsistent face, camera movement, zoom, text, watermark, background objects, motion blur';
export function characterGraph(s: WorkshopSettings, prompt: string, avoid: string, seed: number, prefix: string): Graph {
  return {
    '1': node('CheckpointLoaderSimple', { ckpt_name: s.checkpoint }),
    '2': node('CLIPTextEncode', { clip: ['1',1], text: `${prompt}, full body, solo, entire character visible, feet visible, centered, front view, chibi, simple plain background, safe, masterpiece, high score, great score` }),
    '3': node('CLIPTextEncode', { clip: ['1',1], text: `${negative}, ${avoid}` }),
    '4': node('EmptyLatentImage', { width: 1024, height: 1024, batch_size: 1 }),
    '5': node('KSampler', { model: ['1',0], positive: ['2',0], negative: ['3',0], latent_image: ['4',0], seed, steps: 28, cfg: 5, sampler_name: 'euler_ancestral', scheduler: 'normal', denoise: 1 }),
    '6': node('VAEDecodeTiled', { samples: ['5',0], vae: ['1',2], tile_size: 512, overlap: 64, temporal_size: 16, temporal_overlap: 4 }),
    '7': node('SaveImage', { images: ['6',0], filename_prefix: prefix }),
  };
}
export function videoGraph(s: WorkshopSettings, image: string, prompt: string, seed: number, prefix: string): Graph {
  return {
    '1': node('UNETLoader', { unet_name: s.videoModel, weight_dtype: 'default' }),
    '2': node('ModelSamplingSD3', { model: ['1',0], shift: 8 }),
    '3': node('CLIPLoader', { clip_name: s.textEncoder, type: 'wan', device: 'default' }),
    '4': node('VAELoader', { vae_name: s.vae }),
    '5': node('LoadImage', { image }),
    '6': node('CLIPTextEncode', { clip: ['3',0], text: `A clean 2D anime character animation of exactly the reference character. Full body always visible, consistent costume and accessories, preserve the reference colors and identity. Static orthographic camera, plain neutral background, character stays centered. ${prompt}` }),
    '7': node('CLIPTextEncode', { clip: ['3',0], text: negative }),
    '8': node('Wan22ImageToVideoLatent', { vae: ['4',0], start_image: ['5',0], width: 512, height: 512, length: 49, batch_size: 1 }),
    '9': node('KSampler', { model: ['2',0], positive: ['6',0], negative: ['7',0], latent_image: ['8',0], seed, steps: 30, cfg: 5, sampler_name: 'uni_pc', scheduler: 'simple', denoise: 1 }),
    '10': node('VAEDecodeTiled', { samples: ['9',0], vae: ['4',0], tile_size: 256, overlap: 64, temporal_size: 16, temporal_overlap: 4 }),
    '11': node('SaveImage', { images: ['10',0], filename_prefix: prefix }),
  };
}
export function matteGraph(s: WorkshopSettings, images: string[], prefix: string): Graph {
  if (!images.length || images.length > 8) throw new Error('每批抠图需要 1–8 帧。');
  const graph: Graph = {}; let previous = '';
  images.forEach((image, index) => {
    const id = `load${index}`; graph[id] = node('LoadImage', { image });
    if (!previous) previous = id;
    else { const batch = `batch${index}`; graph[batch] = node('ImageBatch', { image1: [previous,0], image2: [id,0] }); previous = batch; }
  });
  graph.matte = node('BiRefNetRMBG', { image: [previous,0], model: s.matteModel, sensitivity: 1, mask_blur: 0, mask_offset: 0, invert_output: false, refine_foreground: true, unload_model: true, background: 'Alpha', background_color: '#222222' });
  graph.save = node('SaveImage', { images: ['matte',0], filename_prefix: prefix });
  return graph;
}
