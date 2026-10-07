/** Heavy widget frames are bounded, but the deadline belongs to the last frame,
 * never to the newest input. Continuous pours therefore cannot starve redraws. */
export function heavyFrameDelay(widget: boolean, lastFrame: number, now: number, urgent: boolean): number {
  return !widget || urgent ? 0 : Math.max(0, 200 - (now - lastFrame));
}
