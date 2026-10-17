import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SkeletonBox } from './SkeletonBox';
import { SkeletonCircle } from './SkeletonCircle';
import { SkeletonText } from './SkeletonText';

export const DashboardKpiSkeleton: React.FC = () => {
  return (
    <View style={styles.unifiedCard}>
      {/* Top Header Row */}
      <View style={styles.topRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <SkeletonCircle size={28} style={{ borderRadius: 8 }} />
          <SkeletonText width={130} height={13} borderRadius={4} />
        </View>
        <SkeletonBox width={85} height={18} borderRadius={6} />
      </View>

      {/* Hero Revenue Number */}
      <View style={{ marginTop: 12, marginBottom: 8 }}>
        <SkeletonText width={170} height={28} borderRadius={6} />
      </View>

      {/* Meta Row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <SkeletonBox width={65} height={16} borderRadius={6} />
        <SkeletonText width={110} height={12} borderRadius={3} />
      </View>

      {/* Embedded Sub-Row: 2 mini cards */}
      <View style={styles.subRow}>
        <View style={styles.miniCol}>
          <SkeletonText width={70} height={10} borderRadius={3} />
          <View style={{ marginTop: 6, marginBottom: 4 }}>
            <SkeletonText width={80} height={16} borderRadius={4} />
          </View>
          <SkeletonText width={90} height={9} borderRadius={3} />
        </View>
        <View style={styles.miniCol}>
          <SkeletonText width={70} height={10} borderRadius={3} />
          <View style={{ marginTop: 6, marginBottom: 4 }}>
            <SkeletonText width={60} height={16} borderRadius={4} />
          </View>
          <SkeletonText width={80} height={9} borderRadius={3} />
        </View>
      </View>
    </View>
  );
};

export const DashboardActivitySkeleton: React.FC = () => {
  return (
    <View style={styles.activityFeed}>
      <View style={{ width: '100%', gap: 10 }}>
        {[1, 2, 3].map((item, idx) => (
          <View
            key={item}
            style={[
              styles.activityRow,
              idx === 2 && { borderBottomWidth: 0 },
            ]}
          >
            <SkeletonCircle size={32} />
            <View style={{ flex: 1, gap: 5 }}>
              <SkeletonText width="55%" height={13} borderRadius={3} />
              <SkeletonText width="75%" height={10} borderRadius={3} />
            </View>
            <SkeletonBox width={54} height={16} borderRadius={6} />
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  unifiedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#F1EDFC',
    padding: 16,
    marginBottom: 14,
    shadowColor: '#6D28D9',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  subRow: {
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },
  miniCol: {
    flex: 1,
    backgroundColor: '#FAF9FE',
    borderWidth: 1,
    borderColor: '#F1EDFC',
    borderRadius: 12,
    padding: 10,
  },
  activityFeed: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#F3E8FF',
    padding: 16,
    minHeight: 100,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F8F6FF',
    gap: 12,
  },
});
