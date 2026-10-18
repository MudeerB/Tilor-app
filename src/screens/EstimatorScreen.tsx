import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
  StatusBar,
  Alert,
  FlatList,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BottomNavBar, NavTab } from '../components/BottomNavBar';
import { UserSession } from '../services/storage';
import { TileCollection, TileVariant, VariantType } from '../types/tiles';
import { catalogService } from '../services/catalog';
import { billingService } from '../services/billing';
import { SEED_CATALOG } from '../data/seed-catalog';
import { EstimatorSkeleton } from '../components/skeleton';
import { hapticFeedback } from '../utils/haptics';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VariantAllocation {
  variantType: VariantType;
  label: string;
  tiles: string;           // Direct tiles input string
  lines: number;           // Line step count
  calculatedTiles: number; // Derived tiles count
  boxes: number;           // Derived boxes
  pricePerBox: number;
  totalAmount: number;     // Derived total amount
  color: string;
  variantId?: string;
}

export interface RoomItem {
  id: string;
  name: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  length: string;
  width: string;
  sqft: number;
  selectedCollection: TileCollection | null;
  boxes: number;
  pricePerBox: number;
  priceOverride?: string;  // Custom rate per box override
  totalAmount: number;
  calcMode?: 'total_tiles' | 'lines';
  tilesPerLine?: string;
  variantAllocations?: VariantAllocation[];
  isOpen: boolean;
}

interface VariantStockCheck {
  variantId: string;
  collectionName: string;
  variantLabel: string;
  requiredBoxes: number;
  availableStock: number;
  exceedsStock: boolean;
}

const DRAFT_KEY = 'tilor_current_draft';
const SAVED_ESTIMATE_KEY = 'tilor_saved_estimate';
const PENDING_BILL_KEY = 'tilor_pending_bill';

const PRESETS = {
  '1bhk': [
    { name: 'Living Room', icon: 'tv' as const },
    { name: 'Bedroom',     icon: 'home' as const },
    { name: 'Kitchen',     icon: 'coffee' as const },
    { name: 'Bathroom',    icon: 'droplet' as const },
  ],
  '2bhk': [
    { name: 'Living Room', icon: 'tv' as const },
    { name: 'Bedroom 1',   icon: 'home' as const },
    { name: 'Bedroom 2',   icon: 'home' as const },
    { name: 'Kitchen',     icon: 'coffee' as const },
    { name: 'Bathroom 1',  icon: 'droplet' as const },
    { name: 'Bathroom 2',  icon: 'droplet' as const },
  ],
  '3bhk': [
    { name: 'Living Room', icon: 'tv' as const },
    { name: 'Bedroom 1',   icon: 'home' as const },
    { name: 'Bedroom 2',   icon: 'home' as const },
    { name: 'Bedroom 3',   icon: 'home' as const },
    { name: 'Kitchen',     icon: 'coffee' as const },
    { name: 'Dining',      icon: 'heart' as const },
    { name: 'Bathroom 1',  icon: 'droplet' as const },
    { name: 'Bathroom 2',  icon: 'droplet' as const },
  ],
};

// ─── Calculation Helpers ─────────────────────────────────────────────────────

function createDefaultAllocations(collection: TileCollection, roomName: string): VariantAllocation[] {
  const isKitchen = roomName.toLowerCase().includes('kitchen');

  let allowedVariants = collection.variants;
  if (isKitchen) {
    allowedVariants = collection.variants.filter(v => v.type === 'light' || v.type === 'highlighter');
  }

  return allowedVariants.map(v => ({
    variantType: v.type,
    label: v.label,
    tiles: '',
    lines: v.type === 'light' ? 4 : v.type === 'highlighter' ? 2 : v.type === 'dark' ? 2 : 0,
    calculatedTiles: 0,
    boxes: 0,
    pricePerBox: v.pricePerBox,
    totalAmount: 0,
    color: v.color,
    variantId: v.id,
  }));
}

// ─── Memoized Room Summary Row ───────────────────────────────────────────────

interface RoomSummaryRowProps {
  room: RoomItem;
}

const RoomSummaryRow = React.memo<RoomSummaryRowProps>(({ room: r }) => (
  <View style={styles.summaryItemRow}>
    <Text style={styles.summaryItemName} numberOfLines={1}>{r.name}</Text>
    <Text style={styles.summaryItemSpecs}>{r.sqft > 0 ? `${r.sqft} sqft · ` : ''}{r.boxes} bx</Text>
    <Text style={styles.summaryItemAmount}>₹{r.totalAmount.toLocaleString('en-IN')}</Text>
  </View>
));
RoomSummaryRow.displayName = 'RoomSummaryRow';

function computeVariantAllocations(
  allocations: VariantAllocation[],
  calcMode: 'total_tiles' | 'lines',
  tilesPerLineStr: string,
  tilesPerBox: number,
  wastagePct: number
): { updatedAllocations: VariantAllocation[]; totalBoxes: number; totalAmount: number } {
  const tilesPerLine = parseInt(tilesPerLineStr) || 8;
  let totalBoxes = 0;
  let totalAmount = 0;

  const updatedAllocations = allocations.map(alloc => {
    let rawTiles = 0;
    if (calcMode === 'lines') {
      rawTiles = alloc.lines * tilesPerLine;
    } else {
      rawTiles = parseInt(alloc.tiles) || 0;
    }

    const cushionFactor = 1 + wastagePct / 100;
    const tilesWithCushion = Math.round(rawTiles * cushionFactor);
    const boxes = tilesWithCushion > 0 ? Math.ceil(tilesWithCushion / tilesPerBox) : 0;
    const amount = boxes * alloc.pricePerBox;

    totalBoxes += boxes;
    totalAmount += amount;

    return {
      ...alloc,
      calculatedTiles: tilesWithCushion,
      boxes,
      totalAmount: amount,
    };
  });

  return { updatedAllocations, totalBoxes, totalAmount };
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface EstimatorScreenProps {
  session: UserSession;
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onLogout: () => void;
}

export const EstimatorScreen: React.FC<EstimatorScreenProps> = ({
  session,
  activeTab,
  onTabChange,
  onLogout,
}) => {
  const [projectName, setProjectName]     = useState('');
  const [rooms, setRooms]                 = useState<RoomItem[]>([]);
  const [catalog, setCatalog]             = useState<TileCollection[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [summaryOpen, setSummaryOpen]     = useState(true);
  const [wastagePercent, setWastagePercent] = useState<number>(10);

  // Saved Estimates Modal & State
  const [savedEstimatesModalVisible, setSavedEstimatesModalVisible] = useState(false);
  const [savedEstimatesList, setSavedEstimatesList]                 = useState<any[]>([]);
  const [currentEstimateId, setCurrentEstimateId]                   = useState<string | null>(null);

  // Bottom Sheet Modal states
  const [cushionModalVisible, setCushionModalVisible]     = useState(false);
  const [templatesModalVisible, setTemplatesModalVisible] = useState(false);
  const [tilePickerVisible, setTilePickerVisible]         = useState(false);
  const [targetRoomId, setTargetRoomId]                   = useState<string | null>(null);
  const [tileSearch, setTileSearch]                       = useState('');
  const [sizeFilter, setSizeFilter]                       = useState('all');
  const [clearModalVisible, setClearModalVisible]         = useState(false);

  // Fetch saved estimates list for the modal
  const fetchSavedEstimatesList = useCallback(async () => {
    try {
      const list = await billingService.fetchEstimates(session.shop_id);
      setSavedEstimatesList(list);
    } catch {
      setSavedEstimatesList([]);
    }
  }, [session.shop_id]);

  // Load catalog & existing draft
  const loadData = useCallback(async () => {
    setLoadingCatalog(true);
    try {
      // 1. Load catalog from Supabase (scoped to current shop)
      const liveCatalog = await catalogService.fetchCatalog(session.shop_id);
      if (liveCatalog && liveCatalog.length > 0) {
        setCatalog(liveCatalog);
      } else {
        setCatalog(SEED_CATALOG);
      }

      // 2. Load draft from storage
      const storedDraft = await AsyncStorage.getItem(DRAFT_KEY);
      if (storedDraft) {
        const parsed = JSON.parse(storedDraft);
        if (parsed.projectName) setProjectName(parsed.projectName);
        if (parsed.rooms && Array.isArray(parsed.rooms)) setRooms(parsed.rooms);
        if (typeof parsed.wastagePercent === 'number') setWastagePercent(parsed.wastagePercent);
        if (parsed.id || parsed.dbId) setCurrentEstimateId(parsed.id || parsed.dbId);
      } else {
        setProjectName('');
        setRooms([]);
        setWastagePercent(10);
        setCurrentEstimateId(null);
      }

      // 3. Fetch saved estimates list
      fetchSavedEstimatesList();
    } catch (e) {
      console.error('Error fetching catalog/draft in EstimatorScreen:', e);
      setCatalog(SEED_CATALOG);
    } finally {
      setLoadingCatalog(false);
    }
  }, [session.shop_id, fetchSavedEstimatesList]);

  useEffect(() => {
    if (activeTab === 'estimator') {
      loadData();
    }
  }, [activeTab, loadData]);

  // Aggregate Stock Calculator
  const stockSummary = useMemo(() => {
    const map = new Map<string, {
      variantId: string;
      collectionName: string;
      variantLabel: string;
      requiredBoxes: number;
      availableStock: number;
    }>();

    rooms.forEach(room => {
      if (!room.selectedCollection) return;
      const col = room.selectedCollection;

      if (col.is12x18 && room.variantAllocations) {
        room.variantAllocations.forEach(alloc => {
          if (alloc.boxes <= 0) return;
          const v = col.variants.find(varItem => varItem.type === alloc.variantType);
          const vId = v?.id || alloc.variantId || `${col.id}_${alloc.variantType}`;
          const stock = v ? v.stock : 999;
          const label = v ? v.label : alloc.label;

          const existing = map.get(vId) || {
            variantId: vId,
            collectionName: col.name,
            variantLabel: label,
            requiredBoxes: 0,
            availableStock: stock,
          };
          existing.requiredBoxes += alloc.boxes;
          map.set(vId, existing);
        });
      } else if (col.variants && col.variants.length > 0) {
        const defaultVar = col.variants[0];
        if (room.boxes <= 0) return;
        const vId = defaultVar.id || col.id;
        const stock = defaultVar.stock;
        const label = defaultVar.label || 'Standard';

        const existing = map.get(vId) || {
          variantId: vId,
          collectionName: col.name,
          variantLabel: label,
          requiredBoxes: 0,
          availableStock: stock,
        };
        existing.requiredBoxes += room.boxes;
        map.set(vId, existing);
      }
    });

    const items: VariantStockCheck[] = Array.from(map.values()).map(item => ({
      ...item,
      exceedsStock: item.requiredBoxes > item.availableStock,
    }));

    const violations = items.filter(i => i.exceedsStock);
    return { items, violations, hasViolations: violations.length > 0 };
  }, [rooms]);

  // Recalculate room standard values (for non 12×18 tiles)
  const recalculateStandardRoom = (
    lStr: string,
    wStr: string,
    collection: TileCollection | null,
    priceOverrideStr?: string,
    wastage: number = wastagePercent
  ) => {
    const l = parseFloat(lStr) || 0;
    const w = parseFloat(wStr) || 0;
    const netSqft = Math.round(l * w);
    const sqftWithWastage = netSqft * (1 + wastage / 100);
    const defaultVar = collection?.variants[0];
    const sqftPerBox = collection ? collection.sqftPerBox || 16 : 16;
    const boxes = collection && netSqft > 0 ? Math.ceil(sqftWithWastage / sqftPerBox) : 0;
    
    const catalogPrice = defaultVar ? defaultVar.pricePerBox : 0;
    const effectivePrice = priceOverrideStr !== undefined && priceOverrideStr.trim() !== ''
      ? (parseFloat(priceOverrideStr) || 0)
      : catalogPrice;

    const totalAmount = boxes * effectivePrice;

    return { sqft: netSqft, boxes, pricePerBox: catalogPrice, totalAmount };
  };

  const handleWastageChange = (percent: number) => {
    setWastagePercent(percent);
    setRooms(prev =>
      prev.map(r => {
        if (r.selectedCollection?.is12x18 && r.variantAllocations) {
          const { updatedAllocations, totalBoxes, totalAmount } = computeVariantAllocations(
            r.variantAllocations,
            r.calcMode || 'lines',
            r.tilesPerLine || '8',
            r.selectedCollection.tilesPerBox || 8,
            percent
          );
          return {
            ...r,
            variantAllocations: updatedAllocations,
            boxes: totalBoxes,
            totalAmount,
          };
        } else {
          const calc = recalculateStandardRoom(r.length, r.width, r.selectedCollection, r.priceOverride, percent);
          return { ...r, ...calc };
        }
      })
    );
  };

  // Preset Handlers with Confirmation Protection
  const applyPresetNow = (key: keyof typeof PRESETS) => {
    hapticFeedback.light();
    const items = PRESETS[key];
    const newRooms: RoomItem[] = items.map((item, idx) => ({
      id: `room_${Date.now()}_${idx}`,
      name: item.name,
      icon: item.icon,
      length: '',
      width: '',
      sqft: 0,
      selectedCollection: null,
      boxes: 0,
      pricePerBox: 0,
      totalAmount: 0,
      calcMode: 'lines',
      tilesPerLine: '8',
      isOpen: idx === 0,
    }));
    setRooms(newRooms);
  };

  const applyPreset = (key: keyof typeof PRESETS) => {
    if (rooms.length > 0) {
      Alert.alert(
        'Replace Existing Rooms?',
        'Applying a preset will clear your current room list and replace it with the preset template.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Replace', style: 'destructive', onPress: () => applyPresetNow(key) }
        ]
      );
    } else {
      applyPresetNow(key);
    }
  };

  const addCustomRoom = () => {
    hapticFeedback.light();
    const newRoom: RoomItem = {
      id: `room_${Date.now()}`,
      name: `Room ${rooms.length + 1}`,
      icon: 'box',
      length: '',
      width: '',
      sqft: 0,
      selectedCollection: null,
      boxes: 0,
      pricePerBox: 0,
      totalAmount: 0,
      calcMode: 'lines',
      tilesPerLine: '8',
      isOpen: true,
    };
    setRooms(prev => prev.map(r => ({ ...r, isOpen: false })).concat(newRoom));
  };

  // Deep Clone Room Handler
  const duplicateRoom = (roomId: string) => {
    const source = rooms.find(r => r.id === roomId);
    if (!source) return;
    const copy: RoomItem = {
      ...source,
      id: `room_${Date.now()}`,
      name: `${source.name} (Copy)`,
      isOpen: true,
      variantAllocations: source.variantAllocations
        ? source.variantAllocations.map(a => ({ ...a }))
        : undefined,
    };
    setRooms(prev => [...prev, copy]);
  };

  const moveRoom = (roomId: string, direction: 'up' | 'down') => {
    setRooms(prev => {
      const idx = prev.findIndex(r => r.id === roomId);
      if (idx === -1) return prev;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const updated = [...prev];
      [updated[idx], updated[targetIdx]] = [updated[targetIdx], updated[idx]];
      return updated;
    });
  };

  const renameRoom = (roomId: string, newName: string) => {
    setRooms(prev => prev.map(r => r.id === roomId ? { ...r, name: newName } : r));
  };

  const updatePriceOverride = (roomId: string, val: string) => {
    setRooms(prev =>
      prev.map(r => {
        if (r.id !== roomId) return r;
        const calc = recalculateStandardRoom(r.length, r.width, r.selectedCollection, val);
        return {
          ...r,
          priceOverride: val,
          ...calc,
        };
      })
    );
  };

  const deleteRoom = (roomId: string) => {
    setRooms(prev => prev.filter(r => r.id !== roomId));
  };

  const handleConfirmClearAll = async () => {
    setRooms([]);
    setProjectName('');
    try { await AsyncStorage.removeItem(DRAFT_KEY); } catch {}
    setClearModalVisible(false);
  };

  const updateRoomDimension = (roomId: string, field: 'length' | 'width', val: string) => {
    setRooms(prev =>
      prev.map(r => {
        if (r.id !== roomId) return r;
        const lStr = field === 'length' ? val : r.length;
        const wStr = field === 'width' ? val : r.width;
        const calc = recalculateStandardRoom(lStr, wStr, r.selectedCollection, r.priceOverride);
        return {
          ...r,
          [field]: val,
          ...calc,
        };
      })
    );
  };

  const toggleRoomAccordion = (roomId: string) => {
    hapticFeedback.light();
    setRooms(prev => prev.map(r => (r.id === roomId ? { ...r, isOpen: !r.isOpen } : r)));
  };

  // Open Tile Selector for a specific room
  const openTilePicker = (roomId: string) => {
    setTargetRoomId(roomId);
    setTileSearch('');
    setSizeFilter('all');
    setTilePickerVisible(true);
  };

  const handleSelectCollection = (col: TileCollection) => {
    if (!targetRoomId) return;

    setRooms(prev =>
      prev.map(r => {
        if (r.id !== targetRoomId) return r;

        if (col.is12x18) {
          const allocations = createDefaultAllocations(col, r.name);
          const calcMode = r.calcMode || 'lines';
          const tilesPerLine = r.tilesPerLine || '8';
          const { updatedAllocations, totalBoxes, totalAmount } = computeVariantAllocations(
            allocations,
            calcMode,
            tilesPerLine,
            col.tilesPerBox || 8,
            wastagePercent
          );

          return {
            ...r,
            selectedCollection: col,
            variantAllocations: updatedAllocations,
            boxes: totalBoxes,
            totalAmount,
          };
        } else {
          const calc = recalculateStandardRoom(r.length, r.width, col, r.priceOverride);
          return {
            ...r,
            selectedCollection: col,
            variantAllocations: undefined,
            ...calc,
          };
        }
      })
    );

    setTilePickerVisible(false);
    setTargetRoomId(null);
  };

  // ─── 12×18 Variant Handlers ───────────────────────────────────────────────

  const updateCalcMode = (roomId: string, mode: 'total_tiles' | 'lines') => {
    setRooms(prev =>
      prev.map(r => {
        if (r.id !== roomId || !r.selectedCollection || !r.variantAllocations) return r;
        const { updatedAllocations, totalBoxes, totalAmount } = computeVariantAllocations(
          r.variantAllocations,
          mode,
          r.tilesPerLine || '8',
          r.selectedCollection.tilesPerBox || 8,
          wastagePercent
        );
        return {
          ...r,
          calcMode: mode,
          variantAllocations: updatedAllocations,
          boxes: totalBoxes,
          totalAmount,
        };
      })
    );
  };

  const updateTilesPerLine = (roomId: string, val: string) => {
    setRooms(prev =>
      prev.map(r => {
        if (r.id !== roomId || !r.selectedCollection || !r.variantAllocations) return r;
        const { updatedAllocations, totalBoxes, totalAmount } = computeVariantAllocations(
          r.variantAllocations,
          r.calcMode || 'lines',
          val,
          r.selectedCollection.tilesPerBox || 8,
          wastagePercent
        );
        return {
          ...r,
          tilesPerLine: val,
          variantAllocations: updatedAllocations,
          boxes: totalBoxes,
          totalAmount,
        };
      })
    );
  };

  const updateVariantAllocation = (
    roomId: string,
    variantType: VariantType,
    field: 'tiles' | 'linesDelta',
    val: string | number
  ) => {
    setRooms(prev =>
      prev.map(r => {
        if (r.id !== roomId || !r.selectedCollection || !r.variantAllocations) return r;

        const updatedAllocations = r.variantAllocations.map(alloc => {
          if (alloc.variantType !== variantType) return alloc;
          if (field === 'tiles') {
            return { ...alloc, tiles: val as string };
          } else {
            const newLines = Math.max(0, alloc.lines + (val as number));
            return { ...alloc, lines: newLines };
          }
        });

        const { updatedAllocations: finalAlloc, totalBoxes, totalAmount } = computeVariantAllocations(
          updatedAllocations,
          r.calcMode || 'lines',
          r.tilesPerLine || '8',
          r.selectedCollection.tilesPerBox || 8,
          wastagePercent
        );

        return {
          ...r,
          variantAllocations: finalAlloc,
          boxes: totalBoxes,
          totalAmount,
        };
      })
    );
  };

  // ─── Save & Proceed Handlers ───────────────────────────────────────────────

  const handleLoadEstimate = (est: any) => {
    if (est.isDraft === false || est.status === 'completed') {
      Alert.alert('Locked Estimate', 'This estimate has already been converted into a completed invoice and cannot be edited.');
      return;
    }
    hapticFeedback.success();
    setProjectName(est.projectName || '');
    setRooms(est.rooms || []);
    setWastagePercent(typeof est.wastagePercent === 'number' ? est.wastagePercent : 10);
    setCurrentEstimateId(est.dbId || est.id || null);
    AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(est));
    setSavedEstimatesModalVisible(false);
    Alert.alert('Estimate Loaded', `Loaded "${est.projectName || 'Estimate'}" into the editor.`);
  };

  const handleDeleteSavedEstimate = (est: any) => {
    hapticFeedback.light();
    Alert.alert(
      'Delete Estimate?',
      `Are you sure you want to delete "${est.projectName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await billingService.deleteEstimate({
              dbId: est.dbId,
              timestamp: est.timestamp,
              projectName: est.projectName,
            });
            setSavedEstimatesList(prev => prev.filter(e => {
              if (est.dbId && (e.dbId === est.dbId || e.id === est.dbId)) return false;
              if (est.timestamp && e.timestamp === est.timestamp) return false;
              if (est.projectName && e.projectName && e.projectName.trim().toLowerCase() === est.projectName.trim().toLowerCase()) return false;
              return true;
            }));
            hapticFeedback.success();
          }
        }
      ]
    );
  };

  const handleSaveDraft = async () => {
    const draftData = {
      id: currentEstimateId || `est_${Date.now()}`,
      projectName: projectName || 'Untitled Project',
      rooms,
      wastagePercent,
      totalSqft: grandTotalSqft,
      totalBoxes: grandTotalBoxes,
      totalAmount: grandTotalAmount,
      timestamp: new Date().toISOString(),
      isDraft: true,
      status: 'draft',
    };
    try {
      await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draftData));
      await AsyncStorage.setItem(SAVED_ESTIMATE_KEY, JSON.stringify(draftData));
      await billingService.saveEstimate(session.shop_id, draftData);
      hapticFeedback.success();
      fetchSavedEstimatesList();
      Alert.alert('Draft Saved', 'Estimate saved successfully to your local drafts.');
    } catch {
      hapticFeedback.error();
      Alert.alert('Error', 'Failed to save draft.');
    }
  };

  const proceedToBillingAction = async (validRooms: RoomItem[]) => {
    // Flatten variant allocations into billing items
    const billingRooms: any[] = [];

    validRooms.forEach(r => {
      const col = r.selectedCollection!;
      if (col.is12x18 && r.variantAllocations) {
        r.variantAllocations.forEach(alloc => {
          if (alloc.boxes > 0) {
            const v = col.variants.find(item => item.type === alloc.variantType);
            billingRooms.push({
              id: `${r.id}_${alloc.variantType}`,
              name: `${r.name} (${alloc.label})`,
              sqft: r.sqft,
              boxes: alloc.boxes,
              selectedTile: col.id,
              variantId: v?.id || alloc.variantId,
              variantType: alloc.variantType,
              pricePerBox: alloc.pricePerBox,
              totalAmount: alloc.totalAmount,
            });
          }
        });
      } else {
        const defaultVar = col.variants[0];
        const effectivePrice = r.priceOverride ? parseFloat(r.priceOverride) || r.pricePerBox : r.pricePerBox;
        billingRooms.push({
          id: r.id,
          name: r.name,
          sqft: r.sqft,
          boxes: r.boxes,
          selectedTile: col.id,
          variantId: defaultVar?.id,
          variantType: 'default',
          pricePerBox: effectivePrice,
          totalAmount: r.totalAmount,
        });
      }
    });

    const isDbUuid = currentEstimateId && currentEstimateId.length > 20 && !currentEstimateId.startsWith('est_');
    const pendingBill = {
      estimateId: currentEstimateId || `est_${Date.now()}`,
      dbId: isDbUuid ? currentEstimateId : undefined,
      projectName: projectName || 'Untitled Estimate',
      rooms: billingRooms,
      rawRooms: rooms,
      wastagePercent,
      totalSqft: grandTotalSqft,
      totalBoxes: grandTotalBoxes,
      totalAmount: grandTotalAmount,
      timestamp: new Date().toISOString(),
      status: 'pending',
      isDraft: true,
    };

    try {
      await AsyncStorage.setItem(PENDING_BILL_KEY, JSON.stringify(pendingBill));
      hapticFeedback.success();
      onTabChange('billing');
    } catch {
      hapticFeedback.error();
      Alert.alert('Error', 'Failed to process estimate for billing.');
    }
  };

  const handleProceedToBill = async () => {
    if (rooms.length === 0) {
      Alert.alert('No Rooms', 'Please add at least one room before proceeding to billing.');
      return;
    }

    // 1. Strict Stock Inventory Verification
    if (stockSummary.hasViolations) {
      const violationNames = stockSummary.violations
        ? stockSummary.violations.map(v => `${v.collectionName} (${v.variantLabel}): Req ${v.requiredBoxes} bx vs Stock ${v.availableStock} bx`).join('\n')
        : '';
      Alert.alert(
        'Insufficient Inventory Stock',
        `Cannot proceed to billing because the following items exceed available stock:\n\n${violationNames}\n\nPlease reduce box quantities or select in-stock products.`
      );
      return;
    }

    // 2. Incomplete Rooms Check
    const validRooms = rooms.filter(
      r => r.selectedCollection !== null && (r.boxes > 0 || r.totalAmount > 0)
    );

    if (validRooms.length === 0) {
      Alert.alert(
        'Incomplete Estimate',
        'Please enter room dimensions or tile line counts for at least one room before proceeding.'
      );
      return;
    }

    const incompleteRooms = rooms.filter(
      r => !r.selectedCollection || (r.boxes === 0 && r.totalAmount === 0)
    );

    if (incompleteRooms.length > 0) {
      Alert.alert(
        'Incomplete Rooms Detected',
        `${incompleteRooms.length} room(s) have no tile selection or 0 boxes and will be omitted from the bill. Continue?`,
        [
          { text: 'Review Rooms', style: 'cancel' },
          { text: 'Proceed', onPress: () => proceedToBillingAction(validRooms) }
        ]
      );
    } else {
      proceedToBillingAction(validRooms);
    }
  };

  // Summary Totals
  const grandTotalSqft   = rooms.reduce((sum, r) => sum + r.sqft, 0);
  const grandTotalBoxes  = rooms.reduce((sum, r) => sum + r.boxes, 0);
  const grandTotalAmount = rooms.reduce((sum, r) => sum + r.totalAmount, 0);

  // Filter tiles for bottom sheet
  const filteredTiles = catalog.filter(t => {
    const matchesSearch =
      !tileSearch ||
      t.name.toLowerCase().includes(tileSearch.toLowerCase()) ||
      t.brand.toLowerCase().includes(tileSearch.toLowerCase()) ||
      t.size.toLowerCase().includes(tileSearch.toLowerCase());
    const matchesSize =
      sizeFilter === 'all' || t.size.replace('×', 'x') === sizeFilter;
    return matchesSearch && matchesSize;
  });

  return (
       <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Unified Hero Header (Combines title, project name & settings into one sleek area) */}
      <LinearGradient
        colors={['#6D28D9', '#7C3AED', '#A855F7']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <SafeAreaView edges={['top']} style={styles.safeHeader}>
          {/* Top Brand Line */}
          <View style={styles.appBar}>
            <View style={styles.logoRow}>
              <View style={styles.logoIcon}>
                <MaterialCommunityIcons name="calculator" size={18} color="#FFF" />
              </View>
              <Text style={styles.logoText}>Tilor<Text style={styles.logoDot}>.</Text></Text>
            </View>
            <View style={styles.roleBadge}>
              <View style={styles.roleIndicator} />
              <Text style={styles.roleText}>{session.role === 'owner' ? 'OWNER' : 'STAFF'}</Text>
            </View>
          </View>

          {/* Seamless Inline Project Name */}
          <View style={styles.projectTitleRow}>
            <TextInput
              style={styles.projectNameInputInline}
              placeholder="Project / Site Name..."
              placeholderTextColor="rgba(255,255,255,0.5)"
              value={projectName}
              onChangeText={setProjectName}
            />
            <Feather name="edit-2" size={14} color="rgba(255,255,255,0.7)" />
          </View>

          {/* Compact Quick Toolbar (Progressive Disclosure) */}
          <View style={styles.headerControlsStrip}>
            <View style={styles.headerPillsGroup}>
              {/* Cushion Dropdown Pill */}
              <TouchableOpacity
                style={styles.headerPill}
                onPress={() => setCushionModalVisible(true)}
                activeOpacity={0.75}
              >
                <Feather name="shield" size={11} color="#FFF" />
                <Text style={styles.headerPillText}>
                  {wastagePercent === 0 ? '0% Cushion' : `+${wastagePercent}% Cushion`}
                </Text>
                <Feather name="chevron-down" size={12} color="#FFF" />
              </TouchableOpacity>

              {/* Templates Dropdown Pill */}
              <TouchableOpacity
                style={styles.headerPill}
                onPress={() => setTemplatesModalVisible(true)}
                activeOpacity={0.75}
              >
                <Feather name="grid" size={11} color="#FFF" />
                <Text style={styles.headerPillText}>Templates</Text>
                <Feather name="chevron-down" size={12} color="#FFF" />
              </TouchableOpacity>

              {/* Saved Estimates Dropdown Pill */}
              <TouchableOpacity
                style={styles.headerPill}
                onPress={() => {
                  fetchSavedEstimatesList();
                  setSavedEstimatesModalVisible(true);
                }}
                activeOpacity={0.75}
              >
                <Feather name="folder" size={11} color="#FFF" />
                <Text style={styles.headerPillText}>
                  Saved ({savedEstimatesList.length})
                </Text>
                <Feather name="chevron-down" size={12} color="#FFF" />
              </TouchableOpacity>
            </View>

            <View style={styles.headerGrandStat}>
              <Text style={styles.headerGrandTotalVal}>₹{grandTotalAmount.toLocaleString('en-IN')}</Text>
              <Text style={styles.headerGrandBoxesSub}>
                {grandTotalBoxes} boxes · {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Scrollable Main Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.innerContent}>
          {/* Global Stock Alert Banner */}
          {stockSummary.hasViolations && (
            <View style={styles.globalStockAlertCard}>
              <View style={styles.stockAlertHeader}>
                <Feather name="alert-triangle" size={16} color="#DC2626" />
                <Text style={styles.stockAlertTitle}>INVENTORY STOCK VIOLATION DETECTED</Text>
              </View>
              <Text style={styles.stockAlertSub}>
                The total required boxes exceed current in-stock inventory for the following tiles:
              </Text>
              {stockSummary.violations.map((item, idx) => (
                <View key={idx} style={styles.stockAlertRow}>
                  <Text style={styles.stockAlertText}>
                    • <Text style={{ fontWeight: 'bold' }}>{item.collectionName}</Text> ({item.variantLabel})
                  </Text>
                  <Text style={styles.stockAlertBadge}>
                    Required: {item.requiredBoxes} bx | Stock: {item.availableStock} bx
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Section Bar: Rooms & Add Room */}
          <View style={styles.roomsSectionBar}>
            <Text style={styles.sectionTitle}>ROOMS IN ESTIMATE</Text>
            <TouchableOpacity style={styles.btnAddRoomCompact} onPress={addCustomRoom} activeOpacity={0.7}>
              <Feather name="plus" size={12} color="#7C3AED" />
              <Text style={styles.btnAddRoomCompactText}>Add Room</Text>
            </TouchableOpacity>
          </View>

          {/* Rooms in Estimate */}
          {loadingCatalog ? (
            <EstimatorSkeleton />
          ) : (
            <>
              {/* Empty State if no rooms */}
              {rooms.length === 0 && (
                <View style={styles.emptyRoomsCard}>
                  <View style={styles.emptyIconCircle}>
                    <Feather name="box" size={24} color="#7C3AED" />
                  </View>
                  <Text style={styles.emptyTitle}>No Rooms in Estimate</Text>
                  <Text style={styles.emptySub}>
                    Choose a preset template above or tap Add Room to calculate boxes.
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <TouchableOpacity style={styles.emptyAddBtn} onPress={addCustomRoom} activeOpacity={0.7}>
                      <Feather name="plus" size={14} color="#FFF" />
                      <Text style={styles.emptyAddBtnText}>Add First Room</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.emptyAddBtn, { backgroundColor: '#FAF5FF', borderWidth: 1, borderColor: '#DDD6FE' }]}
                      onPress={() => {
                        fetchSavedEstimatesList();
                        setSavedEstimatesModalVisible(true);
                      }}
                      activeOpacity={0.7}
                    >
                      <Feather name="folder" size={14} color="#7C3AED" />
                      <Text style={[styles.emptyAddBtnText, { color: '#7C3AED' }]}>Load Saved Estimate</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Rooms List */}
              <View style={styles.roomsList}>
            {rooms.map((room, roomIdx) => (
              <View key={room.id} style={[styles.roomCard, room.isOpen && styles.roomCardOpen]}>
                {/* Room Header */}
                <TouchableOpacity
                  style={styles.roomHeader}
                  onPress={() => toggleRoomAccordion(room.id)}
                  activeOpacity={0.8}
                >
                  <View style={styles.roomHeaderLeft}>
                    <View style={styles.roomIconCircle}>
                      <Feather name={room.icon || 'box'} size={15} color="#7C3AED" />
                    </View>
                    <View style={styles.roomTitleCol}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <TextInput
                          style={styles.roomTitleInput}
                          value={room.name}
                          onChangeText={val => renameRoom(room.id, val)}
                          placeholder="Room Name"
                          placeholderTextColor="#A0AEC0"
                        />
                        <Feather name="edit-2" size={11} color="#A0AEC0" />
                      </View>
                      <Text style={styles.roomSub}>
                        {room.sqft > 0 ? `${room.sqft} sqft · ` : ''}
                        {room.boxes > 0 ? `${room.boxes} boxes` : 'No tile configured'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.roomHeaderRight}>
                    {/* Reorder Buttons */}
                    <View style={styles.reorderGroup}>
                      {roomIdx > 0 && (
                        <TouchableOpacity onPress={() => moveRoom(room.id, 'up')} style={styles.reorderBtn}>
                          <Feather name="chevron-up" size={12} color="#7C3AED" />
                        </TouchableOpacity>
                      )}
                      {roomIdx < rooms.length - 1 && (
                        <TouchableOpacity onPress={() => moveRoom(room.id, 'down')} style={styles.reorderBtn}>
                          <Feather name="chevron-down" size={12} color="#7C3AED" />
                        </TouchableOpacity>
                      )}
                    </View>

                    <Text style={styles.roomAmountText}>₹{room.totalAmount.toLocaleString('en-IN')}</Text>
                    <Feather name={room.isOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#A0AEC0" />
                  </View>
                </TouchableOpacity>

                {/* Accordion Body */}
                {room.isOpen && (
                  <View style={styles.roomBody}>
                    {/* Dimensions Input Row */}
                    <Text style={styles.inputSectionLabel}>ROOM DIMENSIONS (FEET)</Text>
                    <View style={styles.dimRow}>
                      <View style={styles.dimInputWrap}>
                        <Text style={styles.dimInputPrefix}>L</Text>
                        <TextInput
                          style={styles.dimInput}
                          keyboardType="numeric"
                          placeholder="0"
                          placeholderTextColor="#A0AEC0"
                          value={room.length}
                          onChangeText={val => updateRoomDimension(room.id, 'length', val)}
                        />
                        <Text style={styles.dimInputSuffix}>ft</Text>
                      </View>
                      <Text style={styles.dimTimes}>×</Text>
                      <View style={styles.dimInputWrap}>
                        <Text style={styles.dimInputPrefix}>W</Text>
                        <TextInput
                          style={styles.dimInput}
                          keyboardType="numeric"
                          placeholder="0"
                          placeholderTextColor="#A0AEC0"
                          value={room.width}
                          onChangeText={val => updateRoomDimension(room.id, 'width', val)}
                        />
                        <Text style={styles.dimInputSuffix}>ft</Text>
                      </View>
                      {room.sqft > 0 && (
                        <View style={styles.dimSqftPill}>
                          <Text style={styles.dimSqftPillText}>{room.sqft} sqft</Text>
                        </View>
                      )}
                    </View>

                    {/* Tile Selector Button */}
                    <Text style={styles.inputSectionLabel}>SELECTED TILE PRODUCT</Text>
                    <TouchableOpacity style={styles.tileSelectBtn} onPress={() => openTilePicker(room.id)} activeOpacity={0.7}>
                      {room.selectedCollection ? (
                        <View style={styles.selectedTileRow}>
                          <View style={[styles.tileSwatchSmall, { backgroundColor: room.selectedCollection.variants[0]?.color || '#7C3AED' }]} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.selectedTileName}>{room.selectedCollection.name}</Text>
                            <Text style={styles.selectedTileSpecs}>
                              {room.selectedCollection.brand} · {room.selectedCollection.size}
                              {room.selectedCollection.is12x18 ? ' · (12×18 Variants)' : ` · Catalog: ₹${room.pricePerBox}/bx`}
                            </Text>
                          </View>
                          <View style={styles.tileChangeWrap}>
                            <Text style={styles.tileChangeText}>Change</Text>
                            <Feather name="edit-2" size={12} color="#7C3AED" />
                          </View>
                        </View>
                      ) : (
                        <View style={styles.noTileRow}>
                          <Feather name="plus-circle" size={16} color="#7C3AED" />
                          <Text style={styles.noTileText}>Tap to select tile product…</Text>
                        </View>
                      )}
                    </TouchableOpacity>

                    {/* Custom Rate Override per Room */}
                    {room.selectedCollection && !room.selectedCollection.is12x18 && (
                      <View style={styles.priceOverrideRow}>
                        <Text style={styles.priceOverrideLabel}>CUSTOM PRICE OVERRIDE (PER BOX):</Text>
                        <View style={styles.priceOverrideInputWrap}>
                          <Text style={styles.rupeeSymbol}>₹</Text>
                          <TextInput
                            style={styles.priceOverrideInput}
                            keyboardType="numeric"
                            placeholder={room.pricePerBox.toString()}
                            placeholderTextColor="#A0AEC0"
                            value={room.priceOverride || ''}
                            onChangeText={val => updatePriceOverride(room.id, val)}
                          />
                        </View>
                      </View>
                    )}

                    {/* 12×18 Variant Calculation Panel */}
                    {room.selectedCollection?.is12x18 && room.variantAllocations && (
                      <View style={styles.variantCalcPanel}>
                        <View style={styles.variantCalcHeaderRow}>
                          <Text style={styles.inputSectionLabel}>CALCULATION MODE</Text>
                          {room.calcMode === 'lines' && (
                            <View style={styles.tilesPerLineRow}>
                              <Text style={styles.fieldLabelInline}>Tiles/Line:</Text>
                              <TextInput
                                style={styles.tilesPerLineInput}
                                keyboardType="numeric"
                                value={room.tilesPerLine || '8'}
                                onChangeText={val => updateTilesPerLine(room.id, val)}
                              />
                            </View>
                          )}
                        </View>
                        <View style={styles.calcModePillRow}>
                          <TouchableOpacity
                            style={[styles.calcModePill, room.calcMode === 'lines' && styles.calcModePillActive]}
                            onPress={() => updateCalcMode(room.id, 'lines')}
                          >
                            <Text style={[styles.calcModePillText, room.calcMode === 'lines' && styles.calcModePillTextActive]}>
                              Lines × Tiles Mode
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.calcModePill, room.calcMode === 'total_tiles' && styles.calcModePillActive]}
                            onPress={() => updateCalcMode(room.id, 'total_tiles')}
                          >
                            <Text style={[styles.calcModePillText, room.calcMode === 'total_tiles' && styles.calcModePillTextActive]}>
                              Total Tiles Mode
                            </Text>
                          </TouchableOpacity>
                        </View>

                        {/* Variant Allocation Rows */}
                        {room.variantAllocations.map(alloc => {
                          const matchingVariant = room.selectedCollection?.variants.find(v => v.type === alloc.variantType);
                          const stockAvailable = matchingVariant ? matchingVariant.stock : 999;
                          const isOverStock = alloc.boxes > stockAvailable;

                          return (
                            <View key={alloc.variantType} style={[styles.allocRow, isOverStock && styles.allocRowOverStock]}>
                              <View style={[styles.allocSwatch, { backgroundColor: alloc.color }]} />
                              <View style={{ width: 85 }}>
                                <Text style={styles.allocLabel}>{alloc.label}</Text>
                                <Text style={styles.allocPrice}>₹{alloc.pricePerBox}/bx · Stk: {stockAvailable}</Text>
                              </View>

                              {/* Inputs based on calcMode */}
                              {room.calcMode === 'lines' ? (
                                <View style={styles.stepperWrap}>
                                  <TouchableOpacity style={styles.stepperBtn} onPress={() => { hapticFeedback.selection(); updateVariantAllocation(room.id, alloc.variantType, 'linesDelta', -1); }}>
                                    <Text style={styles.stepperText}>-</Text>
                                  </TouchableOpacity>
                                  <Text style={styles.stepperVal}>{alloc.lines} lines</Text>
                                  <TouchableOpacity style={styles.stepperBtn} onPress={() => { hapticFeedback.selection(); updateVariantAllocation(room.id, alloc.variantType, 'linesDelta', 1); }}>
                                    <Text style={styles.stepperText}>+</Text>
                                  </TouchableOpacity>
                                </View>
                              ) : (
                                <View style={{ flex: 1, paddingRight: 8 }}>
                                  <TextInput
                                    style={styles.tilesInput}
                                    keyboardType="numeric"
                                    placeholder="0 tiles"
                                    placeholderTextColor="#A0AEC0"
                                    value={alloc.tiles}
                                    onChangeText={val => updateVariantAllocation(room.id, alloc.variantType, 'tiles', val)}
                                  />
                                </View>
                              )}

                              <View style={{ alignItems: 'flex-end', minWidth: 65 }}>
                                <Text style={[styles.allocBoxesVal, isOverStock && { color: '#DC2626' }]}>
                                  {alloc.boxes} bx
                                </Text>
                                <Text style={styles.allocTotalVal}>₹{alloc.totalAmount.toLocaleString('en-IN')}</Text>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}

                    {/* Standard Room Calc Summary */}
                    {!room.selectedCollection?.is12x18 && room.sqft > 0 && (
                      <View style={styles.roomCalcCard}>
                        <View style={styles.statRow3Col}>
                          <View style={styles.statCell}>
                            <Text style={styles.statCellLbl}>Area Covered</Text>
                            <Text style={styles.statCellVal}>{room.sqft} sqft</Text>
                          </View>
                          <View style={styles.statCell}>
                            <Text style={styles.statCellLbl}>Required</Text>
                            <Text style={[styles.statCellVal, { color: '#7C3AED' }]}>{room.boxes} boxes</Text>
                          </View>
                          {room.selectedCollection && (
                            <View style={styles.statCell}>
                              <Text style={styles.statCellLbl}>Stock</Text>
                              <Text style={[styles.statCellVal, { color: room.boxes > (room.selectedCollection.variants[0]?.stock || 0) ? '#DC2626' : '#16A34A' }]}>
                                {room.selectedCollection.variants[0]?.stock || 0} bx
                              </Text>
                            </View>
                          )}
                        </View>
                        <View style={styles.roomCalcTotalRow}>
                          <Text style={styles.calcLabelBold}>Room Total:</Text>
                          <Text style={styles.calcValTotal}>₹{room.totalAmount.toLocaleString('en-IN')}</Text>
                        </View>
                      </View>
                    )}

                    {/* Actions */}
                    <View style={styles.roomActionsRow}>
                      <TouchableOpacity style={styles.roomActionBtn} onPress={() => duplicateRoom(room.id)}>
                        <Feather name="copy" size={13} color="#6B7280" />
                        <Text style={styles.roomActionText}>Duplicate</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.roomActionBtn, styles.roomActionBtnDelete]} onPress={() => deleteRoom(room.id)}>
                        <Feather name="trash-2" size={13} color="#EF4444" />
                        <Text style={[styles.roomActionText, { color: '#EF4444' }]}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            ))}
          </View>

          {/* Collapsible Estimate Summary Drawer */}
          {rooms.length > 0 && (
            <View style={styles.summaryCard}>
              <TouchableOpacity style={styles.summaryHeader} onPress={() => setSummaryOpen(!summaryOpen)} activeOpacity={0.8}>
                <View style={styles.summaryHeaderLeft}>
                  <View style={styles.summaryIconCircle}>
                    <Feather name="file-text" size={16} color="#FFF" />
                  </View>
                  <View>
                    <Text style={styles.summaryTitle}>Estimate Summary</Text>
                    <Text style={styles.summarySub}>{rooms.length} Rooms · {grandTotalSqft} sqft total</Text>
                  </View>
                </View>
                <View style={styles.summaryHeaderRight}>
                  <Text style={styles.summaryTotalVal}>₹{grandTotalAmount.toLocaleString('en-IN')}</Text>
                  <Feather name={summaryOpen ? 'chevron-up' : 'chevron-down'} size={18} color="#A0AEC0" />
                </View>
              </TouchableOpacity>

              {summaryOpen && (
                <View style={styles.summaryBody}>
                  {rooms.map((r, i) => (
                    <RoomSummaryRow key={r.id || i} room={r} />
                  ))}
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryStatRow}>
                    <Text style={styles.summaryStatLabel}>Total Covered Area:</Text>
                    <Text style={styles.summaryStatVal}>{grandTotalSqft} sq.ft</Text>
                  </View>
                  <View style={styles.summaryStatRow}>
                    <Text style={styles.summaryStatLabel}>Total Boxes Needed:</Text>
                    <Text style={styles.summaryStatVal}>{grandTotalBoxes} boxes</Text>
                  </View>
                  <View style={[styles.summaryStatRow, styles.summaryStatGrandRow]}>
                    <Text style={styles.summaryStatGrandLabel}>Grand Total:</Text>
                    <Text style={styles.summaryStatGrandVal}>₹{grandTotalAmount.toLocaleString('en-IN')}</Text>
                  </View>
                </View>
              )}
            </View>
          )}
          </>
          )}
        </View>
      </ScrollView>

      {/* Fixed Thumb-Zone Bottom Action Dock */}
      {rooms.length > 0 && (
        <View style={styles.bottomDock}>
          <TouchableOpacity style={styles.saveDraftBtn} onPress={handleSaveDraft} activeOpacity={0.8}>
            <Feather name="save" size={15} color="#7C3AED" />
            <Text style={styles.saveDraftText}>Save Draft</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.proceedBtn, stockSummary.hasViolations && styles.proceedBtnDisabled]}
            onPress={handleProceedToBill}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={stockSummary.hasViolations ? ['#9CA3AF', '#6B7280'] : ['#7C3AED', '#9333EA']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.proceedGrad}
            >
              <Feather name={stockSummary.hasViolations ? 'lock' : 'arrow-right-circle'} size={16} color="#FFF" />
              <Text style={styles.proceedText}>
                {stockSummary.hasViolations ? 'Stock Exceeded' : 'Proceed to Bill'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom Nav */}
      <BottomNavBar activeTab={activeTab} onTabPress={onTabChange} />

      {/* 1. Modal Sheet: Breakage Cushion Selector */}
      <Modal visible={cushionModalVisible} transparent animationType="slide" onRequestClose={() => setCushionModalVisible(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setCushionModalVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheetContent}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Tile Breakage Cushion</Text>
              <TouchableOpacity onPress={() => setCushionModalVisible(false)} style={styles.modalCloseBtn}>
                <Feather name="x" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.cushionOptionsList}>
              {[
                { pct: 0, title: '0% Exact Net Area', desc: 'Exact box count with zero contingency buffer' },
                { pct: 5, title: '+5% Low Cushion', desc: 'For simple rectangular rooms with minimal cutting' },
                { pct: 10, title: '+10% Standard Cushion (Recommended)', desc: 'Covers edge cuts, corner trimming, and transit breakage' },
                { pct: 15, title: '+15% High Cuts / Diagonal', desc: 'For diagonal layouts, multiple pillars, or complex cuts' },
              ].map(opt => {
                const isSelected = wastagePercent === opt.pct;
                return (
                  <TouchableOpacity
                    key={opt.pct}
                    style={[styles.sheetOptionCard, isSelected && styles.sheetOptionCardActive]}
                    onPress={() => {
                      hapticFeedback.selection();
                      handleWastageChange(opt.pct);
                      setCushionModalVisible(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={styles.sheetOptionInfo}>
                      <Text style={[styles.sheetOptionTitle, isSelected && styles.sheetOptionTitleActive]}>
                        {opt.title}
                      </Text>
                      <Text style={styles.sheetOptionDesc}>{opt.desc}</Text>
                    </View>
                    <View style={[styles.sheetCheckCircle, isSelected && styles.sheetCheckCircleActive]}>
                      {isSelected && <Feather name="check" size={13} color="#FFF" />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* 2. Modal Sheet: House Plan Templates */}
      <Modal visible={templatesModalVisible} transparent animationType="slide" onRequestClose={() => setTemplatesModalVisible(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setTemplatesModalVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheetContent}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>House Plan Templates</Text>
              <TouchableOpacity onPress={() => setTemplatesModalVisible(false)} style={styles.modalCloseBtn}>
                <Feather name="x" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.templatesOptionsList}>
              <TouchableOpacity
                style={styles.templateOptionCard}
                onPress={() => {
                  setTemplatesModalVisible(false);
                  applyPreset('1bhk');
                }}
                activeOpacity={0.7}
              >
                <View style={styles.templateOptionIconWrap}>
                  <Feather name="zap" size={18} color="#7C3AED" />
                </View>
                <View style={styles.templateOptionInfo}>
                  <Text style={styles.sheetOptionTitle}>1BHK Apartment Template</Text>
                  <Text style={styles.sheetOptionDesc}>Living Room, Bedroom, Kitchen, Bathroom (4 rooms)</Text>
                </View>
                <Feather name="chevron-right" size={18} color="#A0AEC0" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.templateOptionCard}
                onPress={() => {
                  setTemplatesModalVisible(false);
                  applyPreset('2bhk');
                }}
                activeOpacity={0.7}
              >
                <View style={styles.templateOptionIconWrap}>
                  <Feather name="home" size={18} color="#7C3AED" />
                </View>
                <View style={styles.templateOptionInfo}>
                  <Text style={styles.sheetOptionTitle}>2BHK House Template</Text>
                  <Text style={styles.sheetOptionDesc}>Living, 2 Bedrooms, Kitchen, 2 Bathrooms (6 rooms)</Text>
                </View>
                <Feather name="chevron-right" size={18} color="#A0AEC0" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.templateOptionCard}
                onPress={() => {
                  setTemplatesModalVisible(false);
                  applyPreset('3bhk');
                }}
                activeOpacity={0.7}
              >
                <View style={styles.templateOptionIconWrap}>
                  <Feather name="grid" size={18} color="#7C3AED" />
                </View>
                <View style={styles.templateOptionInfo}>
                  <Text style={styles.sheetOptionTitle}>3BHK Villa Template</Text>
                  <Text style={styles.sheetOptionDesc}>Living, 3 Bedrooms, Kitchen, Dining, 2 Bathrooms (8 rooms)</Text>
                </View>
                <Feather name="chevron-right" size={18} color="#A0AEC0" />
              </TouchableOpacity>

              <View style={styles.templateDivider} />

              <TouchableOpacity
                style={styles.templateOptionCard}
                onPress={() => {
                  setTemplatesModalVisible(false);
                  setClearModalVisible(true);
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.templateOptionIconWrap, styles.templateOptionIconWrapRed]}>
                  <Feather name="trash-2" size={18} color="#EF4444" />
                </View>
                <View style={styles.templateOptionInfo}>
                  <Text style={[styles.sheetOptionTitle, { color: '#EF4444' }]}>Clear All Rooms</Text>
                  <Text style={styles.sheetOptionDesc}>Reset all rooms and start from a blank slate</Text>
                </View>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* 3. Modal Sheet: Tile Picker */}
      <Modal visible={tilePickerVisible} transparent animationType="slide" onRequestClose={() => setTilePickerVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheetContent}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Select Tile Product</Text>
              <TouchableOpacity onPress={() => setTilePickerVisible(false)} style={styles.modalCloseBtn}>
                <Feather name="x" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.sheetSearchWrap}>
              <Feather name="search" size={14} color="#A0AEC0" style={{ marginRight: 6 }} />
              <TextInput style={styles.sheetSearchInput} placeholder="Search tile name, size, or brand..." placeholderTextColor="#A0AEC0" value={tileSearch} onChangeText={setTileSearch} />
            </View>

            <View style={styles.filterChipsRow}>
              {['all', '12x18', '2x2', '2x4'].map(sz => (
                <TouchableOpacity key={sz} style={[styles.sizeChip, sizeFilter === sz && styles.sizeChipActive]} onPress={() => setSizeFilter(sz)}>
                  <Text style={[styles.sizeChipText, sizeFilter === sz && styles.sizeChipTextActive]}>{sz === 'all' ? 'All Sizes' : sz}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <FlatList
              data={filteredTiles}
              keyExtractor={item => item.id}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const mainVariant = item.variants[0];
                const totalStock = item.is12x18
                  ? item.variants.reduce((s, v) => s + v.stock, 0)
                  : mainVariant?.stock || 0;

                return (
                  <TouchableOpacity style={styles.tileListItem} onPress={() => handleSelectCollection(item)} activeOpacity={0.75}>
                    <View style={[styles.tileListSwatch, { backgroundColor: mainVariant?.color || '#7C3AED' }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.tileListName}>{item.name}</Text>
                      <Text style={styles.tileListSpecs}>{item.brand} · {item.size} · {item.sqftPerBox} sqft/bx</Text>
                      <Text style={[styles.stockPillText, totalStock === 0 && { color: '#EF4444' }]}>
                        {totalStock > 0 ? `📦 In Stock: ${totalStock} bx` : '⚠️ Out of Stock'}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.tileListPrice}>₹{mainVariant?.pricePerBox}/bx</Text>
                      {item.is12x18 && <Text style={{ fontSize: 8, fontWeight: 'bold', color: '#7C3AED' }}>12×18 Variants</Text>}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      {/* 4. Confirm Clear Modal */}
      <Modal visible={clearModalVisible} transparent animationType="fade" onRequestClose={() => setClearModalVisible(false)}>
        <View style={styles.confirmModalBackdrop}>
          <View style={styles.confirmModalBox}>
            <View style={styles.confirmModalIconWrap}>
              <Feather name="trash-2" size={24} color="#EF4444" />
            </View>
            <Text style={styles.confirmModalTitle}>Clear All Rooms?</Text>
            <Text style={styles.confirmModalMsg}>All rooms and calculated estimates will be removed.</Text>
            <View style={styles.confirmModalActions}>
              <TouchableOpacity style={styles.confirmCancelBtn} onPress={() => setClearModalVisible(false)}>
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmDeleteBtn} onPress={handleConfirmClearAll}>
                <Text style={styles.confirmDeleteText}>Clear All</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 5. Modal Sheet: Saved Estimates / Drafts Loader */}
      <Modal visible={savedEstimatesModalVisible} transparent animationType="slide" onRequestClose={() => setSavedEstimatesModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.sheetContent, { maxHeight: '80%' }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Feather name="folder" size={18} color="#7C3AED" />
                <Text style={styles.sheetTitle}>Saved Estimates &amp; Drafts</Text>
              </View>
              <TouchableOpacity onPress={() => setSavedEstimatesModalVisible(false)} style={styles.modalCloseBtn}>
                <Feather name="x" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
              {savedEstimatesList.length === 0 ? (
                <View style={{ padding: 36, alignItems: 'center' }}>
                  <Feather name="inbox" size={36} color="#C4B5FD" />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#1E293B', marginTop: 10 }}>No Saved Estimates Found</Text>
                  <Text style={{ fontSize: 11, color: '#64748B', textAlign: 'center', marginTop: 4 }}>
                    Estimates saved using "Save Draft" will appear here for 1-tap loading into the editor.
                  </Text>
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  {savedEstimatesList.map((est, idx) => {
                    const isCompleted = est.isDraft === false || est.status === 'completed';
                    const estBoxes = est.totalBoxes || (est.rooms || []).reduce((s: number, r: any) => s + (r.boxes || 0), 0);
                    const estAmount = est.totalAmount || (est.rooms || []).reduce((s: number, r: any) => s + (r.totalAmount || 0), 0);
                    const dateStr = new Date(est.timestamp).toLocaleDateString('en-IN', {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                    });

                    return (
                      <View
                        key={est.dbId || est.timestamp || idx}
                        style={{
                          backgroundColor: '#FFF',
                          borderWidth: 1,
                          borderColor: isCompleted ? '#E2E8F0' : '#DDD6FE',
                          borderRadius: 14,
                          padding: 12,
                          gap: 8,
                        }}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <View style={{ flex: 1, marginRight: 8 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <Text style={{ fontSize: 14, fontWeight: '800', color: '#0F172A' }}>
                                {est.projectName || 'Untitled Project'}
                              </Text>
                              <View style={{
                                backgroundColor: isCompleted ? '#DCFCE7' : '#FAF5FF',
                                borderWidth: 1,
                                borderColor: isCompleted ? '#86EFAC' : '#E9D5FF',
                                paddingHorizontal: 6,
                                paddingVertical: 2,
                                borderRadius: 6,
                              }}>
                                <Text style={{
                                  fontSize: 9,
                                  fontWeight: '800',
                                  color: isCompleted ? '#166534' : '#7C3AED',
                                }}>
                                  {isCompleted ? '✓ COMPLETED' : 'ACTIVE DRAFT'}
                                </Text>
                              </View>
                            </View>
                            <Text style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>{dateStr}</Text>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={{ fontSize: 14, fontWeight: '800', color: '#7C3AED' }}>
                              ₹{estAmount.toLocaleString('en-IN')}
                            </Text>
                            <Text style={{ fontSize: 10, color: '#64748B' }}>
                              {estBoxes} boxes · {(est.rooms || []).length} rooms
                            </Text>
                          </View>
                        </View>

                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9', alignItems: 'center' }}>
                          {!isCompleted ? (
                            <TouchableOpacity
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 4,
                                backgroundColor: '#7C3AED',
                                paddingHorizontal: 12,
                                paddingVertical: 6,
                                borderRadius: 8,
                              }}
                              onPress={() => handleLoadEstimate(est)}
                            >
                              <Feather name="upload" size={12} color="#FFF" />
                              <Text style={{ fontSize: 11, fontWeight: '700', color: '#FFF' }}>Load into Editor</Text>
                            </TouchableOpacity>
                          ) : (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F3F4F6', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6 }}>
                              <Feather name="lock" size={10} color="#6B7280" />
                              <Text style={{ fontSize: 10, fontWeight: '700', color: '#6B7280' }}>Billed &amp; Locked</Text>
                            </View>
                          )}
                          <TouchableOpacity
                            style={{ padding: 6 }}
                            onPress={() => handleDeleteSavedEstimate(est)}
                          >
                            <Feather name="trash-2" size={13} color="#EF4444" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F6FF' },
  header: { borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  safeHeader: { paddingHorizontal: 18, paddingBottom: 16 },
  appBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  logoRow: { flexDirection: 'row', alignItems: 'center' },
  logoIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', marginRight: 8 },
  logoText: { fontSize: 19, fontWeight: '800', color: '#FFF', letterSpacing: -0.5 },
  logoDot: { color: '#E9D5FF' },
  roleBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.16)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  roleIndicator: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981', marginRight: 5 },
  roleText: { color: '#FFF', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },

  // Inline project title
  projectTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  projectNameInputInline: { flex: 1, fontSize: 18, fontWeight: '800', color: '#FFF', paddingVertical: 2, paddingHorizontal: 4 },

  // Quick toolbar in header
  headerControlsStrip: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerPillsGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  headerPillText: { fontSize: 11, fontWeight: '700', color: '#FFF' },
  headerGrandStat: { alignItems: 'flex-end' },
  headerGrandTotalVal: { fontSize: 15, fontWeight: '800', color: '#FFF' },
  headerGrandBoxesSub: { fontSize: 10, color: 'rgba(255,255,255,0.75)', fontWeight: '600' },

  // Scroll Area
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  innerContent: { paddingHorizontal: 16, paddingTop: 14, gap: 12 },

  // Global Stock Alert Banner
  globalStockAlertCard: { backgroundColor: '#FEF2F2', borderRadius: 12, borderWidth: 1, borderColor: '#FECACA', padding: 10 },
  stockAlertHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  stockAlertTitle: { fontSize: 11, fontWeight: '800', color: '#EF4444', letterSpacing: 0.5 },
  stockAlertSub: { fontSize: 10, color: '#991B1B', marginBottom: 6 },
  stockAlertRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 2 },
  stockAlertText: { fontSize: 10, color: '#7F1D1D' },
  stockAlertBadge: { fontSize: 9, fontWeight: 'bold', color: '#DC2626', backgroundColor: '#FEE2E2', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },

  // Section Bar
  roomsSectionBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2 },
  sectionTitle: { fontSize: 12, fontWeight: '800', color: '#64748B', letterSpacing: 0.6 },
  btnAddRoomCompact: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FAF5FF', borderWidth: 1, borderColor: '#E9D5FF', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  btnAddRoomCompactText: { fontSize: 11, fontWeight: '700', color: '#7C3AED' },

  // Empty State
  emptyRoomsCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#F1EDFC' },
  emptyIconCircle: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#FAF5FF', justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  emptyTitle: { fontSize: 14, fontWeight: '800', color: '#0F172A', marginBottom: 4 },
  emptySub: { fontSize: 11, color: '#64748B', textAlign: 'center', lineHeight: 16, marginBottom: 14 },
  emptyAddBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#7C3AED', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  emptyAddBtnText: { fontSize: 12, fontWeight: '700', color: '#FFF' },

  // Rooms List & Cards
  roomsList: { gap: 10 },
  roomCard: { backgroundColor: '#FFF', borderRadius: 16, borderWidth: 1, borderColor: '#F1EDFC', overflow: 'hidden' },
  roomCardOpen: { borderColor: '#E9D5FF' },
  roomHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#FFF' },
  roomHeaderLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 8 },
  roomIconCircle: { width: 32, height: 32, borderRadius: 9, backgroundColor: '#FAF5FF', borderWidth: 1, borderColor: '#F3E8FF', justifyContent: 'center', alignItems: 'center' },
  roomTitleCol: { flex: 1 },
  roomTitleInput: { fontSize: 13, fontWeight: '700', color: '#0F172A', padding: 0, margin: 0 },
  roomSub: { fontSize: 11, color: '#64748B', fontWeight: '500', marginTop: 1 },
  roomHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reorderGroup: { flexDirection: 'row', gap: 2 },
  reorderBtn: { width: 22, height: 22, borderRadius: 6, backgroundColor: '#FAF5FF', justifyContent: 'center', alignItems: 'center' },
  roomAmountText: { fontSize: 13, fontWeight: '800', color: '#6D28D9' },

  // Room Body
  roomBody: { paddingHorizontal: 14, paddingBottom: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F1EDFC', backgroundColor: '#FAF9FE' },
  inputSectionLabel: { fontSize: 9, fontWeight: '800', color: '#64748B', letterSpacing: 0.8, marginBottom: 5 },

  // Dimensions
  dimRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 10 },
  dimInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  dimInputPrefix: { fontSize: 11, fontWeight: '800', color: '#7C3AED' },
  dimInput: { flex: 1, paddingVertical: 2, fontSize: 13, fontWeight: '700', color: '#0F172A', textAlign: 'center' },
  dimInputSuffix: { fontSize: 10, color: '#94A3B8', fontWeight: '600' },
  dimTimes: { fontSize: 13, fontWeight: '700', color: '#94A3B8' },
  dimSqftPill: { backgroundColor: '#FAF5FF', borderWidth: 1, borderColor: '#E9D5FF', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  dimSqftPillText: { fontSize: 11, fontWeight: '700', color: '#6D28D9' },

  // Tile Selector Button
  tileSelectBtn: { backgroundColor: '#FFF', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 10 },
  selectedTileRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tileSwatchSmall: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  selectedTileName: { fontSize: 12, fontWeight: '700', color: '#0F172A' },
  selectedTileSpecs: { fontSize: 10, color: '#64748B', marginTop: 1 },
  tileChangeWrap: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  tileChangeText: { fontSize: 11, fontWeight: '700', color: '#7C3AED' },
  noTileRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noTileText: { fontSize: 12, fontWeight: '700', color: '#7C3AED' },

  // Price Override
  priceOverrideRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, backgroundColor: '#FFF', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0' },
  priceOverrideLabel: { fontSize: 10, fontWeight: '700', color: '#64748B' },
  priceOverrideInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F6FF', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: '#E9D5FF' },
  rupeeSymbol: { fontSize: 11, fontWeight: '700', color: '#7C3AED', marginRight: 2 },
  priceOverrideInput: { fontSize: 11, fontWeight: '700', color: '#0F172A', minWidth: 46, textAlign: 'right' },

  // 12x18 Panel
  variantCalcPanel: { backgroundColor: '#FFF', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 8 },
  variantCalcHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  tilesPerLineRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fieldLabelInline: { fontSize: 10, fontWeight: '700', color: '#64748B' },
  tilesPerLineInput: { width: 32, backgroundColor: '#F8F6FF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 6, textAlign: 'center', fontSize: 11, fontWeight: '700', color: '#0F172A', paddingVertical: 1 },
  calcModePillRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  calcModePill: { flex: 1, paddingVertical: 6, borderRadius: 8, backgroundColor: '#F8F6FF', alignItems: 'center', borderWidth: 1, borderColor: '#E9D5FF' },
  calcModePillActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  calcModePillText: { fontSize: 10, fontWeight: '700', color: '#64748B' },
  calcModePillTextActive: { color: '#FFF' },
  allocRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F6FF', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, marginBottom: 5 },
  allocRowOverStock: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
  allocSwatch: { width: 14, height: 14, borderRadius: 4, marginRight: 6 },
  allocLabel: { fontSize: 11, fontWeight: '700', color: '#0F172A' },
  allocPrice: { fontSize: 9, color: '#64748B' },
  stepperWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  stepperBtn: { width: 24, height: 24, borderRadius: 6, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E2E8F0', justifyContent: 'center', alignItems: 'center' },
  stepperText: { fontSize: 12, fontWeight: '700', color: '#7C3AED' },
  stepperVal: { fontSize: 11, fontWeight: '700', color: '#0F172A', minWidth: 46, textAlign: 'center' },
  tilesInput: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, fontSize: 11, fontWeight: '700', color: '#0F172A', textAlign: 'center' },
  allocBoxesVal: { fontSize: 11, fontWeight: '700', color: '#6D28D9' },
  allocTotalVal: { fontSize: 9, color: '#64748B' },

  // Standard Room Calc Card
  roomCalcCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 8, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 8 },
  statRow3Col: { flexDirection: 'row', gap: 4, marginBottom: 6 },
  statCell: { flex: 1, backgroundColor: '#F8F6FF', borderRadius: 8, paddingVertical: 4, alignItems: 'center' },
  statCellLbl: { fontSize: 9, color: '#64748B', fontWeight: '600' },
  statCellVal: { fontSize: 11, fontWeight: '700', color: '#0F172A', marginTop: 1 },
  roomCalcTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6, borderTopWidth: 1, borderTopColor: '#F1EDFC' },
  calcLabelBold: { fontSize: 11, fontWeight: '700', color: '#0F172A' },
  calcValTotal: { fontSize: 12, fontWeight: '800', color: '#6D28D9' },

  // Room Actions
  roomActionsRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6, marginTop: 4 },
  roomActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8 },
  roomActionBtnDelete: { borderColor: '#FECACA', backgroundColor: '#FFF' },
  roomActionText: { fontSize: 11, fontWeight: '700', color: '#64748B' },

  // Summary Drawer
  summaryCard: { backgroundColor: '#FFF', borderRadius: 16, borderWidth: 1, borderColor: '#E9D5FF', overflow: 'hidden', marginTop: 4 },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#FAF9FE' },
  summaryHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  summaryIconCircle: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#7C3AED', justifyContent: 'center', alignItems: 'center' },
  summaryTitle: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  summarySub: { fontSize: 10, color: '#64748B' },
  summaryHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryTotalVal: { fontSize: 14, fontWeight: '800', color: '#6D28D9' },
  summaryBody: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F1EDFC' },
  summaryItemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  summaryItemName: { flex: 1, fontSize: 11, fontWeight: '600', color: '#0F172A' },
  summaryItemSpecs: { fontSize: 10, color: '#64748B', marginHorizontal: 8 },
  summaryItemAmount: { fontSize: 11, fontWeight: '700', color: '#0F172A' },
  summaryDivider: { height: 1, backgroundColor: '#E2E8F0', marginVertical: 8 },
  summaryStatRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  summaryStatLabel: { fontSize: 11, color: '#64748B' },
  summaryStatVal: { fontSize: 11, fontWeight: '700', color: '#0F172A' },
  summaryStatGrandRow: { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#F1EDFC', alignItems: 'center' },
  summaryStatGrandLabel: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  summaryStatGrandVal: { fontSize: 15, fontWeight: '800', color: '#6D28D9' },

  // Sticky Bottom Action Dock
  bottomDock: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.95)', borderTopWidth: 1, borderTopColor: '#F1EDFC', paddingHorizontal: 16, paddingVertical: 10 },
  saveDraftBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#FFF', borderWidth: 1.5, borderColor: '#E9D5FF', borderRadius: 12, paddingVertical: 11 },
  saveDraftText: { fontSize: 13, fontWeight: '700', color: '#6D28D9' },
  proceedBtn: { flex: 1.5, borderRadius: 12, overflow: 'hidden' },
  proceedBtnDisabled: { opacity: 0.8 },
  proceedGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11 },
  proceedText: { fontSize: 13, fontWeight: '700', color: '#FFF' },

  // Bottom Sheet Modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.5)', justifyContent: 'flex-end' },
  sheetContent: { backgroundColor: '#FFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 24, maxHeight: '80%' },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1', alignSelf: 'center', marginBottom: 12 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  modalCloseBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' },

  // Cushion Sheet
  cushionOptionsList: { gap: 8 },
  sheetOptionCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0', backgroundColor: '#FFF' },
  sheetOptionCardActive: { backgroundColor: '#FAF5FF', borderColor: '#7C3AED' },
  sheetOptionInfo: { flex: 1, paddingRight: 10 },
  sheetOptionTitle: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  sheetOptionTitleActive: { color: '#7C3AED' },
  sheetOptionDesc: { fontSize: 11, color: '#64748B', marginTop: 1, lineHeight: 15 },
  sheetCheckCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#CBD5E1', justifyContent: 'center', alignItems: 'center' },
  sheetCheckCircleActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },

  // Templates Sheet
  templatesOptionsList: { gap: 8 },
  templateOptionCard: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0', backgroundColor: '#FFF', gap: 10 },
  templateOptionIconWrap: { width: 36, height: 36, borderRadius: 9, backgroundColor: '#FAF5FF', justifyContent: 'center', alignItems: 'center' },
  templateOptionIconWrapRed: { backgroundColor: '#FEF2F2' },
  templateOptionInfo: { flex: 1 },
  templateDivider: { height: 1, backgroundColor: '#E2E8F0', marginVertical: 4 },

  // Tile Picker Modal Sheet
  sheetSearchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F6FF', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 10 },
  sheetSearchInput: { flex: 1, fontSize: 12, color: '#0F172A' },
  filterChipsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  sizeChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, backgroundColor: '#F1F5F9' },
  sizeChipActive: { backgroundColor: '#7C3AED' },
  sizeChipText: { fontSize: 11, fontWeight: '600', color: '#64748B' },
  sizeChipTextActive: { color: '#FFF' },
  tileListItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  tileListSwatch: { width: 38, height: 38, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  tileListName: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  tileListSpecs: { fontSize: 10, color: '#64748B', marginTop: 1 },
  stockPillText: { fontSize: 9, fontWeight: '700', color: '#10B981', marginTop: 2 },
  tileListPrice: { fontSize: 13, fontWeight: '800', color: '#6D28D9' },

  // Confirm Clear Modal
  confirmModalBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  confirmModalBox: { width: '100%', maxWidth: 320, backgroundColor: '#FFF', borderRadius: 20, padding: 20, alignItems: 'center' },
  confirmModalIconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FEF2F2', justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  confirmModalTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A', marginBottom: 4 },
  confirmModalMsg: { fontSize: 12, color: '#64748B', textAlign: 'center', lineHeight: 17, marginBottom: 16 },
  confirmModalActions: { flexDirection: 'row', gap: 8, width: '100%' },
  confirmCancelBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#F1F5F9', alignItems: 'center' },
  confirmCancelText: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  confirmDeleteBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#EF4444', alignItems: 'center' },
  confirmDeleteText: { fontSize: 12, fontWeight: '700', color: '#FFF' },
});
