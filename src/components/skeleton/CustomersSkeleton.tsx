import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SkeletonBox } from './SkeletonBox';
import { SkeletonCircle } from './SkeletonCircle';
import { SkeletonText } from './SkeletonText';

export const CustomersSkeleton: React.FC = () => {
  return (
    <View style={styles.listContainer}>
      {[1, 2, 3, 4].map((item) => (
        <View key={item} style={styles.customerCard}>
          {/* Card Top Row: Avatar + Info + Balance badge */}
          <View style={styles.cardTopRow}>
            {/* Avatar Circle */}
            <SkeletonCircle size={44} style={styles.avatar} />

            <View style={{ flex: 1, gap: 6 }}>
              {/* Customer Name */}
              <SkeletonText width="55%" height={15} borderRadius={4} />
              {/* Phone */}
              <SkeletonText width="40%" height={11} borderRadius={3} />
              {/* GSTIN or Address */}
              <SkeletonText width="65%" height={11} borderRadius={3} />
            </View>

            {/* Spent / Credit Badge */}
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <SkeletonText width={60} height={16} borderRadius={4} />
              <SkeletonText width={48} height={10} borderRadius={3} />
            </View>
          </View>

          {/* Quick Contact & Action Buttons */}
          <View style={styles.cardActionsRow}>
            <SkeletonBox width="30%" height={32} borderRadius={10} />
            <SkeletonBox width="30%" height={32} borderRadius={10} />
            <SkeletonBox width="34%" height={32} borderRadius={10} />
          </View>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  listContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 12,
    paddingBottom: 24,
  },
  customerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F3E8FF',
    gap: 12,
    boxShadow: '0px 2px 8px rgba(0,0,0,0.03)',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    marginRight: 2,
  },
  cardActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3E8FF',
  },
});
