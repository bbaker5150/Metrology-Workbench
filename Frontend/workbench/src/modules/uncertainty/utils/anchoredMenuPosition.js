const finiteOr = (value, fallback) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

// Position a fixed menu beside its trigger without assuming the menu will fill
// its max-height. Above-opening menus use a bottom anchor, so a short menu stays
// next to the trigger instead of floating hundreds of pixels above it.
export const getAnchoredMenuPlacement = ({
  anchorRect,
  viewportWidth,
  viewportHeight,
  preferredWidth = 420,
  preferredMaxHeight = 420,
  viewportPadding = 8,
  gap = 6,
  fallbackTop = 60,
}) => {
  const safeViewportWidth = finiteOr(viewportWidth, 1024);
  const safeViewportHeight = finiteOr(viewportHeight, 768);
  const widthAvailable = Math.max(1, safeViewportWidth - viewportPadding * 2);
  const heightAvailable = Math.max(1, safeViewportHeight - viewportPadding * 2);
  const width = Math.min(preferredWidth, widthAvailable);
  const desiredMaxHeight = Math.min(preferredMaxHeight, heightAvailable);

  if (!anchorRect) {
    return {
      width,
      left: viewportPadding,
      top: Math.min(fallbackTop, viewportPadding + heightAvailable - 1),
      bottom: undefined,
      maxHeight: Math.max(
        1,
        Math.min(
          desiredMaxHeight,
          heightAvailable - fallbackTop + viewportPadding,
        ),
      ),
      openBelow: true,
    };
  }

  const anchorLeft = finiteOr(anchorRect.left, viewportPadding);
  const anchorRight = finiteOr(anchorRect.right, anchorLeft);
  const anchorTop = finiteOr(anchorRect.top, viewportPadding);
  const anchorBottom = finiteOr(anchorRect.bottom, anchorTop);
  const maxLeft = Math.max(
    viewportPadding,
    safeViewportWidth - width - viewportPadding,
  );
  const canAlignRight = anchorRight - width >= viewportPadding;
  const idealLeft = canAlignRight ? anchorRight - width : anchorLeft;
  const left = Math.max(viewportPadding, Math.min(idealLeft, maxLeft));

  const availableBelow = Math.max(
    0,
    safeViewportHeight - anchorBottom - gap - viewportPadding,
  );
  const availableAbove = Math.max(0, anchorTop - gap - viewportPadding);
  // Menus naturally open below. Flip only when the space below is cramped and
  // opening above materially improves it.
  const comfortableBelow = Math.min(desiredMaxHeight, 240);
  const openBelow =
    availableBelow >= comfortableBelow || availableBelow >= availableAbove;
  const availableSpace = openBelow ? availableBelow : availableAbove;

  return {
    width,
    left,
    top: openBelow ? anchorBottom + gap : undefined,
    bottom: openBelow ? undefined : safeViewportHeight - anchorTop + gap,
    maxHeight: Math.max(1, Math.min(desiredMaxHeight, availableSpace)),
    openBelow,
  };
};
