import React from 'react';
import { ViewStyle, StyleProp } from 'react-native';
import { SkeletonBase } from './SkeletonBase';

interface SkeletonCircleProps {
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export const SkeletonCircle: React.FC<SkeletonCircleProps> = ({ size = 32, style }) => {
  return (
    <SkeletonBase
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
        style,
      ]}
    />
  );
};
