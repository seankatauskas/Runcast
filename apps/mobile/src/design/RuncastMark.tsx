import Svg, { Path } from 'react-native-svg';
import { RuncastBrand, RuncastGeometry } from './runcastGeometry';

export interface RuncastMarkProps {
  /** Width and height in logical pixels. */
  size?: number;
  /** Background paint. Pass null for transparent artwork. */
  background?: string | null;
  markColor?: string;
  dotColor?: string;
  dotOutlineColor?: string;
  dotOutlineWidth?: number;
  /** Uses compact framing and the strengthened 16–31px dot ring. */
  micro?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * Canonical Forward Terminals RC monogram. Geometry is generated from the
 * shared brand master; defaults are the locked product specification.
 */
export function RuncastMark({
  size = 32,
  background = RuncastBrand.black,
  markColor = RuncastBrand.teal,
  dotColor = RuncastBrand.black,
  dotOutlineColor = RuncastBrand.teal,
  dotOutlineWidth,
  micro = false,
  accessibilityLabel,
  testID,
}: RuncastMarkProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox={micro ? RuncastGeometry.compactViewBox : RuncastGeometry.viewBox}
      accessible={accessibilityLabel ? true : undefined}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={background ? { backgroundColor: background } : undefined}
    >
      <Path d={RuncastGeometry.bodyPath} fill={markColor} fillRule="evenodd" />
      <Path
        d={RuncastGeometry.dotPath}
        fill={dotColor}
        stroke={dotOutlineColor}
        strokeWidth={
          dotOutlineWidth ??
          (micro ? RuncastBrand.microDotOutlineWidth : RuncastBrand.dotOutlineWidth)
        }
        strokeLinejoin="round"
        fillRule="evenodd"
      />
    </Svg>
  );
}
