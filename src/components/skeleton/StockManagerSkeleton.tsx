import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SkeletonBox } from './SkeletonBox';
import { SkeletonText } from './SkeletonText';

export const StockManagerSkeleton: React.FC = () => {
  return (
    <View style={styles.container}>
      {[1, 2, 3, 4, 5].map((item) => (
        <View key={item} style={styles.productCard}>
          {/* Card Top Row: Swatch + Title/specs + Total Stock */}
          <View style={styles.productTopRow}>
            {/* Swatch Square */}
            <SkeletonBox width={40} height={40} borderRadius={10} />

            <View style={{ flex: 1, gap: 5 }}>
              <SkeletonText width="60%" height={15} borderRadius={4} />
              <SkeletonText width="45%" height={11} borderRadius={3} />
            </View>

            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <SkeletonText width={50} height={16} borderRadius={3} />
              <SkeletonText width={55} height={10} borderRadius={3} />
            </View>
          </View>

          {/* Variants Breakdown Box */}
          <View style={styles.variantsBreakdownBox}>
            <View style={styles.vBreakdownItem}>
              <SkeletonText width="45%" height={11} borderRadius={3} />
              <SkeletonText width="45%" height={11} borderRadius={3} />
            </View>
          </View>

          {/* Card Actions Row */}
          <View style={styles.productActionsRow}>
            <SkeletonBox width="60%" height={32} borderRadius={10} />
            <SkeletonBox width="35%" height={32} borderRadius={10} />
          </View>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 12,
  },
  productCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    gap: 12,
    boxShadow: '0px 2px 8px rgba(124, 58, 237, 0.04)',
  },
  productTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  variantsBreakdownBox: {
    backgroundColor: '#F8F6FF',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E9D5FF',
  },
  vBreakdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  productActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3E8FF',
  },
});
