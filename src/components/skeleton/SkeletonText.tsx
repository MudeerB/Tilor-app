import React from 'react';
import { ViewStyle, DimensionValue, StyleProp } from 'react-native';
import { SkeletonBase } from './SkeletonBase';

interface SkeletonTextProps {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

export const SkeletonText: React.FC<SkeletonTextProps> = ({
  width = '80%',
  height = 12,
  borderRadius = 4,
  style,
}) => {
  return (
    <SkeletonBase
      style={[
        {
          width,
          height,
          borderRadius,
        },
        style,
      ]}
    />
  );
};
