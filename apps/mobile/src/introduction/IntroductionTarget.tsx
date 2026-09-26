import { useCallback, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useIntroduction } from './IntroductionProvider';
import type { IntroductionTargetId } from './IntroductionPresentation';

export function IntroductionTarget({
  id,
  children,
  style,
  testID,
}: {
  id: IntroductionTargetId;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { registerTarget, targetDidLayout } = useIntroduction();
  const setTargetRef = useCallback(
    (node: View | null) => {
      registerTarget(id, node);
    },
    [id, registerTarget],
  );

  return (
    <View
      ref={setTargetRef}
      collapsable={false}
      testID={testID}
      style={style}
      onLayout={targetDidLayout}
    >
      {children}
    </View>
  );
}
