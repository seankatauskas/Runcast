import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { View } from 'react-native';
import {
  nextIntroductionStep,
  previousIntroductionStep,
  type IntroductionFlow,
  type IntroductionMode,
  type IntroductionStep,
  type IntroductionTargetId,
  type WindowRect,
} from './IntroductionPresentation';
import { IntroductionState } from './IntroductionState';

interface IntroductionContextValue {
  ready: boolean;
  completed: boolean;
  flow: IntroductionFlow | null;
  targetVersion: number;
  begin: (mode: IntroductionMode) => void;
  advance: () => IntroductionStep | null;
  back: () => IntroductionStep | null;
  goTo: (step: IntroductionStep) => void;
  end: () => void;
  registerTarget: (id: IntroductionTargetId, node: View | null) => void;
  targetDidLayout: () => void;
  measureTarget: (id: IntroductionTargetId) => Promise<WindowRect | null>;
}

const IntroductionContext = createContext<IntroductionContextValue | null>(null);

export function IntroductionProvider({ children }: { children: ReactNode }) {
  const introduction = useMemo(() => new IntroductionState(AsyncStorage), []);
  const snapshot = useSyncExternalStore(
    introduction.subscribe,
    introduction.getSnapshot,
    introduction.getSnapshot,
  );
  const [flow, setFlow] = useState<IntroductionFlow | null>(null);
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const targets = useRef(new Map<IntroductionTargetId, View>());
  const [targetVersion, setTargetVersion] = useState(0);

  useEffect(() => {
    void introduction.hydrate();
  }, [introduction]);

  const begin = useCallback((mode: IntroductionMode) => {
    setFlow({ mode, step: 'invite' });
  }, []);

  const goTo = useCallback((step: IntroductionStep) => {
    setFlow((current) => (current ? { ...current, step } : current));
  }, []);

  const advance = useCallback((): IntroductionStep | null => {
    const next = flowRef.current ? nextIntroductionStep(flowRef.current.step) : null;
    if (next) goTo(next);
    return next;
  }, [goTo]);

  const back = useCallback((): IntroductionStep | null => {
    const previous = flowRef.current ? previousIntroductionStep(flowRef.current.step) : null;
    if (previous) goTo(previous);
    return previous;
  }, [goTo]);

  const end = useCallback(() => {
    const current = flowRef.current;
    setFlow(null);
    if (current?.mode === 'first-run') introduction.complete();
  }, [introduction]);

  const registerTarget = useCallback((id: IntroductionTargetId, node: View | null) => {
    const current = targets.current.get(id);
    if (node) {
      if (current === node) return;
      targets.current.set(id, node);
    } else {
      if (!current) return;
      targets.current.delete(id);
    }
    setTargetVersion((version) => version + 1);
  }, []);

  const targetDidLayout = useCallback(() => {
    setTargetVersion((version) => version + 1);
  }, []);

  const measureTarget = useCallback((id: IntroductionTargetId): Promise<WindowRect | null> => {
    const node = targets.current.get(id);
    if (!node) return Promise.resolve(null);
    return new Promise((resolve) => {
      node.measureInWindow((x, y, width, height) => {
        resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
      });
    });
  }, []);

  const value = useMemo<IntroductionContextValue>(
    () => ({
      ...snapshot,
      flow,
      targetVersion,
      begin,
      advance,
      back,
      goTo,
      end,
      registerTarget,
      targetDidLayout,
      measureTarget,
    }),
    [
      advance,
      back,
      begin,
      end,
      flow,
      goTo,
      measureTarget,
      registerTarget,
      snapshot,
      targetDidLayout,
      targetVersion,
    ],
  );

  return <IntroductionContext.Provider value={value}>{children}</IntroductionContext.Provider>;
}

export function useIntroduction(): IntroductionContextValue {
  const value = useContext(IntroductionContext);
  if (!value) throw new Error('useIntroduction must be used within IntroductionProvider');
  return value;
}
