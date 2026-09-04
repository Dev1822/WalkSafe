import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  FlatList,
  Image,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Contacts from "expo-contacts";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Accelerometer } from "expo-sensors";
import { DEFAULT_TRIGGERS, TRIGGERS_STORAGE_KEY } from "@/constants/triggers";
import * as SMS from "expo-sms";
import { useFocusEffect } from "expo-router";

// Configure notifications presentation
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const CONTACTS_STORAGE_KEY = "walksafe_emergency_contacts";
const NOTIFICATION_ID = "walksafe-persistent-sos";
const EXPIRY_NOTIFICATION_ID = "walksafe-expiry-alarm";
const SAFE_WALK_SESSION_KEY = "walksafe_safe_walk_end_time";

export default function WalkSafe() {
  const [permission, setPermission] = useState(false);
  const [emergencyContacts, setEmergencyContacts] = useState([]);
  const [sending, setSending] = useState(false);
  const [triggers, setTriggers] = useState(DEFAULT_TRIGGERS);

  // Safe Walk Timer state
  const [timerActive, setTimerActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0); // seconds
  const timerIntervalRef = useRef(null);
  const targetEndTimeRef = useRef(null);

  // Rapid taps state
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef(null);

  // Sensor state refs (shake, flip, tilt)
  const shakeHistoryRef = useRef([]);
  const flipHistoryRef = useRef([]);
  const tiltHistoryRef = useRef([]);
  const lastTriggerTimeRef = useRef(0);
  const accelSubscriptionRef = useRef(null);

  // References to avoid stale closures in listeners
  const emergencyContactsRef = useRef(emergencyContacts);
  emergencyContactsRef.current = emergencyContacts;

  const triggersRef = useRef(triggers);
  triggersRef.current = triggers;

  const sendingRef = useRef(sending);
  sendingRef.current = sending;

  // -------------------------------------------------------------------------
  // CORE SEND SOS LOGIC
  // -------------------------------------------------------------------------
  const sendEmergencyMessage = useCallback(async (triggerReason = "") => {
    if (emergencyContactsRef.current.length === 0) {
      Alert.alert(
        "No Emergency Contacts",
        "Please add at least one emergency contact first."
      );
      return;
    }

    if (sendingRef.current) return;

    try {
      setSending(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

      const isAvailable = await SMS.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert("SMS Unavailable", "SMS is not available on this device.");
        return;
      }

      let locationLine = "";
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const coords = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const { latitude, longitude } = coords.coords;
          const mapsUrl = `https://maps.google.com/?q=${latitude},${longitude}`;
          locationLine = `\n\n📍 My last known location:\n${mapsUrl}`;
        }
      } catch (_) {}

      const phoneNumbers = emergencyContactsRef.current
        .map((contact) => contact.phoneNumbers?.[0]?.number)
        .filter(Boolean);

      if (phoneNumbers.length === 0) {
        Alert.alert(
          "No Phone Numbers",
          "None of your emergency contacts have a valid phone number."
        );
        return;
      }

      const reasonPrefix = triggerReason ? `[Auto-Trigger: ${triggerReason}]\n` : "";
      const message =
        "🚨 WALKSAFE EMERGENCY ALERT 🚨\n\n" +
        reasonPrefix +
        "I may be in danger and need help immediately. " +
        "Please contact me as soon as possible." +
        locationLine +
        "\n\n— Sent via WalkSafe";

      await SMS.sendSMSAsync(phoneNumbers, message);
    } catch (error) {
      console.log("Emergency SMS error:", error);
      Alert.alert("Error", "Unable to open the emergency message.");
    } finally {
      setSending(false);
    }
  }, []);

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const SAFE_WALK_CATEGORY = "safe_walk_interactive_category";
  const NOTIFICATION_CHANNEL_ID = "safe_walk_live_timer_channel";

  // Sync notification with current timer / guard state
  const syncNotification = useCallback(
    async (isTimerRunning, remainingSeconds, isGuardEnabled) => {
      try {
        if (isTimerRunning) {
          await Notifications.scheduleNotificationAsync({
            identifier: NOTIFICATION_ID,
            content: {
              title: `⏱️ Safe Walk: [ ${formatTimer(remainingSeconds)} ] remaining`,
              body: `Tap 'I'm Safe ✓' to finish, or '+15 Min' to extend.`,
              categoryIdentifier: SAFE_WALK_CATEGORY,
              channelId: NOTIFICATION_CHANNEL_ID,
              priority: Notifications.AndroidNotificationPriority.MAX,
              sticky: true,
              data: { type: "safe_walk", remaining: remainingSeconds },
            },
            trigger: null,
          });
        } else if (isGuardEnabled) {
          await Notifications.scheduleNotificationAsync({
            identifier: NOTIFICATION_ID,
            content: {
              title: "WalkSafe Guard Active 🛡️",
              body: "Tap here to trigger SOS instantly",
              priority: Notifications.AndroidNotificationPriority.MAX,
              sticky: true,
              data: { type: "guard" },
            },
            trigger: null,
          });
        } else {
          await Notifications.dismissNotificationAsync(NOTIFICATION_ID);
        }
      } catch (e) {
        console.log("Notification sync error:", e);
      }
    },
    []
  );

  const startTimerInterval = useCallback(
    (endTime) => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);

      const initialRemaining = Math.max(0, Math.round((endTime - Date.now()) / 1000));
      setTimeLeft(initialRemaining);

      timerIntervalRef.current = setInterval(() => {
        const now = Date.now();
        const remaining = Math.max(0, Math.round((endTime - now) / 1000));
        setTimeLeft(remaining);

        if (remaining <= 0) {
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
          setTimerActive(false);
          targetEndTimeRef.current = null;
          SecureStore.deleteItemAsync(SAFE_WALK_SESSION_KEY).catch(() => {});
          Notifications.cancelScheduledNotificationAsync(EXPIRY_NOTIFICATION_ID).catch(() => {});
          syncNotification(false, 0, triggersRef.current.notification);
          sendEmergencyMessage("Safe Walk Timer Expired");
        } else {
          syncNotification(true, remaining, triggersRef.current.notification);
          if (remaining === 120) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          }
        }
      }, 1000);
    },
    [syncNotification, sendEmergencyMessage]
  );

  // -------------------------------------------------------------------------
  // LOAD SAVED DATA (Contacts, Triggers & Active Session)
  // -------------------------------------------------------------------------
  const loadInitialData = useCallback(async () => {
    try {
      const storedContacts = await SecureStore.getItemAsync(CONTACTS_STORAGE_KEY);
      if (storedContacts) {
        setEmergencyContacts(JSON.parse(storedContacts));
      }

      const storedTriggers = await SecureStore.getItemAsync(TRIGGERS_STORAGE_KEY);
      if (storedTriggers) {
        setTriggers({ ...DEFAULT_TRIGGERS, ...JSON.parse(storedTriggers) });
      }

      // Check for active Safe Walk session across restarts / background
      const storedEndTime = await SecureStore.getItemAsync(SAFE_WALK_SESSION_KEY);
      if (storedEndTime) {
        const endTime = parseInt(storedEndTime, 10);
        const now = Date.now();
        if (now >= endTime) {
          await SecureStore.deleteItemAsync(SAFE_WALK_SESSION_KEY).catch(() => {});
          await Notifications.cancelScheduledNotificationAsync(EXPIRY_NOTIFICATION_ID).catch(() => {});
          setTimerActive(false);
          setTimeLeft(0);
          sendEmergencyMessage("Safe Walk Timer Expired");
        } else {
          const remaining = Math.round((endTime - now) / 1000);
          targetEndTimeRef.current = endTime;
          setTimeLeft(remaining);
          setTimerActive(true);
          startTimerInterval(endTime);
        }
      }
    } catch (error) {
      console.log("Error loading stored data:", error);
    }
  }, [sendEmergencyMessage, startTimerInterval]);

  useFocusEffect(
    useCallback(() => {
      loadInitialData();
    }, [loadInitialData])
  );

  useEffect(() => {
    requestContactPermission();
  }, []);

  // -------------------------------------------------------------------------
  // CONTACTS MANAGEMENT
  // -------------------------------------------------------------------------
  const persistContacts = async (contacts) => {
    try {
      await SecureStore.setItemAsync(
        CONTACTS_STORAGE_KEY,
        JSON.stringify(contacts)
      );
    } catch (error) {
      console.log("Failed to persist contacts:", error);
    }
  };

  const requestContactPermission = async () => {
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status === "granted") {
        setPermission(true);
      } else {
        setPermission(false);
      }
    } catch (error) {
      console.log("Permission error:", error);
    }
  };

  const addEmergencyContact = async () => {
    try {
      if (!permission) {
        await requestContactPermission();
        return;
      }

      const contact = await Contacts.presentContactPickerAsync();
      if (!contact) return;

      const phoneNumber = contact.phoneNumbers?.[0]?.number;
      if (!phoneNumber) {
        Alert.alert("No Phone Number", "This contact does not have a phone number.");
        return;
      }

      const alreadyAdded = emergencyContacts.some((item) => item.id === contact.id);
      if (alreadyAdded) {
        Alert.alert("Already Added", `${contact.name} is already an emergency contact.`);
        return;
      }

      const updated = [...emergencyContacts, contact];
      setEmergencyContacts(updated);
      persistContacts(updated);
    } catch (error) {
      console.log("Contact picker error:", error);
      Alert.alert("Error", "Unable to select the contact.");
    }
  };

  const removeEmergencyContact = (contactId) => {
    Alert.alert(
      "Remove Emergency Contact",
      "Do you want to remove this person from WalkSafe?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            const updated = emergencyContacts.filter((contact) => contact.id !== contactId);
            setEmergencyContacts(updated);
            persistContacts(updated);
          },
        },
      ]
    );
  };

  // -------------------------------------------------------------------------
  // TRIGGER 1, 4, 6: SENSORS (Shake, Flip Face-Down, Tilt Side-to-Side)
  // -------------------------------------------------------------------------
  const startAccelerometer = useCallback(() => {
    if (accelSubscriptionRef.current) return;

    Accelerometer.setUpdateInterval(100); // 10 readings per second

    accelSubscriptionRef.current = Accelerometer.addListener(({ x, y, z }) => {
      const now = Date.now();
      // Cooldown between sensor triggers (5 seconds)
      if (now - lastTriggerTimeRef.current < 5000) return;

      const activeTriggers = triggersRef.current;

      // 1. SHAKE DETECTION (Magnitude > 1.8g, 3 times within 1.5s)
      if (activeTriggers.shake) {
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        if (magnitude > 1.8) {
          shakeHistoryRef.current = [
            ...shakeHistoryRef.current.filter((t) => now - t < 1500),
            now,
          ];
          if (shakeHistoryRef.current.length >= 3) {
            shakeHistoryRef.current = [];
            lastTriggerTimeRef.current = now;
            sendEmergencyMessage("Phone Shake Detected");
            return;
          }
        }
      }

      // 4. FLIP FACE-DOWN (z < -0.8g face down, 3 times within 3s)
      if (activeTriggers.flipFaceDown) {
        const isFaceDown = z < -0.8;
        const history = flipHistoryRef.current;
        const lastState = history.length > 0 ? history[history.length - 1].isFaceDown : !isFaceDown;

        if (isFaceDown !== lastState) {
          const updated = [
            ...history.filter((item) => now - item.time < 3000),
            { isFaceDown, time: now },
          ];
          flipHistoryRef.current = updated;

          const faceDownCount = updated.filter((item) => item.isFaceDown).length;
          if (faceDownCount >= 3) {
            flipHistoryRef.current = [];
            lastTriggerTimeRef.current = now;
            sendEmergencyMessage("Face-Down Flip Detected");
            return;
          }
        }
      }

      // 6. TILT SIDE-TO-SIDE (X alternates >0.6g & <-0.6g, 4 times within 2s)
      if (activeTriggers.tiltSide) {
        let dir = null;
        if (x > 0.6) dir = "RIGHT";
        else if (x < -0.6) dir = "LEFT";

        if (dir) {
          const history = tiltHistoryRef.current;
          const lastDir = history.length > 0 ? history[history.length - 1].dir : null;

          if (dir !== lastDir) {
            const updated = [
              ...history.filter((item) => now - item.time < 2000),
              { dir, time: now },
            ];
            tiltHistoryRef.current = updated;

            if (updated.length >= 4) {
              tiltHistoryRef.current = [];
              lastTriggerTimeRef.current = now;
              sendEmergencyMessage("Tilt Side-to-Side Detected");
              return;
            }
          }
        }
      }
    });
  }, [sendEmergencyMessage]);

  const stopAccelerometer = useCallback(() => {
    if (accelSubscriptionRef.current) {
      accelSubscriptionRef.current.remove();
      accelSubscriptionRef.current = null;
    }
  }, []);

  // Re-eval accelerometer subscription when triggers or AppState change
  // Also check Safe Walk timer status on resume from background
  useEffect(() => {
    const hasActiveSensor =
      triggers.shake || triggers.flipFaceDown || triggers.tiltSide;

    if (hasActiveSensor) {
      startAccelerometer();
    } else {
      stopAccelerometer();
    }

    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        if (hasActiveSensor) {
          startAccelerometer();
        }
        // If Safe Walk timer was running while in background, sync with real wall clock
        if (targetEndTimeRef.current) {
          const now = Date.now();
          const remaining = Math.max(0, Math.round((targetEndTimeRef.current - now) / 1000));
          if (remaining <= 0) {
            stopSafeWalkTimer();
            sendEmergencyMessage("Safe Walk Timer Expired in Background");
          } else {
            setTimeLeft(remaining);
            startTimerInterval(targetEndTimeRef.current);
          }
        }
      } else {
        stopAccelerometer();
      }
    });

    return () => {
      stopAccelerometer();
      appStateSub.remove();
    };
  }, [triggers, startAccelerometer, stopAccelerometer, startTimerInterval, stopSafeWalkTimer, sendEmergencyMessage]);

  // Setup notification categories and Android notification channel
  const setupNotificationCategories = useCallback(async () => {
    try {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
          name: "Safe Walk Live Countdown",
          importance: Notifications.AndroidImportance.LOW, // Silent in-place updates without vibration/sound on every tick
          vibrationPattern: null,
          enableVibrate: false,
          sound: null,
          showBadge: false,
        });
      }

      await Notifications.setNotificationCategoryAsync(SAFE_WALK_CATEGORY, [
        {
          identifier: "SAFE_ACTION",
          buttonTitle: "I'm Safe ✓",
          options: {
            opensAppToForeground: false,
          },
        },
        {
          identifier: "EXTEND_ACTION",
          buttonTitle: "+15 Min",
          options: {
            opensAppToForeground: false,
          },
        },
        {
          identifier: "SOS_ACTION",
          buttonTitle: "🚨 SOS",
          options: {
            opensAppToForeground: true,
            isDestructive: true,
          },
        },
      ]);
    } catch (e) {
      console.log("Error registering notification setup:", e);
    }
  }, []);

  // -------------------------------------------------------------------------
  // TRIGGER 3: SAFE WALK TIMER (Wall-Clock & Background Safe)
  // -------------------------------------------------------------------------
  const stopSafeWalkTimer = useCallback(async () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    setTimerActive(false);
    setTimeLeft(0);
    targetEndTimeRef.current = null;
    await SecureStore.deleteItemAsync(SAFE_WALK_SESSION_KEY).catch(() => {});
    await Notifications.cancelScheduledNotificationAsync(EXPIRY_NOTIFICATION_ID).catch(() => {});
    syncNotification(false, 0, triggersRef.current.notification);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Safe Walk Stopped", "Glad you are safe!");
  }, [syncNotification]);

  const extendSafeWalkTimer = useCallback(async () => {
    const currentEnd = targetEndTimeRef.current || (Date.now() + 15 * 60 * 1000);
    const newEnd = currentEnd + 15 * 60 * 1000;
    targetEndTimeRef.current = newEnd;
    const remaining = Math.max(0, Math.round((newEnd - Date.now()) / 1000));
    setTimeLeft(remaining);

    await SecureStore.setItemAsync(SAFE_WALK_SESSION_KEY, newEnd.toString()).catch(() => {});

    try {
      await Notifications.scheduleNotificationAsync({
        identifier: EXPIRY_NOTIFICATION_ID,
        content: {
          title: "🚨 WALKSAFE ALERT: Session Expired!",
          body: "Safe Walk timer ended without check-in. Tap to open SOS immediately.",
          priority: Notifications.AndroidNotificationPriority.MAX,
          sound: true,
          data: { type: "expiry" },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(newEnd),
        },
      });
    } catch (e) {}

    syncNotification(true, remaining, triggersRef.current.notification);
    startTimerInterval(newEnd);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [syncNotification, startTimerInterval]);

  const startSafeWalkTimer = useCallback(async () => {
    const totalSeconds = (triggers.safeWalkMinutes || 30) * 60;
    const endTime = Date.now() + totalSeconds * 1000;
    targetEndTimeRef.current = endTime;
    setTimeLeft(totalSeconds);
    setTimerActive(true);

    await SecureStore.setItemAsync(SAFE_WALK_SESSION_KEY, endTime.toString()).catch(() => {});

    try {
      await Notifications.scheduleNotificationAsync({
        identifier: EXPIRY_NOTIFICATION_ID,
        content: {
          title: "🚨 WALKSAFE ALERT: Session Expired!",
          body: "Safe Walk timer ended without check-in. Tap to open SOS immediately.",
          priority: Notifications.AndroidNotificationPriority.MAX,
          sound: true,
          data: { type: "expiry" },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(endTime),
        },
      });
    } catch (e) {
      console.log("Error scheduling expiry notification:", e);
    }

    syncNotification(true, totalSeconds, triggers.notification);
    startTimerInterval(endTime);
  }, [triggers.safeWalkMinutes, triggers.notification, syncNotification, startTimerInterval]);

  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  // -------------------------------------------------------------------------
  // NOTIFICATIONS LISTENER & LIFECYCLE
  // -------------------------------------------------------------------------
  useEffect(() => {
    setupNotificationCategories();

    if (!timerActive) {
      syncNotification(false, 0, triggers.notification);
    }

    const responseSub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const actionIdentifier = response.actionIdentifier;
        if (actionIdentifier === "SAFE_ACTION") {
          stopSafeWalkTimer();
        } else if (actionIdentifier === "EXTEND_ACTION") {
          extendSafeWalkTimer();
        } else if (
          actionIdentifier === "SOS_ACTION" ||
          actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER
        ) {
          sendEmergencyMessage("Notification Tap / SOS Action");
        }
      }
    );

    return () => responseSub.remove();
  }, [
    setupNotificationCategories,
    syncNotification,
    triggers.notification,
    timerActive,
    stopSafeWalkTimer,
    extendSafeWalkTimer,
    sendEmergencyMessage,
  ]);

  // -------------------------------------------------------------------------
  // TRIGGER 5: RAPID SCREEN TAPS (5 taps on SOS button within 2 seconds)
  // -------------------------------------------------------------------------
  const handleSosPress = () => {
    if (triggers.rapidTaps) {
      tapCountRef.current += 1;

      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);

      if (tapCountRef.current >= 5) {
        tapCountRef.current = 0;
        sendEmergencyMessage("Rapid Taps (5x)");
        return;
      }

      tapTimerRef.current = setTimeout(() => {
        // If they tapped fewer than 5 times, perform normal single-tap SOS
        if (tapCountRef.current > 0) {
          tapCountRef.current = 0;
          sendEmergencyMessage("Direct Button Tap");
        }
      }, 500);
    } else {
      sendEmergencyMessage("Direct Button Tap");
    }
  };

  // -------------------------------------------------------------------------
  // RENDER HELPERS
  // -------------------------------------------------------------------------
  const renderEmergencyContact = ({ item }) => {
    const phoneNumber = item.phoneNumbers?.[0]?.number;

    return (
      <View style={styles.contactCard}>
        <View style={styles.contactLeft}>
          <View style={styles.avatar}>
            {item.imageAvailable && item.image?.uri ? (
              <Image source={{ uri: item.image.uri }} style={styles.contactImage} />
            ) : (
              <Text style={styles.avatarText}>
                {item.name?.charAt(0)?.toUpperCase() || "?"}
              </Text>
            )}
          </View>
          <View style={styles.contactInfo}>
            <Text style={styles.contactName}>{item.name || "Unknown Contact"}</Text>
            <Text style={styles.contactNumber}>{phoneNumber}</Text>
            <Text style={styles.emergencyLabel}>Emergency Contact</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.removeButton}
          onPress={() => removeEmergencyContact(item.id)}
        >
          <Text style={styles.removeText}>Remove</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const activeTriggersCount = [
    triggers.shake,
    triggers.notification,
    triggers.safeWalk,
    triggers.flipFaceDown,
    triggers.rapidTaps,
    triggers.tiltSide,
  ].filter(Boolean).length;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.logo}>WalkSafe</Text>
        <Text style={styles.subtitle}>Your safety, connected.</Text>
      </View>

      {/* Active Triggers Status Pill */}
      <View style={styles.triggersBar}>
        <Text style={styles.triggersBarText}>
          🛡️ {activeTriggersCount} trigger{activeTriggersCount === 1 ? "" : "s"} active
        </Text>
        <Text style={styles.triggersBarSub}>Configure in Settings tab</Text>
      </View>

      {/* Safe Walk Timer Card (if enabled) */}
      {triggers.safeWalk && (
        <View style={styles.timerCard}>
          <View style={styles.timerHeader}>
            <Text style={styles.timerTitle}>⏱️ Safe Walk Timer</Text>
            {timerActive && (
              <Text style={styles.timerCountdown}>{formatTimer(timeLeft)}</Text>
            )}
          </View>

          {timerActive ? (
            <View style={styles.timerActions}>
              <TouchableOpacity style={styles.safeBtn} onPress={stopSafeWalkTimer}>
                <Text style={styles.safeBtnText}>I&apos;m Safe ✓</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.extendBtn} onPress={extendSafeWalkTimer}>
                <Text style={styles.extendBtnText}>+15 min</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.startTimerBtn} onPress={startSafeWalkTimer}>
              <Text style={styles.startTimerBtnText}>
                Start {triggers.safeWalkMinutes || 30}m Walk Session
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Permission Button */}
      {!permission && (
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={requestContactPermission}
        >
          <Text style={styles.buttonText}>Allow Contacts Access</Text>
        </TouchableOpacity>
      )}

      {/* Add Contact Button */}
      <TouchableOpacity style={styles.addButton} onPress={addEmergencyContact}>
        <Text style={styles.plus}>+</Text>
        <Text style={styles.addButtonText}>Add Emergency Contact</Text>
      </TouchableOpacity>

      {/* SOS Button */}
      <TouchableOpacity
        style={[styles.sosButton, sending && styles.sosButtonDisabled]}
        onPress={handleSosPress}
        disabled={sending}
        activeOpacity={0.8}
      >
        <Text style={styles.sosIcon}>🚨</Text>
        <View>
          <Text style={styles.sosButtonText}>
            {sending ? "Getting Location..." : "SEND SOS"}
          </Text>
          <Text style={styles.sosSubText}>
            {sending
              ? "Opening SMS with your location"
              : triggers.rapidTaps
              ? "Tap 5x rapidly or tap once"
              : "Alert my emergency contacts"}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Contacts List */}
      <Text style={styles.sectionTitle}>My Emergency Contacts</Text>

      {emergencyContacts.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>👥</Text>
          <Text style={styles.emptyTitle}>No emergency contacts</Text>
          <Text style={styles.emptyText}>
            Add trusted people from your phone contacts.
          </Text>
        </View>
      ) : (
        <FlatList
          data={emergencyContacts}
          keyExtractor={(item) => item.id}
          renderItem={renderEmergencyContact}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 30 }}
        />
      )}
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
    paddingHorizontal: 20,
  },

  header: {
    paddingTop: 30,
    paddingBottom: 10,
  },

  logo: {
    fontSize: 32,
    fontWeight: "800",
    color: "#111827",
  },

  subtitle: {
    marginTop: 3,
    fontSize: 14,
    color: "#6B7280",
  },

  triggersBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 12,
  },

  triggersBarText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1D4ED8",
  },

  triggersBarSub: {
    fontSize: 12,
    color: "#3B82F6",
  },

  timerCard: {
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
  },

  timerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },

  timerTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#92400E",
  },

  timerCountdown: {
    fontSize: 20,
    fontWeight: "800",
    color: "#B45309",
    fontVariant: ["tabular-nums"],
  },

  timerActions: {
    flexDirection: "row",
    gap: 8,
  },

  safeBtn: {
    flex: 2,
    backgroundColor: "#15803D",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },

  safeBtnText: {
    color: "white",
    fontSize: 14,
    fontWeight: "700",
  },

  extendBtn: {
    flex: 1,
    backgroundColor: "#F59E0B",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },

  extendBtnText: {
    color: "white",
    fontSize: 13,
    fontWeight: "700",
  },

  startTimerBtn: {
    backgroundColor: "#D97706",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },

  startTimerBtnText: {
    color: "white",
    fontSize: 14,
    fontWeight: "700",
  },

  permissionButton: {
    backgroundColor: "#111827",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 10,
  },

  addButton: {
    backgroundColor: "#E53935",
    paddingVertical: 14,
    borderRadius: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },

  plus: {
    color: "white",
    fontSize: 24,
    fontWeight: "500",
    marginRight: 8,
    marginTop: -2,
  },

  addButtonText: {
    color: "white",
    fontSize: 15,
    fontWeight: "700",
  },

  sosButton: {
    backgroundColor: "#B91C1C",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    shadowColor: "#B91C1C",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },

  sosButtonDisabled: {
    opacity: 0.7,
  },

  sosIcon: {
    fontSize: 28,
    marginRight: 12,
  },

  sosButtonText: {
    color: "white",
    fontSize: 18,
    fontWeight: "800",
  },

  sosSubText: {
    color: "#FEE2E2",
    fontSize: 12,
    marginTop: 2,
  },

  buttonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 10,
  },

  contactCard: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },

  contactLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },

  avatar: {
    height: 48,
    width: 48,
    borderRadius: 48,
    backgroundColor: "#FDECEC",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
    overflow: "hidden",
  },

  contactImage: {
    height: 48,
    width: 48,
    borderRadius: 48,
  },

  avatarText: {
    fontSize: 20,
    fontWeight: "700",
    color: "#E53935",
  },

  contactInfo: {
    flex: 1,
  },

  contactName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 2,
  },

  contactNumber: {
    fontSize: 13,
    color: "#6B7280",
    marginBottom: 3,
  },

  emergencyLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#E53935",
  },

  removeButton: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },

  removeText: {
    color: "#E53935",
    fontSize: 13,
    fontWeight: "700",
  },

  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 40,
    paddingHorizontal: 30,
  },

  emptyIcon: {
    fontSize: 40,
    marginBottom: 10,
  },

  emptyTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 4,
  },

  emptyText: {
    textAlign: "center",
    fontSize: 13,
    lineHeight: 19,
    color: "#6B7280",
  },
});