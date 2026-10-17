import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SkeletonBox } from './SkeletonBox';
import { SkeletonText } from './SkeletonText';

export const AnalyticsSkeleton: React.FC = () => {
  return (
    <View style={styles.container}>
      {/* 4 KPI Summary Cards (2x2 Grid) */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <SkeletonBox width={26} height={26} borderRadius={8} />
          <SkeletonText width={80} height={10} borderRadius={3} />
          <SkeletonText width={100} height={20} borderRadius={4} />
        </View>
        <View style={styles.statCard}>
          <SkeletonBox width={26} height={26} borderRadius={8} />
          <SkeletonText width={90} height={10} borderRadius={3} />
          <SkeletonText width={90} height={20} borderRadius={4} />
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <SkeletonText width={85} height={10} borderRadius={3} />
          <SkeletonText width={60} height={18} borderRadius={4} />
        </View>
        <View style={styles.statCard}>
          <SkeletonText width={70} height={10} borderRadius={3} />
          <SkeletonText width={85} height={18} borderRadius={4} />
        </View>
      </View>

      {/* Large Chart/Graph Placeholder Card 1 */}
      <View style={styles.chartCard}>
        <SkeletonText width={160} height={12} borderRadius={3} />
        <View style={{ gap: 12, marginTop: 14 }}>
          {[1, 2, 3, 4].map((i) => (
            <View key={i} style={styles.paymentRow}>
              <SkeletonText width={70} height={13} borderRadius={3} />
              <SkeletonText width={90} height={13} borderRadius={3} />
            </View>
          ))}
        </View>
      </View>

      {/* Large Chart/Graph Placeholder Card 2 */}
      <View style={styles.chartCard}>
        <SkeletonText width={140} height={12} borderRadius={3} />
        <View style={{ gap: 10, marginTop: 14 }}>
          <SkeletonBox width="100%" height={16} borderRadius={6} />
          <SkeletonBox width="85%" height={16} borderRadius={6} />
          <SkeletonBox width="70%" height={16} borderRadius={6} />
          <SkeletonBox width="55%" height={16} borderRadius={6} />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 16,
    paddingTop: 10,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    gap: 8,
  },
  chartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E9D5FF',
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F3E8FF',
  },
});
