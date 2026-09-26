import { StyleSheet, View } from 'react-native';

export type IconName =
  | 'check'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-up'
  | 'close'
  | 'eye'
  | 'fit'
  | 'info'
  | 'link'
  | 'minus'
  | 'moon'
  | 'more'
  | 'pause'
  | 'play'
  | 'plus'
  | 'reverse'
  | 'sun'
  | 'upload';

interface Props {
  name: IconName;
  color: string;
  size?: number;
  /** The control surface behind the icon, used to cut out the moon. */
  backgroundColor?: string;
}

/**
 * Tiny dependency-free line icon set for Runcast's compact controls. The
 * shapes share a 2pt stroke and rounded geometry, so controls no longer mix
 * emoji, text glyphs and one-off CSS triangles.
 */
export function AppIcon({ name, color, size = 20, backgroundColor = 'transparent' }: Props) {
  const stroke = Math.max(1.5, size / 10);
  const line = {
    backgroundColor: color,
    height: stroke,
    borderRadius: stroke,
  } as const;

  if (name === 'more') {
    return (
      <View
        style={[styles.frame, { width: size, height: size, flexDirection: 'row', gap: size / 5 }]}
      >
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={{
              width: stroke + 1,
              height: stroke + 1,
              borderRadius: size,
              backgroundColor: color,
            }}
          />
        ))}
      </View>
    );
  }

  if (name === 'play') {
    return (
      <View
        style={{
          marginLeft: size * 0.12,
          width: 0,
          height: 0,
          borderTopWidth: size * 0.34,
          borderBottomWidth: size * 0.34,
          borderLeftWidth: size * 0.5,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: color,
        }}
      />
    );
  }

  if (name === 'check') {
    return (
      <View style={[styles.frame, { width: size, height: size }]}>
        <View
          style={{
            position: 'absolute',
            left: size * 0.13,
            top: size * 0.5,
            width: size * 0.36,
            height: stroke,
            borderRadius: stroke,
            backgroundColor: color,
            transform: [{ rotate: '45deg' }],
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: size * 0.34,
            top: size * 0.43,
            width: size * 0.58,
            height: stroke,
            borderRadius: stroke,
            backgroundColor: color,
            transform: [{ rotate: '-48deg' }],
          }}
        />
      </View>
    );
  }

  if (name === 'info') {
    return (
      <View
        style={[
          styles.frame,
          {
            width: size,
            height: size,
            borderRadius: size,
            borderWidth: stroke,
            borderColor: color,
          },
        ]}
      >
        <View
          style={{
            position: 'absolute',
            top: size * 0.22,
            width: stroke + 0.5,
            height: stroke + 0.5,
            borderRadius: size,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: size * 0.43,
            width: stroke + 0.5,
            height: size * 0.34,
            borderRadius: stroke,
            backgroundColor: color,
          }}
        />
      </View>
    );
  }

  if (name === 'eye') {
    return (
      <View style={[styles.frame, { width: size, height: size }]}>
        <View
          style={{
            width: size * 0.9,
            height: size * 0.58,
            borderRadius: size,
            borderWidth: stroke,
            borderColor: color,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: size * 0.24,
              height: size * 0.24,
              borderRadius: size,
              backgroundColor: color,
            }}
          />
        </View>
      </View>
    );
  }

  if (name === 'pause') {
    return (
      <View
        style={[styles.frame, { width: size, height: size, flexDirection: 'row', gap: size * 0.2 }]}
      >
        <View
          style={{
            width: stroke + 1,
            height: size * 0.62,
            borderRadius: stroke,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            width: stroke + 1,
            height: size * 0.62,
            borderRadius: stroke,
            backgroundColor: color,
          }}
        />
      </View>
    );
  }

  if (name === 'plus' || name === 'minus' || name === 'close') {
    const rotateA = name === 'close' ? '45deg' : '0deg';
    const rotateB = name === 'close' ? '-45deg' : '90deg';
    return (
      <View style={[styles.frame, { width: size, height: size }]}>
        <View
          style={[
            line,
            {
              position: 'absolute',
              width: size * 0.68,
              transform: [{ rotate: rotateA }],
            },
          ]}
        />
        {name !== 'minus' && (
          <View
            style={[
              line,
              {
                position: 'absolute',
                width: size * 0.68,
                transform: [{ rotate: rotateB }],
              },
            ]}
          />
        )}
      </View>
    );
  }

  if (name === 'chevron-left') {
    return (
      <View style={[styles.frame, { width: size, height: size }]}>
        <View
          style={{
            width: size * 0.48,
            height: size * 0.48,
            borderRightWidth: stroke,
            borderBottomWidth: stroke,
            borderColor: color,
            transform: [{ rotate: '135deg' }],
          }}
        />
      </View>
    );
  }

  if (name === 'chevron-up') {
    return (
      <View style={[styles.frame, { width: size, height: size }]}>
        <View
          style={{
            width: size * 0.48,
            height: size * 0.48,
            borderRightWidth: stroke,
            borderBottomWidth: stroke,
            borderColor: color,
            transform: [{ rotate: '-135deg' }],
          }}
        />
      </View>
    );
  }

  if (name === 'chevron-down' || name === 'chevron-right') {
    const rotate = name === 'chevron-down' ? '45deg' : '-45deg';
    return (
      <View
        style={{
          width: size * 0.48,
          height: size * 0.48,
          borderRightWidth: stroke,
          borderBottomWidth: stroke,
          borderColor: color,
          transform: [{ rotate }],
        }}
      />
    );
  }

  if (name === 'moon') {
    return (
      <View style={[styles.frame, { width: size, height: size }]}>
        <View
          style={{
            position: 'absolute',
            left: size * 0.08,
            bottom: size * 0.08,
            width: size * 0.72,
            height: size * 0.72,
            borderRadius: size,
            backgroundColor: color,
          }}
        >
          <View
            style={{
              position: 'absolute',
              width: size * 0.62,
              height: size * 0.62,
              borderRadius: size,
              backgroundColor,
              right: -size * 0.04,
              top: -size * 0.12,
            }}
          />
        </View>
        <View style={{ position: 'absolute', right: size * 0.02, top: size * 0.02 }}>
          <View
            style={{
              position: 'absolute',
              width: stroke,
              height: size * 0.3,
              borderRadius: stroke,
              backgroundColor: color,
              left: size * 0.15 - stroke / 2,
            }}
          />
          <View
            style={{
              width: size * 0.3,
              height: stroke,
              borderRadius: stroke,
              backgroundColor: color,
              top: size * 0.15 - stroke / 2,
            }}
          />
        </View>
      </View>
    );
  }

  if (name === 'sun') {
    return (
      <View style={[styles.frame, { width: size, height: size }]}>
        <View
          style={{
            width: size * 0.42,
            height: size * 0.42,
            borderRadius: size,
            borderWidth: stroke,
            borderColor: color,
          }}
        />
        {[0, 45, 90, 135].map((deg) => (
          <View
            key={deg}
            style={[
              line,
              {
                position: 'absolute',
                width: size * 0.92,
                transform: [{ rotate: `${deg}deg` }],
              },
            ]}
          >
            <View style={{ flex: 1 }} />
          </View>
        ))}
      </View>
    );
  }

  if (name === 'fit') {
    const corner = size * 0.3;
    return (
      <View style={[styles.frame, { width: size, height: size }]}>
        <View
          style={{
            position: 'absolute',
            top: size * 0.08,
            left: size * 0.08,
            width: corner,
            height: corner,
            borderTopWidth: stroke,
            borderLeftWidth: stroke,
            borderColor: color,
            borderTopLeftRadius: stroke,
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: size * 0.08,
            right: size * 0.08,
            width: corner,
            height: corner,
            borderTopWidth: stroke,
            borderRightWidth: stroke,
            borderColor: color,
            borderTopRightRadius: stroke,
          }}
        />
        <View
          style={{
            position: 'absolute',
            bottom: size * 0.08,
            left: size * 0.08,
            width: corner,
            height: corner,
            borderBottomWidth: stroke,
            borderLeftWidth: stroke,
            borderColor: color,
            borderBottomLeftRadius: stroke,
          }}
        />
        <View
          style={{
            position: 'absolute',
            bottom: size * 0.08,
            right: size * 0.08,
            width: corner,
            height: corner,
            borderBottomWidth: stroke,
            borderRightWidth: stroke,
            borderColor: color,
            borderBottomRightRadius: stroke,
          }}
        />
      </View>
    );
  }

  if (name === 'upload') {
    return (
      <View style={[styles.frame, { width: size, height: size }]}>
        <View style={[line, { position: 'absolute', width: size * 0.56, bottom: size * 0.12 }]} />
        <View
          style={{
            position: 'absolute',
            width: stroke,
            height: size * 0.55,
            backgroundColor: color,
            borderRadius: stroke,
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: size * 0.08,
            width: size * 0.35,
            height: size * 0.35,
            borderLeftWidth: stroke,
            borderTopWidth: stroke,
            borderColor: color,
            transform: [{ rotate: '45deg' }],
          }}
        />
      </View>
    );
  }

  if (name === 'link') {
    const capsule = {
      position: 'absolute' as const,
      width: size * 0.62,
      height: size * 0.34,
      borderWidth: stroke,
      borderColor: color,
      borderRadius: size,
    };
    return (
      <View style={[styles.frame, { width: size, height: size }]}>
        <View style={[capsule, { left: size * 0.02, transform: [{ rotate: '-38deg' }] }]} />
        <View style={[capsule, { right: size * 0.02, transform: [{ rotate: '-38deg' }] }]} />
        <View
          style={[
            line,
            { position: 'absolute', width: size * 0.34, transform: [{ rotate: '-38deg' }] },
          ]}
        />
      </View>
    );
  }

  // Two opposing arrows: direction is a first-class part of the forecast.
  return (
    <View style={[styles.frame, { width: size, height: size }]}>
      <View
        style={[
          line,
          {
            position: 'absolute',
            width: size * 0.7,
            top: size * 0.28,
            left: size * 0.1,
          },
        ]}
      />
      <View
        style={{
          position: 'absolute',
          right: size * 0.05,
          top: size * 0.14,
          width: size * 0.28,
          height: size * 0.28,
          borderRightWidth: stroke,
          borderTopWidth: stroke,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <View
        style={[
          line,
          {
            position: 'absolute',
            width: size * 0.7,
            bottom: size * 0.28,
            right: size * 0.1,
          },
        ]}
      />
      <View
        style={{
          position: 'absolute',
          left: size * 0.05,
          bottom: size * 0.14,
          width: size * 0.28,
          height: size * 0.28,
          borderLeftWidth: stroke,
          borderBottomWidth: stroke,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
