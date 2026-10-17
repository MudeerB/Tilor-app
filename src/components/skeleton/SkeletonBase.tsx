import React, { useEffect, useRef } from 'react';
import { Animated, ViewStyle, StyleProp } from 'react-native';

export interface SkeletonBaseProps {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export const SkeletonBase: React.FC<SkeletonBaseProps> = ({ style, children }) => {
  const opacityAnim = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacityAnim, {
          toValue: 0.85,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0.35,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [opacityAnim]);

  return (
    <Animated.View
      style={[
        { backgroundColor: '#E2E8F0', borderRadius: 8 },
        style,
        { opacity: opacityAnim },
      ]}
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
    >
      {children}
    </Animated.View>
  );
};
