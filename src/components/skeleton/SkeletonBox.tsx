import React from 'react';
import { ViewStyle, DimensionValue, StyleProp } from 'react-native';
import { SkeletonBase } from './SkeletonBase';

interface SkeletonBoxProps {
  width?: DimensionValue;
  height?: DimensionValue;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

export const SkeletonBox: React.FC<SkeletonBoxProps> = ({
  width = '100%',
  height = 20,
  borderRadius = 8,
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
