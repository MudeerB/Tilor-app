import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SkeletonBox } from './SkeletonBox';
import { SkeletonCircle } from './SkeletonCircle';
import { SkeletonText } from './SkeletonText';

export const KhatabookSkeleton: React.FC = () => {
  return (
    <View style={styles.container}>
      {/* Search Input Placeholder */}
      <View style={styles.searchBar}>
        <SkeletonCircle size={16} />
        <SkeletonText width="65%" height={14} borderRadius={4} />
      </View>

      {/* Filter Chips Placeholder */}
      <View style={styles.filterRow}>
        <SkeletonBox width={110} height={30} borderRadius={18} />
        <SkeletonBox width={90} height={30} borderRadius={18} />
        <SkeletonBox width={100} height={30} borderRadius={18} />
      </View>

      {/* 4 Customer Credit Card Placeholders */}
      <View style={styles.debtorList}>
        {[1, 2, 3, 4].map((item) => (
          <View key={item} style={styles.debtorCard}>
            {/* Card Header Row */}
            <View style={styles.debtorHeaderRow}>
              {/* Avatar Circle */}
              <SkeletonCircle size={44} style={styles.avatar} />

              <View style={{ flex: 1, gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <SkeletonText width="50%" height={15} borderRadius={4} />
                  <SkeletonBox width={64} height={18} borderRadius={6} />
                </View>
                <SkeletonText width="40%" height={11} borderRadius={3} />
                <SkeletonText width="55%" height={11} borderRadius={3} />
              </View>

              {/* Debt Amount Tag */}
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <SkeletonText width={60} height={18} borderRadius={4} />
                <SkeletonText width={48} height={10} borderRadius={3} />
              </View>
            </View>

            {/* Quick Actions Row */}
            <View style={styles.actionsRow}>
              <SkeletonBox width="48%" height={34} borderRadius={10} />
              <SkeletonBox width="48%" height={34} borderRadius={10} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: '#F3E8FF',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  debtorList: {
    gap: 12,
    paddingBottom: 20,
  },
  debtorCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FEE2E2',
    gap: 12,
    boxShadow: '0px 2px 8px rgba(0,0,0,0.03)',
  },
  debtorHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    marginRight: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#FEE2E2',
  },
});
