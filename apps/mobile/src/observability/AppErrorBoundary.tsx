import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { captureAppException } from './sentry';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
  reference: string | null;
  retry: number;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, reference: null, retry: 0 };

  static getDerivedStateFromError(): Pick<State, 'failed'> {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.setState({ reference: captureAppException(error) });
  }

  private retry = () => {
    this.setState((state) => ({ failed: false, reference: null, retry: state.retry + 1 }));
  };

  render() {
    if (!this.state.failed)
      return (
        <View key={this.state.retry} style={styles.root}>
          {this.props.children}
        </View>
      );
    return (
      <View style={styles.fallback} accessibilityRole="alert">
        <View style={styles.mark} accessibilityElementsHidden>
          <Text style={styles.markText}>RC</Text>
        </View>
        <Text style={styles.title}>Runcast hit an unexpected problem</Text>
        <Text style={styles.body}>
          Your route data is still on this device. Try reopening this screen, or send the reference
          below to support if it happens again.
        </Text>
        <Text selectable style={styles.reference}>
          Reference: {this.state.reference ?? 'creating-reference'}
        </Text>
        <Pressable accessibilityRole="button" onPress={this.retry} style={styles.primary}>
          <Text style={styles.primaryText}>Retry</Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          onPress={() => void Linking.openURL('mailto:support@runcast.app')}
          style={styles.secondary}
        >
          <Text style={styles.secondaryText}>Contact support</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fallback: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: '#101012',
  },
  mark: {
    width: 54,
    height: 54,
    borderRadius: 16,
    backgroundColor: '#67d5d6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  markText: { color: '#071514', fontSize: 18, fontWeight: '800', letterSpacing: -0.8 },
  title: { color: '#f4f4f2', fontSize: 26, lineHeight: 32, fontWeight: '700' },
  body: { color: '#b3b3ad', fontSize: 15, lineHeight: 22, marginTop: 12 },
  reference: { color: '#969690', fontSize: 12, lineHeight: 18, marginTop: 18 },
  primary: {
    minHeight: 48,
    marginTop: 24,
    borderRadius: 12,
    backgroundColor: '#67d5d6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#071514', fontSize: 15, fontWeight: '700' },
  secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  secondaryText: { color: '#67d5d6', fontSize: 15, fontWeight: '600' },
});
