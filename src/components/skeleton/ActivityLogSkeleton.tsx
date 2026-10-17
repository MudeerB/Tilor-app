import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SkeletonCircle } from './SkeletonCircle';
import { SkeletonText } from './SkeletonText';

export const ActivityLogSkeleton: React.FC = () => {
  return (
    <View style={styles.container}>
      {[1, 2, 3, 4, 5].map((item) => (
        <View key={item} style={styles.logCard}>
          {/* Action category circle icon */}
          <SkeletonCircle size={40} style={styles.iconCircle} />

          {/* Action details */}
          <View style={styles.logContent}>
            <SkeletonText width="75%" height={14} borderRadius={3} />
            <View style={styles.logMeta}>
              <SkeletonText width={80} height={11} borderRadius={3} />
              <SkeletonText width={110} height={11} borderRadius={3} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
  },
  logCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    boxShadow: '0px 2px 8px rgba(124, 58, 237, 0.04)',
  },
  iconCircle: {
    marginRight: 12,
  },
  logContent: {
    flex: 1,
    gap: 6,
  },
  logMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
});
