import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SkeletonBox } from './SkeletonBox';
import { SkeletonCircle } from './SkeletonCircle';
import { SkeletonText } from './SkeletonText';

export const HistorySkeleton: React.FC = () => {
  return (
    <View style={styles.timelineCard}>
      {/* Decorative vertical timeline line */}
      <View style={styles.timelineBarDecor} />

      <View style={{ gap: 16 }}>
        {[1, 2, 3, 4].map((item) => (
          <View key={item} style={styles.timelineItem}>
            {/* Timeline node icon */}
            <SkeletonCircle size={24} style={styles.timelineNode} />

            {/* Timeline item card */}
            <View style={styles.itemContentCard}>
              <View style={styles.itemHeader}>
                <View style={{ flex: 1, gap: 6 }}>
                  {/* Title and Badge */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <SkeletonText width="55%" height={14} borderRadius={3} />
                    <SkeletonBox width={46} height={16} borderRadius={6} />
                  </View>
                  {/* Date subtitle */}
                  <SkeletonText width="38%" height={10} borderRadius={3} />
                </View>

                {/* Amount and Box count */}
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <SkeletonText width={60} height={15} borderRadius={3} />
                  <SkeletonText width={70} height={10} borderRadius={3} />
                </View>
              </View>

              {/* Card Footer / Details row */}
              <View style={styles.itemFooterRow}>
                <SkeletonText width="70%" height={10} borderRadius={3} />
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  timelineCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#F3E8FF',
    padding: 16,
    position: 'relative',
  },
  timelineBarDecor: {
    position: 'absolute',
    left: 28,
    top: 24,
    bottom: 24,
    width: 2,
    backgroundColor: '#F3E8FF',
  },
  timelineItem: {
    flexDirection: 'row',
    gap: 12,
    position: 'relative',
  },
  timelineNode: {
    marginTop: 2,
    zIndex: 1,
  },
  itemContentCard: {
    flex: 1,
    backgroundColor: '#F8F6FF',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    gap: 10,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  itemFooterRow: {
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#F3E8FF',
  },
});
