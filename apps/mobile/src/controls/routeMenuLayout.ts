export interface RouteMenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RouteMenuLayout {
  width: number;
  left: number;
  top: number;
  maxHeight: number;
}

const MENU_WIDTH = 304;
const SCREEN_GUTTER = 16;
const ANCHOR_GAP = 8;
const MAX_VIEWPORT_FRACTION = 0.46;

/** Keep the popover compact enough that it does not collide with the planning dock. */
export function routeMenuLayout(input: {
  anchor: RouteMenuAnchor;
  windowWidth: number;
  windowHeight: number;
  bottomInset: number;
}): RouteMenuLayout {
  const width = Math.min(MENU_WIDTH, Math.max(0, input.windowWidth - SCREEN_GUTTER * 2));
  const left = Math.min(
    Math.max(input.anchor.x, SCREEN_GUTTER),
    Math.max(SCREEN_GUTTER, input.windowWidth - width - SCREEN_GUTTER),
  );
  const belowTop = input.anchor.y + input.anchor.height + ANCHOR_GAP;
  const availableBelow = Math.max(
    0,
    input.windowHeight - belowTop - input.bottomInset - SCREEN_GUTTER,
  );
  const preferredHeight = Math.min(
    input.windowHeight - input.bottomInset - SCREEN_GUTTER * 2,
    Math.max(240, input.windowHeight * MAX_VIEWPORT_FRACTION),
  );
  const availableAbove = Math.max(0, input.anchor.y - ANCHOR_GAP - SCREEN_GUTTER);
  const opensAbove =
    availableBelow < Math.min(240, preferredHeight) && availableAbove > availableBelow;
  const maxHeight = Math.min(opensAbove ? availableAbove : availableBelow, preferredHeight);
  const top = opensAbove
    ? Math.max(SCREEN_GUTTER, input.anchor.y - ANCHOR_GAP - maxHeight)
    : belowTop;
  return { width, left, top, maxHeight };
}
