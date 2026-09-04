import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { DEFAULT_TRIGGERS, TRIGGERS_STORAGE_KEY } from "@/constants/triggers";
import { useFocusEffect } from "expo-router";

const SAFE_WALK_DURATIONS = [15, 30, 45, 60, 90];

export default function SettingsScreen() {
  const [triggers, setTriggers] = useState(DEFAULT_TRIGGERS);
  const [loaded, setLoaded] = useState(false);

  // -------------------------------------------------------------------------
  // Load saved settings on focus / mount
  // -------------------------------------------------------------------------
  const loadTriggers = useCallback(async () => {
    try {
      const stored = await SecureStore.getItemAsync(TRIGGERS_STORAGE_KEY);
      if (stored) {
        setTriggers({ ...DEFAULT_TRIGGERS, ...JSON.parse(stored) });
      }
    } catch (_) {}
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTriggers();
    }, [loadTriggers])
  );

  // -------------------------------------------------------------------------
  // Save settings whenever they change
  // -------------------------------------------------------------------------
  const saveTriggers = useCallback(async (updated) => {
    setTriggers(updated);
    try {
      await SecureStore.setItemAsync(TRIGGERS_STORAGE_KEY, JSON.stringify(updated));
    } catch (_) {}
  }, []);

  // -------------------------------------------------------------------------
  // Toggle a boolean trigger
  // -------------------------------------------------------------------------
  const toggleTrigger = useCallback(
    async (key) => {
      const newValue = !triggers[key];

      // Notification trigger needs permission
      if (key === "notification" && newValue) {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            "Permission Required",
            "Allow notifications in Settings to use this trigger."
          );
          return;
        }
      }

      saveTriggers({ ...triggers, [key]: newValue });
    },
    [triggers, saveTriggers]
  );

  // -------------------------------------------------------------------------
  // Set safe walk duration
  // -------------------------------------------------------------------------
  const setSafeWalkMinutes = useCallback(
    (minutes) => {
      saveTriggers({ ...triggers, safeWalkMinutes: minutes });
    },
    [triggers, saveTriggers]
  );

  if (!loaded) return null;

  // -------------------------------------------------------------------------
  // Render trigger card
  // -------------------------------------------------------------------------
  const TriggerCard = ({ icon, title, description, triggerKey, disabled = false, disabledReason = "" }) => (
    <View style={[styles.card, disabled && styles.cardDisabled]}>
      <View style={styles.cardLeft}>
        <Text style={styles.cardIcon}>{icon}</Text>
        <View style={styles.cardText}>
          <Text style={[styles.cardTitle, disabled && styles.cardTitleDisabled]}>
            {title}
          </Text>
          <Text style={styles.cardDesc}>
            {disabled ? disabledReason : description}
          </Text>
        </View>
      </View>
      {disabled ? (
        <View style={styles.unavailableBadge}>
          <Text style={styles.unavailableText}>N/A</Text>
        </View>
      ) : (
        <Switch
          value={triggers[triggerKey]}
          onValueChange={() => toggleTrigger(triggerKey)}
          trackColor={{ false: "#E5E7EB", true: "#FCA5A5" }}
          thumbColor={triggers[triggerKey] ? "#B91C1C" : "#9CA3AF"}
        />
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>SOS Triggers</Text>
          <Text style={styles.subtitle}>
            Choose how to send an emergency alert
          </Text>
        </View>

        {/* Info banner */}
        <View style={styles.infoBanner}>
          <Text style={styles.infoBannerText}>
            💡 Enable multiple triggers for maximum safety. Sensor triggers work
            while the app is open on screen.
          </Text>
        </View>

        {/* Section: Gestures */}
        <Text style={styles.sectionLabel}>GESTURES</Text>

        <TriggerCard
          icon="📳"
          title="Shake Phone"
          description="Shake vigorously 3 times within 1.5 seconds"
          triggerKey="shake"
        />

        <TriggerCard
          icon="🙃"
          title="Flip Face-Down"
          description="Flip screen down 3 times rapidly — very discreet"
          triggerKey="flipFaceDown"
        />

        <TriggerCard
          icon="↔️"
          title="Tilt Side-to-Side"
          description="Tilt left → right → left → right (4 reversals in 2s)"
          triggerKey="tiltSide"
        />

        {/* Section: Tap */}
        <Text style={styles.sectionLabel}>TAP</Text>

        <TriggerCard
          icon="👆"
          title="Rapid Taps"
          description="Tap the SOS button 5 times quickly within 2 seconds"
          triggerKey="rapidTaps"
        />

        {/* Section: Auto */}
        <Text style={styles.sectionLabel}>AUTOMATIC</Text>

        <TriggerCard
          icon="🔔"
          title="Notification Shortcut"
          description='Tap "Send SOS" directly from your notification shade'
          triggerKey="notification"
        />

        <TriggerCard
          icon="⏱️"
          title="Safe Walk Timer"
          description="Set a timer — SOS fires if you don't check in before it ends"
          triggerKey="safeWalk"
        />

        {/* Safe Walk Duration Picker */}
        {triggers.safeWalk && (
          <View style={styles.durationPicker}>
            <Text style={styles.durationLabel}>Walk duration</Text>
            <View style={styles.durationRow}>
              {SAFE_WALK_DURATIONS.map((min) => (
                <TouchableOpacity
                  key={min}
                  style={[
                    styles.durationBtn,
                    triggers.safeWalkMinutes === min && styles.durationBtnActive,
                  ]}
                  onPress={() => setSafeWalkMinutes(min)}
                >
                  <Text
                    style={[
                      styles.durationBtnText,
                      triggers.safeWalkMinutes === min &&
                        styles.durationBtnTextActive,
                    ]}
                  >
                    {min}m
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Section: Not Available */}
        <Text style={styles.sectionLabel}>NOT AVAILABLE</Text>

        <TriggerCard
          icon="⚡"
          title="Power + Volume"
          disabled
          disabledReason="Android/iOS block hardware button interception for third-party apps"
          triggerKey="powerVolume"
        />

        <TriggerCard
          icon="🔊"
          title="Volume Button Combo"
          disabled
          disabledReason="Requires native system-level access unavailable in this setup"
          triggerKey="volumeCombo"
        />

        <View style={styles.bottomPadding} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F9FC",
  },

  header: {
    paddingHorizontal: 20,
    paddingTop: 30,
    paddingBottom: 16,
  },

  title: {
    fontSize: 32,
    fontWeight: "800",
    color: "#111827",
  },

  subtitle: {
    marginTop: 5,
    fontSize: 15,
    color: "#6B7280",
  },

  infoBanner: {
    marginHorizontal: 20,
    backgroundColor: "#EFF6FF",
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },

  infoBannerText: {
    fontSize: 13,
    color: "#1D4ED8",
    lineHeight: 20,
  },

  sectionLabel: {
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 8,
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 0.8,
  },

  card: {
    marginHorizontal: 20,
    marginBottom: 10,
    backgroundColor: "white",
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },

  cardDisabled: {
    opacity: 0.55,
  },

  cardLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },

  cardIcon: {
    fontSize: 26,
    marginRight: 14,
  },

  cardText: {
    flex: 1,
  },

  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 3,
  },

  cardTitleDisabled: {
    color: "#6B7280",
  },

  cardDesc: {
    fontSize: 12,
    color: "#6B7280",
    lineHeight: 17,
  },

  unavailableBadge: {
    backgroundColor: "#F3F4F6",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },

  unavailableText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
  },

  durationPicker: {
    marginHorizontal: 20,
    marginBottom: 10,
    backgroundColor: "#FFF4F4",
    borderRadius: 14,
    padding: 16,
  },

  durationLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 10,
  },

  durationRow: {
    flexDirection: "row",
    gap: 8,
  },

  durationBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
  },

  durationBtnActive: {
    backgroundColor: "#B91C1C",
  },

  durationBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#6B7280",
  },

  durationBtnTextActive: {
    color: "white",
  },

  bottomPadding: {
    height: 40,
  },
});
