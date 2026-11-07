/**
 * 视频皮肤的方向翻转：flipX 缺省表示使用原片，不表示“和 mirror 相反”。
 * 这里显式转成布尔值，避免 undefined !== false 把普通视频误判成需要翻转。
 */
export function videoNeedsFlip(flipX: boolean | undefined, mirror: boolean): boolean {
  return Boolean(flipX) !== Boolean(mirror);
}
