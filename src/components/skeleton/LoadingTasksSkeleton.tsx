import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SkeletonBox } from './SkeletonBox';
import { SkeletonCircle } from './SkeletonCircle';
import { SkeletonText } from './SkeletonText';

export const LoadingTasksSkeleton: React.FC = () => {
  return (
    <View style={styles.container}>
      {/* 3 Dispatch Task Card Placeholders */}
      {[1, 2, 3].map((item) => (
        <View key={item} style={styles.taskCard}>
          <View style={styles.taskHeader}>
            <View style={{ flex: 1, gap: 6 }}>
              {/* Customer Name */}
              <SkeletonText width="65%" height={16} borderRadius={4} />
              {/* Invoice Pill & Date subtitle */}
              <SkeletonText width="45%" height={12} borderRadius={3} />
            </View>

            <View style={{ alignItems: 'flex-end', marginLeft: 10, gap: 6 }}>
              {/* Status Badge Pill */}
              <SkeletonBox width={64} height={20} borderRadius={6} />
              {/* Progress Text */}
              <SkeletonText width={76} height={11} borderRadius={3} />
            </View>
          </View>
        </View>
      ))}

      {/* Pagination Controls Placeholder */}
      <View style={styles.paginationRow}>
        <SkeletonCircle size={40} />
        <SkeletonText width={100} height={14} borderRadius={4} />
        <SkeletonCircle size={40} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  taskCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    boxShadow: '0px 2px 12px rgba(124, 58, 237, 0.05)',
  },
  taskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  paginationRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    paddingBottom: 24,
    gap: 16,
  },
});
