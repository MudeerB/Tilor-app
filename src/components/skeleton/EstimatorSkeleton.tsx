import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SkeletonBox } from './SkeletonBox';
import { SkeletonCircle } from './SkeletonCircle';
import { SkeletonText } from './SkeletonText';

export const EstimatorSkeleton: React.FC = () => {
  return (
    <View style={styles.container}>
      {/* 2 Room Card Placeholders */}
      {[1, 2].map((item) => (
        <View key={item} style={styles.roomCard}>
          {/* Room Header Accordion Row */}
          <View style={styles.roomHeader}>
            <SkeletonCircle size={32} />
            <View style={{ flex: 1, gap: 5 }}>
              <SkeletonText width="50%" height={15} borderRadius={4} />
              <SkeletonText width="35%" height={11} borderRadius={3} />
            </View>
            <SkeletonCircle size={20} />
          </View>

          {/* Dimension Inputs Row */}
          <View style={styles.dimensionsRow}>
            <View style={{ flex: 1, gap: 4 }}>
              <SkeletonText width={40} height={10} borderRadius={2} />
              <SkeletonBox width="100%" height={36} borderRadius={10} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <SkeletonText width={40} height={10} borderRadius={2} />
              <SkeletonBox width="100%" height={36} borderRadius={10} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <SkeletonText width={40} height={10} borderRadius={2} />
              <SkeletonBox width="100%" height={36} borderRadius={10} />
            </View>
          </View>

          {/* Tile Swatch Selector Box */}
          <View style={styles.tileSelectorBox}>
            <SkeletonBox width={40} height={40} borderRadius={10} />
            <View style={{ flex: 1, gap: 4 }}>
              <SkeletonText width="65%" height={13} borderRadius={3} />
              <SkeletonText width="45%" height={10} borderRadius={3} />
            </View>
            <SkeletonBox width={65} height={28} borderRadius={8} />
          </View>
        </View>
      ))}

      {/* Calculation Summary Card */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <SkeletonText width={90} height={13} borderRadius={3} />
          <SkeletonText width={60} height={13} borderRadius={3} />
        </View>
        <View style={styles.summaryRow}>
          <SkeletonText width={100} height={13} borderRadius={3} />
          <SkeletonText width={70} height={13} borderRadius={3} />
        </View>
        <View style={styles.summaryRow}>
          <SkeletonText width={110} height={16} borderRadius={4} />
          <SkeletonText width={80} height={18} borderRadius={4} />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 14,
    paddingTop: 8,
  },
  roomCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    gap: 14,
    boxShadow: '0px 2px 10px rgba(124, 58, 237, 0.05)',
  },
  roomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dimensionsRow: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#F8F6FF',
    padding: 12,
    borderRadius: 14,
  },
  tileSelectorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 4,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    gap: 12,
    marginTop: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
