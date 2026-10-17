import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SkeletonBox } from './SkeletonBox';
import { SkeletonCircle } from './SkeletonCircle';
import { SkeletonText } from './SkeletonText';

export const BillingSkeleton: React.FC = () => {
  return (
    <View style={styles.container}>
      {/* Search Input Placeholder */}
      <View style={styles.searchCard}>
        <View style={{ gap: 4, marginBottom: 8 }}>
          <SkeletonText width={120} height={14} borderRadius={4} />
          <SkeletonText width={160} height={10} borderRadius={3} />
        </View>
        <SkeletonBox width="100%" height={44} borderRadius={14} />
      </View>

      {/* Cart Items List Header */}
      <View style={styles.cartHeaderRow}>
        <SkeletonText width={110} height={15} borderRadius={4} />
        <SkeletonText width={70} height={12} borderRadius={3} />
      </View>

      {/* Cart Item Placeholders */}
      <View style={{ gap: 10, marginBottom: 16 }}>
        {[1, 2].map((item) => (
          <View key={item} style={styles.cartItemCard}>
            <View style={styles.cartItemTop}>
              {/* Tile Swatch */}
              <SkeletonBox width={44} height={44} borderRadius={12} />

              <View style={{ flex: 1, gap: 5 }}>
                <SkeletonText width="60%" height={14} borderRadius={3} />
                <SkeletonText width="45%" height={10} borderRadius={3} />
              </View>

              <SkeletonText width={55} height={16} borderRadius={3} />
            </View>

            {/* Stepper & Price Row */}
            <View style={styles.cartItemBottom}>
              <SkeletonBox width={100} height={32} borderRadius={10} />
              <SkeletonText width={80} height={14} borderRadius={4} />
            </View>
          </View>
        ))}
      </View>

      {/* Pricing Summary Card Placeholder */}
      <View style={styles.calcSummaryCard}>
        <View style={styles.summaryRow}>
          <SkeletonText width={80} height={12} borderRadius={3} />
          <SkeletonText width={60} height={12} borderRadius={3} />
        </View>
        <View style={styles.summaryRow}>
          <SkeletonText width={90} height={12} borderRadius={3} />
          <SkeletonText width={50} height={12} borderRadius={3} />
        </View>
        <View style={styles.summaryRow}>
          <SkeletonText width={100} height={12} borderRadius={3} />
          <SkeletonText width={70} height={12} borderRadius={3} />
        </View>
        <View style={styles.divider} />
        <View style={styles.summaryRow}>
          <SkeletonText width={90} height={16} borderRadius={4} />
          <SkeletonText width={80} height={18} borderRadius={4} />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  searchCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F3E8FF',
    boxShadow: '0px 2px 8px rgba(0,0,0,0.03)',
  },
  cartHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cartItemCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    gap: 12,
    boxShadow: '0px 2px 8px rgba(124, 58, 237, 0.04)',
  },
  cartItemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cartItemBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3E8FF',
  },
  calcSummaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F3E8FF',
    gap: 12,
    marginBottom: 20,
    boxShadow: '0px 2px 8px rgba(0,0,0,0.03)',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: '#F3E8FF',
    marginVertical: 4,
  },
});
