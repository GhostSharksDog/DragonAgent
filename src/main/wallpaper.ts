import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
let root = '';

/** 由主进程在启动时指定目录，模块本身不 import electron，测试环境可以直接加载。 */
export function initWallpaper(directory: string): void {
  root = path.join(directory, 'wallpapers');
  mkdirSync(root, { recursive: true });
}

export function wallpaperDirectory(): string {
  if (!root) throw new Error('壁纸存储尚未初始化');
  return root;
}

export function storeWallpaper(source: string): { file: string; name: string } {
  const ext = path.extname(source).toLowerCase();
  if (!EXTENSIONS.includes(ext)) throw new Error('支持 PNG、JPEG、WebP 图片。');
  if (statSync(source).size > 20 * 1024 * 1024) throw new Error('图片超过 20 MB，请先压缩后再试。');
  const file = `${randomUUID()}${ext}`;
  copyFileSync(source, path.join(wallpaperDirectory(), file));
  return { file, name: path.basename(source) };
}

export function dropWallpaper(file: string | null | undefined): void {
  if (!file || !root) return;
  const target = path.join(wallpaperDirectory(), path.basename(file));
  if (existsSync(target)) rmSync(target, { force: true });
}

/** 只允许读取壁纸目录里的文件，防止路径穿越。 */
export function resolveWallpaper(file: string): string {
  const directory = wallpaperDirectory();
  const target = path.resolve(directory, path.basename(decodeURIComponent(file)));
  if (!target.startsWith(directory + path.sep) || !existsSync(target)) throw new Error('壁纸不存在');
  return target;
}
