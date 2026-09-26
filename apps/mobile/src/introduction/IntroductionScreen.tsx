import { useRouter } from 'expo-router';
import {
  AccessibilityInfo,
  BackHandler,
  findNodeHandle,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppIcon } from '../design/Icon';
import { Surface } from '../design/Primitives';
import { RuncastMark } from '../design/RuncastMark';
import { usePlanner } from '../state';
import { CONTROL, RADIUS, SHADOW, SP, TYPE } from '../theme';
import { useIntroduction } from './IntroductionProvider';
import {
  introductionProgressDotStates,
  introductionStepBelongsToSurface,
  introductionStepPresentation,
  placeIntroductionCoachmark,
  placeIntroductionDockedCoachmark,
  type CoachmarkPlacement,
  type IntroductionSurface,
  type IntroductionTargetId,
  type WindowRect,
} from './IntroductionPresentation';

export type { IntroductionMode } from './IntroductionPresentation';

export function IntroductionInvitation({ onShow }: { onShow: () => void }) {
  const planner = usePlanner();
  const { end } = useIntroduction();
  const { chrome } = planner;
  const { fontScale } = useWindowDimensions();
  const stackActions = fontScale >= 1.3;
  const panelSurface = planner.themeName === 'dark' ? chrome.surfaceMuted : chrome.surfaceRaised;
  return (
    <Surface
      chrome={chrome}
      style={[
        styles.tourPanel,
        styles.invitation,
        {
          backgroundColor: panelSurface,
          borderColor: chrome.borderStrong,
          shadowOpacity: planner.themeName === 'dark' ? 0.42 : 0.2,
        },
      ]}
      testID="introduction-tour"
    >
      <View style={styles.invitationCopy}>
        <View style={styles.brandRow} accessibilityElementsHidden>
          <RuncastMark
            size={28}
            micro
            background={null}
            markColor={chrome.accentInk}
            dotColor={panelSurface}
            dotOutlineColor={chrome.accentInk}
          />
          <Text style={[TYPE.label, { color: chrome.accentInk }]}>RUNCAST</Text>
        </View>
        <Text accessibilityRole="header" style={[TYPE.title, { color: chrome.text }]}>
          Know the route before you run.
        </Text>
        <Text style={[TYPE.body, { color: chrome.textSecondary }]}>
          Pick a start, then see the sun, temperature, rain, and wind you’ll meet along the way.
        </Text>
      </View>
      <View style={[styles.invitationActions, stackActions && styles.actionsStacked]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Use the app without the introduction"
          testID="introduction-dismiss"
          onPress={end}
          style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}
        >
          <Text style={[TYPE.control, { color: chrome.textSecondary }]}>Use the app</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          testID="introduction-primary"
          onPress={onShow}
          style={({ pressed }) => [
            styles.invitationPrimary,
            { backgroundColor: chrome.controlActive },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[TYPE.control, { color: chrome.controlActiveText }]}>Show me</Text>
          <AppIcon name="chevron-right" color={chrome.controlActiveText} size={14} />
        </Pressable>
      </View>
    </Surface>
  );
}

function SpotlightRing({
  rect,
  color,
  related,
  id,
}: {
  rect: WindowRect;
  color: string;
  related: boolean;
  id: IntroductionTargetId;
}) {
  const padding = related ? 4 : 6;
  return (
    <View
      pointerEvents="none"
      testID={`introduction-highlight-${id}`}
      style={[
        styles.spotlightRing,
        {
          left: rect.x - padding,
          top: rect.y - padding,
          width: rect.width + padding * 2,
          height: rect.height + padding * 2,
          borderColor: color,
          borderWidth: related ? 1 : 2,
          opacity: related ? 0.72 : 1,
        },
      ]}
    />
  );
}

export function IntroductionSpotlightOverlay({ surface }: { surface: IntroductionSurface }) {
  const planner = usePlanner();
  const introduction = useIntroduction();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const stackActions = fontScale >= 1.3;
  const [rects, setRects] = useState<Partial<Record<IntroductionTargetId, WindowRect>>>({});
  const [overlayFrame, setOverlayFrame] = useState<WindowRect | null>(null);
  const [coachmarkHeight, setCoachmarkHeight] = useState(150);
  const overlayRef = useRef<View>(null);
  const coachmarkRef = useRef<View>(null);
  const flow = introduction.flow;
  const flowStep = flow?.step === 'invite' || !flow ? null : flow.step;
  const step = flowStep && introductionStepBelongsToSurface(flowStep, surface) ? flowStep : null;
  const presentation = useMemo(
    () =>
      step
        ? introductionStepPresentation(step, {
            routeName: planner.activeLegacyRoute.name,
          })
        : null,
    [planner.activeLegacyRoute.name, step],
  );
  const progressDots = step ? introductionProgressDotStates(step) : [];
  const coachmarkSurface =
    planner.themeName === 'dark' ? planner.chrome.surfaceMuted : planner.chrome.surfaceRaised;

  useEffect(() => {
    if (!presentation) {
      setRects({});
      setOverlayFrame(null);
      return;
    }
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      const ids = [
        presentation.target,
        ...presentation.relatedTargets,
        ...(presentation.placementTarget ? [presentation.placementTarget] : []),
      ];
      void Promise.all(
        ids.map(async (id) => [id, await introduction.measureTarget(id)] as const),
      ).then((measurements) => {
        if (cancelled) return;
        const next: Partial<Record<IntroductionTargetId, WindowRect>> = {};
        for (const [id, rect] of measurements) {
          if (rect) next[id] = rect;
        }
        setRects(next);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [
    introduction.measureTarget,
    introduction.targetVersion,
    presentation?.target,
    presentation?.placementTarget,
    presentation?.relatedTargets,
    windowHeight,
    windowWidth,
  ]);

  useEffect(() => {
    if (!presentation) return;
    AccessibilityInfo.announceForAccessibility(
      `Step ${presentation.progress}. ${presentation.title}. ${presentation.message}`,
    );
  }, [presentation?.message, presentation?.progress, presentation?.title]);

  const handleBack = useCallback(() => {
    if (!flow || flow.step === 'invite') return;
    if (flow.step === 'day-outlook') {
      introduction.goTo('conditions');
      if (router.canGoBack()) router.back();
      else router.replace('/');
      return;
    }
    introduction.back();
  }, [flow, introduction, router]);

  useEffect(() => {
    if (!step) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [handleBack, step]);

  if (!presentation) return null;
  const toLocalRect = (rect: WindowRect): WindowRect => ({
    ...rect,
    x: rect.x - (overlayFrame?.x ?? 0),
    y: rect.y - (overlayFrame?.y ?? 0),
  });
  const measuredTarget = rects[presentation.target];
  const targetRect = measuredTarget && overlayFrame ? toLocalRect(measuredTarget) : null;
  const measuredPlacementTarget = presentation.placementTarget
    ? rects[presentation.placementTarget]
    : measuredTarget;
  const placementTargetRect =
    measuredPlacementTarget && overlayFrame ? toLocalRect(measuredPlacementTarget) : null;
  const overlayWidth = overlayFrame?.width ?? windowWidth;
  const overlayHeight = overlayFrame?.height ?? windowHeight;
  const docked = presentation.coachmarkMode === 'bottom-docked';
  const coachmarkWidth = Math.min(docked ? 360 : 280, overlayWidth - SP[4] * 2);
  const placement =
    targetRect && (docked || placementTargetRect)
      ? docked
        ? placeIntroductionDockedCoachmark({
            coachmarkWidth,
            coachmarkHeight,
            windowWidth: overlayWidth,
            windowHeight: overlayHeight,
            insetTop: Math.max(0, insets.top - (overlayFrame?.y ?? 0)),
            insetBottom: insets.bottom,
          })
        : placeIntroductionCoachmark({
            target: targetRect,
            placementTarget: placementTargetRect!,
            coachmarkWidth,
            coachmarkHeight,
            windowWidth: overlayWidth,
            windowHeight: overlayHeight,
            insetTop: Math.max(0, insets.top - (overlayFrame?.y ?? 0)),
            insetBottom: insets.bottom,
            gap: presentation.coachmarkGap,
            horizontalAlignment: presentation.coachmarkAlignment,
          })
      : null;
  const pointerPlacement = !docked ? (placement as CoachmarkPlacement | null) : null;

  function handlePrimary() {
    if (!flow) return;
    if (flow.step === 'conditions') {
      introduction.goTo('day-outlook');
      router.push('/planner');
      return;
    }
    if (flow.step === 'watch') {
      introduction.end();
      router.dismissTo('/');
      return;
    }
    introduction.advance();
  }

  function handleCoachmarkLayout(event: LayoutChangeEvent) {
    const nextHeight = event.nativeEvent.layout.height;
    if (Math.abs(nextHeight - coachmarkHeight) > 1) setCoachmarkHeight(nextHeight);
    const handle = coachmarkRef.current;
    if (!handle) return;
    const node = findNodeHandle(handle);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }

  function handleOverlayLayout() {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) return;
      setOverlayFrame((current) => {
        if (
          current &&
          current.x === x &&
          current.y === y &&
          current.width === width &&
          current.height === height
        ) {
          return current;
        }
        return { x, y, width, height };
      });
    });
  }

  return (
    <View
      ref={overlayRef}
      collapsable={false}
      pointerEvents={targetRect && placement ? 'auto' : 'none'}
      style={styles.overlay}
      accessibilityViewIsModal
      testID="introduction-tour"
      onLayout={handleOverlayLayout}
    >
      <Pressable
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={StyleSheet.absoluteFill}
        onPress={() => {}}
      />
      {targetRect && placement ? (
        <>
          <SpotlightRing
            id={presentation.target}
            rect={targetRect}
            color={planner.chrome.accentInk}
            related={false}
          />
          {presentation.relatedTargets.map((id) => {
            const rect = rects[id];
            return rect ? (
              <SpotlightRing
                key={id}
                id={id}
                rect={toLocalRect(rect)}
                color={planner.chrome.accentInk}
                related
              />
            ) : null;
          })}
          {pointerPlacement ? (
            <View
              pointerEvents="none"
              style={[
                styles.pointer,
                {
                  left: pointerPlacement.left + pointerPlacement.pointerLeft,
                  top:
                    pointerPlacement.side === 'above'
                      ? pointerPlacement.top + coachmarkHeight - 6
                      : pointerPlacement.top - 6,
                  backgroundColor: coachmarkSurface,
                  borderColor: planner.chrome.borderStrong,
                },
              ]}
            />
          ) : null}
          <View
            ref={coachmarkRef}
            collapsable={false}
            style={{
              position: 'absolute',
              left: placement.left,
              top: placement.top,
              width: coachmarkWidth,
            }}
            onLayout={handleCoachmarkLayout}
          >
            <Surface
              chrome={planner.chrome}
              style={[
                styles.tourPanel,
                styles.coachmark,
                {
                  backgroundColor: coachmarkSurface,
                  borderColor: planner.chrome.borderStrong,
                  shadowOpacity: planner.themeName === 'dark' ? 0.42 : 0.2,
                },
              ]}
            >
              <View style={styles.coachmarkHeader}>
                <Text
                  accessibilityRole="header"
                  testID="introduction-title"
                  style={[TYPE.title, styles.coachmarkTitle, { color: planner.chrome.text }]}
                >
                  {presentation.title}
                </Text>
                <View
                  accessible
                  accessibilityRole="progressbar"
                  accessibilityLabel={`Step ${presentation.progress}`}
                  accessibilityValue={{
                    min: 1,
                    max: progressDots.length,
                    now: progressDots.filter(Boolean).length,
                  }}
                  testID="introduction-progress"
                  style={styles.progressDots}
                >
                  {progressDots.map((active, index) => (
                    <View
                      key={index}
                      style={[
                        styles.progressDot,
                        {
                          backgroundColor: active
                            ? planner.chrome.controlActive
                            : planner.chrome.borderStrong,
                        },
                      ]}
                    />
                  ))}
                </View>
              </View>
              <Text style={[TYPE.body, styles.coachmarkMessage, { color: planner.chrome.text }]}>
                {presentation.message}
              </Text>
              <View style={[styles.coachmarkActions, stackActions && styles.actionsStacked]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Previous introduction step"
                  onPress={handleBack}
                  style={({ pressed }) => [styles.backAction, pressed && styles.pressed]}
                >
                  <AppIcon name="chevron-left" color={planner.chrome.textSecondary} size={16} />
                  <Text style={[TYPE.control, { color: planner.chrome.textSecondary }]}>Back</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  testID="introduction-primary"
                  onPress={handlePrimary}
                  style={({ pressed }) => [
                    styles.coachmarkPrimary,
                    { backgroundColor: planner.chrome.controlActive },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    numberOfLines={2}
                    style={[
                      TYPE.control,
                      { color: planner.chrome.controlActiveText, textAlign: 'center' },
                    ]}
                  >
                    {presentation.actionLabel}
                  </Text>
                  <AppIcon
                    name="chevron-right"
                    color={planner.chrome.controlActiveText}
                    size={14}
                  />
                </Pressable>
              </View>
            </Surface>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tourPanel: {
    borderWidth: 1,
    shadowColor: SHADOW.color,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 24,
  },
  invitation: {
    width: '100%',
    maxWidth: 430,
    alignSelf: 'center',
    padding: SP[4],
    gap: SP[3],
    borderRadius: RADIUS.xl,
  },
  invitationCopy: { gap: SP[2] },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: SP[2] },
  invitationActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: SP[2],
  },
  actionsStacked: { flexDirection: 'column', alignItems: 'stretch' },
  textAction: {
    minHeight: CONTROL.height,
    paddingHorizontal: SP[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  invitationPrimary: {
    minHeight: CONTROL.height,
    paddingHorizontal: SP[4],
    borderRadius: RADIUS.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP[1],
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
    elevation: 1000,
  },
  spotlightRing: {
    position: 'absolute',
    borderRadius: RADIUS.lg,
    shadowColor: '#67d5d6',
    shadowOpacity: 0.7,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 16,
  },
  pointer: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderWidth: StyleSheet.hairlineWidth,
    transform: [{ rotate: '45deg' }],
  },
  coachmark: {
    padding: SP[3],
    gap: SP[2],
    borderRadius: RADIUS.lg,
  },
  coachmarkHeader: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SP[2],
  },
  coachmarkTitle: { flex: 1, flexShrink: 1 },
  coachmarkMessage: { lineHeight: 20 },
  progressDots: {
    minHeight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  progressDot: { width: 6, height: 6, borderRadius: 3 },
  coachmarkActions: { flexDirection: 'row', alignItems: 'stretch', gap: SP[2] },
  backAction: {
    minHeight: CONTROL.height,
    paddingHorizontal: SP[2],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP[1],
  },
  coachmarkPrimary: {
    flex: 1,
    minHeight: CONTROL.height,
    paddingHorizontal: SP[3],
    borderRadius: RADIUS.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP[1],
  },
  pressed: { opacity: 0.68 },
});
